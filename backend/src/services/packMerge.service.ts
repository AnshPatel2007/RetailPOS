import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AppError } from '../utils/errorHandler';
import { lockInventory, moveInventory } from './inventory.service';
import { receiveSealedPackages } from './productSellingUnit.service';

/**
 * Turn a standalone product into a pack of another product. A store that
 * already had "Marlboro Red Carton" as its own product can make it the carton
 * pack of "Marlboro Red": the cartons on hand become singles at the same total
 * value (counted as unopened cartons), the carton's barcode and price move to
 * the new pack, its supplier links become carton cases, and the old product
 * is archived with its sales history intact. Nothing is gained or lost.
 */
export interface PackMergeInput {
  locationId: string;
  sourceProductId: string;
  baseProductId: string;
  unitsPerPackage: number;
  name?: string;
  price?: number;
  barcode?: string;
}

const OPEN_ORDER_STATUSES = ['PENDING', 'ORDERED', 'PARTIALLY_RECEIVED'];
const loadProduct = (db: Prisma.TransactionClient, id: string, locationId: string) => db.product.findFirst({
  where: { id, locationId },
  include: { sellingUnits: true, bundleComponents: { select: { id: true } }, bundleMemberships: { select: { id: true } }, suppliers: true },
});

async function examine(db: Prisma.TransactionClient, input: PackMergeInput) {
  const [source, base] = await Promise.all([loadProduct(db, input.sourceProductId, input.locationId), loadProduct(db, input.baseProductId, input.locationId)]);
  if (!source || !base) throw new AppError('Both products must belong to this store', 404);
  const problems: string[] = [];
  if (source.id === base.id) problems.push('Choose a different product to hold the pack');
  if (!Number.isInteger(input.unitsPerPackage) || input.unitsPerPackage < 2) problems.push('A pack holds at least 2 units');
  if (!source.trackInventory || !base.trackInventory) problems.push('Both products need stock tracking turned on');
  if (!base.isActive) problems.push(`${base.name} is archived. Activate it first`);
  if (source.stockQuantity < 0) problems.push(`${source.name} shows ${source.stockQuantity} in stock. Resolve its stock exception first`);
  if (source.sellingUnits.some(unit => unit.isActive)) problems.push(`${source.name} has packs of its own. Retire them first`);
  if (source.bundleComponents.length || source.bundleMemberships.length) problems.push(`${source.name} is part of a variety pack`);
  if (base.bundleComponents.length) problems.push(`${base.name} is a variety pack, so it cannot hold a pack of one item`);
  if (base.sellingUnits.some(unit => unit.isActive && unit.unitsPerPackage === input.unitsPerPackage)) problems.push(`${base.name} already has a ${input.unitsPerPackage}-unit pack`);
  const openOrders = await db.purchaseOrderItem.count({ where: { productId: source.id, purchaseOrder: { status: { in: OPEN_ORDER_STATUSES } } } });
  if (openOrders) problems.push(`${source.name} is on an open purchase order. Receive or cancel it first`);
  const barcode = (input.barcode ?? source.barcode ?? '').trim();
  if (!barcode) problems.push('Enter a barcode for the pack');
  return { source, base, barcode, problems };
}

/** What a merge would do, without changing anything. */
export async function previewPackMerge(db: Prisma.TransactionClient, input: PackMergeInput) {
  const { source, base, barcode, problems } = await examine(db, input);
  const balance = await db.inventoryValuation.findUnique({ where: { productId: source.id } });
  const quantity = Math.max(0, source.stockQuantity);
  const value = quantity > 0 && balance?.value != null ? Number(balance.value.toDecimalPlaces(2)) : quantity > 0 ? null : 0;
  const singles = quantity * input.unitsPerPackage;
  return {
    source: { productId: source.id, name: source.name, barcode: source.barcode, price: Number(source.price), stockQuantity: source.stockQuantity, value },
    base: { productId: base.id, name: base.name, stockQuantity: base.stockQuantity, baseUnitName: base.baseUnitName },
    pack: { name: input.name?.trim() || source.name, barcode, unitsPerPackage: input.unitsPerPackage, price: input.price ?? Number(source.price) },
    singlesAdded: singles, newBaseStock: base.stockQuantity + singles, unopenedPacks: quantity,
    costPerSingle: value !== null && singles > 0 ? Number(new Prisma.Decimal(balance!.value!).div(singles).toDecimalPlaces(4)) : null,
    suppliersCopied: source.suppliers.filter(link => !base.suppliers.some(existing => existing.supplierId === link.supplierId)).length,
    problems,
  };
}

export async function mergeIntoPack(tx: Prisma.TransactionClient, input: PackMergeInput & { userId: string; idempotencyKey: string }) {
  const previous = await tx.productPackMerge.findUnique({ where: { locationId_idempotencyKey: { locationId: input.locationId, idempotencyKey: input.idempotencyKey } } });
  if (previous) {
    if (previous.sourceProductId !== input.sourceProductId || previous.baseProductId !== input.baseProductId || previous.unitsPerPackage !== input.unitsPerPackage)
      throw new AppError('This retry key belongs to a different merge', 409);
    return { merge: previous, replayed: true };
  }
  await lockInventory(tx, [input.sourceProductId, input.baseProductId]);
  const { source, base, barcode, problems } = await examine(tx, input);
  if (problems.length) throw new AppError(problems[0], problems[0].startsWith('Enter') || problems[0].startsWith('A pack') ? 400 : 409, { problems });
  const id = randomUUID();
  const units = input.unitsPerPackage;
  const name = (input.name?.trim() || source.name).slice(0, 60);
  const quantity = source.stockQuantity;
  const notes = `${source.name} became the ${name} pack of ${base.name} (${units} per pack)`;

  let fromEntryId: string | null = null, toEntryId: string | null = null, movedValue: Prisma.Decimal | null = null;
  if (quantity > 0) {
    // Same mechanics as moving stock between products, with the pack ratio: non-COGS, so no profit is created.
    const out = await moveInventory(tx, { productId: source.id, locationId: input.locationId, userId: input.userId, type: 'STOCK_RECLASS',
      sourceId: id, sourceKey: `pack-merge:${id}:from`, quantity: -quantity, notes });
    movedValue = out.inventoryEntry.valueChange === null ? null : out.inventoryEntry.valueChange.negated();
    const into = await moveInventory(tx, { productId: base.id, locationId: input.locationId, userId: input.userId, type: 'STOCK_RECLASS',
      sourceId: id, sourceKey: `pack-merge:${id}:to`, quantity: quantity * units, notes,
      ...(movedValue === null ? { valueMode: 'AVERAGE' as const } : { valueMode: 'FIXED' as const, valueInput: movedValue }) });
    fromEntryId = out.inventoryEntry.id; toEntryId = into.inventoryEntry.id;
  }

  // Free the barcode before the pack takes it (the database rejects a barcode used twice).
  await tx.product.update({ where: { id: source.id }, data: { barcode: null, isActive: false,
    saleBlockedReason: `Merged into ${base.name} as ${name}`.slice(0, 200) } });
  const unit = await tx.productSellingUnit.create({ data: { productId: base.id, locationId: input.locationId, name, barcode, sku: null,
    unitsPerPackage: units, price: input.price ?? source.price, createRequestKey: `pack-merge:${id}` } });
  if (quantity > 0) await receiveSealedPackages(tx, { productId: base.id, locationId: input.locationId, sellingUnitId: unit.id, quantity,
    userId: input.userId, sourceId: id, notes });

  // Who sold the old product now sells the pack: each link becomes a case of the base unit.
  for (const link of source.suppliers) {
    if (base.suppliers.some(existing => existing.supplierId === link.supplierId)) continue;
    const packSize = Math.max(1, link.packSize) * units;
    const caseCost = link.packCost ?? (link.cost === null ? null : new Prisma.Decimal(link.cost).mul(Math.max(1, link.packSize)));
    await tx.productSupplier.create({ data: { productId: base.id, supplierId: link.supplierId, supplierSku: link.supplierSku,
      leadTime: link.leadTime, minOrder: link.minOrder, packSize, packCost: caseCost, packBarcode: link.packBarcode ?? barcode,
      cost: caseCost === null ? null : new Prisma.Decimal(caseCost).div(packSize).toDecimalPlaces(4) } });
  }

  const merge = await tx.productPackMerge.create({ data: { id, locationId: input.locationId, sourceProductId: source.id, baseProductId: base.id,
    sellingUnitId: unit.id, sourceQuantity: Math.max(0, quantity), unitsPerPackage: units, movedValue, fromEntryId, toEntryId,
    userId: input.userId, idempotencyKey: input.idempotencyKey } });
  return { merge, replayed: false };
}
