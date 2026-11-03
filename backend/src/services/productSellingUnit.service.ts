import { Prisma, Product, ProductSellingUnit } from '@prisma/client';
import { AppError } from '../utils/errorHandler';

type Database = Pick<Prisma.TransactionClient, 'product' | 'productSellingUnit'>;
export type ProductWithSellingUnits = Product & { sellingUnits?: ProductSellingUnit[]; [key: string]: any };

export function packagingSummary(product: ProductWithSellingUnits) {
  const sellingUnits = product.sellingUnits || [];
  const sealedBaseQuantity = sellingUnits.reduce((total, unit) => total + unit.sealedQuantity * unit.unitsPerPackage, 0);
  return { ...product, sellingUnits, inventoryProductId: product.id, sellingUnitId: null as string | null,
    unitsPerPackage: 1, baseStockQuantity: product.stockQuantity,
    looseStockQuantity: Math.max(0, product.stockQuantity - sealedBaseQuantity) };
}

/** A selling format has its own identity/price, but inherits all eligibility and inventory from its product. */
export function projectSellingUnit(product: ProductWithSellingUnits, unit: ProductSellingUnit) {
  return { ...packagingSummary(product), id: unit.id, inventoryProductId: product.id, sellingUnitId: unit.id,
    name: unit.name, sku: unit.sku || unit.barcode, barcode: unit.barcode, price: unit.price,
    compareAtPrice: null, isActive: product.isActive && unit.isActive, unitsPerPackage: unit.unitsPerPackage,
    stockQuantity: unit.sealedQuantity, sealedQuantity: unit.sealedQuantity,
    cost: new Prisma.Decimal(product.cost).mul(unit.unitsPerPackage),
    verifiedUnitCost: product.verifiedUnitCost == null ? null : new Prisma.Decimal(product.verifiedUnitCost).mul(unit.unitsPerPackage),
    priceEmbedded: false, sellingUnits: [], sellingUnitVersion: unit.version };
}

export async function resolveSellableProducts(db: Database, input: { locationId: string; ids: string[]; includeInactive?: boolean }) {
  const ids = [...new Set(input.ids)];
  if (!ids.length) return [];
  const products = await db.product.findMany({ where: { locationId: input.locationId,
    ...(input.includeInactive ? {} : { isActive: true }),
    OR: [{ id: { in: ids } }, { sellingUnits: { some: { id: { in: ids } } } }] },
    include: { category: true, sellingUnits: true } });
  const result: ReturnType<typeof packagingSummary>[] = [];
  for (const product of products) {
    if (ids.includes(product.id)) result.push(packagingSummary(product));
    for (const unit of product.sellingUnits) if (ids.includes(unit.id) && (input.includeInactive || unit.isActive)) result.push(projectSellingUnit(product, unit));
  }
  return result;
}

export async function assertSellingIdentifiersAvailable(db: Database, input: {
  locationId: string | null; barcode?: string | null; sku?: string | null; excludeProductId?: string; excludeSellingUnitId?: string;
}) {
  if (!input.locationId) return;
  for (const field of ['barcode', 'sku'] as const) {
    const value = input[field];
    if (!value) continue;
    const [product, unit] = await Promise.all([
      db.product.findFirst({ where: { locationId: input.locationId, [field]: value,
        ...(input.excludeProductId ? { id: { not: input.excludeProductId } } : {}) }, select: { id: true } }),
      db.productSellingUnit.findFirst({ where: { locationId: input.locationId, [field]: value,
        ...(input.excludeSellingUnitId ? { id: { not: input.excludeSellingUnitId } } : {}) }, select: { id: true } }),
    ]);
    if (product || unit) throw new AppError(`${field === 'sku' ? 'SKU' : 'Barcode'} already belongs to a product or selling package in this store`, 409);
  }
}

export async function lockPackagingProduct(tx: Prisma.TransactionClient, productId: string, locationId: string) {
  await tx.$queryRaw(Prisma.sql`SELECT id FROM products WHERE id = ${productId} ORDER BY id FOR UPDATE`);
  const product = await tx.product.findFirst({ where: { id: productId, locationId }, include: { sellingUnits: true } });
  if (!product) throw new AppError('Product not found at this store', 404);
  return product;
}

interface PackageChange {
  productId: string;
  locationId: string;
  sellingUnitId: string;
  /** Number of sealed packages, never base units. */
  quantity: number;
  userId: string;
  sourceId?: string;
  requestKey?: string;
  notes?: string;
}

async function recordPackageChange(tx: Prisma.TransactionClient, unit: ProductSellingUnit, input: PackageChange, delta: number, kind: string) {
  const updated = await tx.productSellingUnit.update({ where: { id: unit.id },
    data: { sealedQuantity: { increment: delta }, version: { increment: 1 } } });
  await tx.productPackagingEvent.create({ data: { productId: input.productId, locationId: input.locationId,
    sellingUnitId: unit.id, userId: input.userId, kind, quantity: delta,
    previousQuantity: unit.sealedQuantity, newQuantity: updated.sealedQuantity,
    sourceId: input.sourceId, requestKey: input.requestKey, notes: input.notes } });
  return updated;
}

async function changeSealedPackages(tx: Prisma.TransactionClient, input: PackageChange, direction: 1 | -1) {
  if (!Number.isSafeInteger(input.quantity) || input.quantity < 0) throw new AppError('Package quantity must be a nonnegative whole number', 400);
  const product = await lockPackagingProduct(tx, input.productId, input.locationId);
  if (input.requestKey) {
    const previous = await tx.productPackagingEvent.findUnique({ where: { locationId_requestKey: { locationId: input.locationId, requestKey: input.requestKey } } });
    if (previous) {
      if (previous.productId !== input.productId || previous.sellingUnitId !== input.sellingUnitId || previous.quantity !== direction * input.quantity)
        throw new AppError('This retry key belongs to another packaging operation', 409);
      return product.sellingUnits.find(unit => unit.id === input.sellingUnitId)!;
    }
  }
  const unit = product.sellingUnits.find(candidate => candidate.id === input.sellingUnitId);
  if (!unit) throw new AppError('Selling package not found for this product', 404);
  if (direction < 0 && !unit.isActive) throw new AppError('This selling package is inactive', 400);
  if (input.quantity === 0) return unit;
  if (unit.sealedQuantity + input.quantity * direction < 0) throw new AppError(`Only ${unit.sealedQuantity} unopened ${unit.name} available`, 409);
  if (direction > 0) {
    const sealed = product.sellingUnits.reduce((sum, candidate) => sum + candidate.unitsPerPackage * candidate.sealedQuantity, 0);
    if (sealed + unit.unitsPerPackage * input.quantity > product.stockQuantity)
      throw new AppError('Unopened packages exceed the recorded total stock. Receive or count the base stock first.', 409);
  }
  return recordPackageChange(tx, unit, input, input.quantity * direction, direction > 0 ? 'RECEIVED_OR_RETURNED' : 'SOLD_OR_REMOVED');
}

/** Call before the matching base-unit stock deduction, in the same transaction. */
export const consumeSealedPackages = (tx: Prisma.TransactionClient, input: PackageChange) => changeSealedPackages(tx, input, -1);
/** Call after the matching base-unit stock addition, in the same transaction. */
export const receiveSealedPackages = (tx: Prisma.TransactionClient, input: PackageChange) => changeSealedPackages(tx, input, 1);

/** Calculate the fewest containers to open to keep sealed units within a reduced stock total. */
export function packagesToOpen(units: Pick<ProductSellingUnit, 'id' | 'unitsPerPackage' | 'sealedQuantity'>[], stockQuantity: number) {
  let excess = units.reduce((sum, unit) => sum + unit.unitsPerPackage * unit.sealedQuantity, 0) - stockQuantity;
  const changes: { id: string; quantity: number }[] = [];
  // Largest first minimizes the number of containers opened; identity breaks ties deterministically.
  for (const unit of [...units].sort((a, b) => b.unitsPerPackage - a.unitsPerPackage || a.id.localeCompare(b.id))) {
    if (excess <= 0) break;
    const quantity = Math.min(unit.sealedQuantity, Math.ceil(excess / unit.unitsPerPackage));
    if (quantity) changes.push({ id: unit.id, quantity });
    excess -= quantity * unit.unitsPerPackage;
  }
  return changes;
}

/** For single-item sales, stock losses and counts: open containers as needed; never invent sealed packages. */
export async function reconcileSealedStock(tx: Prisma.TransactionClient, input: {
  productId: string; locationId: string; stockQuantity: number; userId: string; sourceId?: string;
}) {
  const product = await lockPackagingProduct(tx, input.productId, input.locationId);
  for (const change of packagesToOpen(product.sellingUnits, input.stockQuantity)) {
    const unit = product.sellingUnits.find(candidate => candidate.id === change.id)!;
    await recordPackageChange(tx, unit, { ...input, sellingUnitId: unit.id, quantity: change.quantity }, -change.quantity, 'OPENED_FOR_BASE_STOCK');
  }
}

/** Reclassify existing total stock. This never receives inventory or changes its value. */
export async function setPackageCount(tx: Prisma.TransactionClient, input: PackageChange & {
  action: 'count' | 'open'; expectedVersion: number; expectedStockVersion: number;
}) {
  const product = await lockPackagingProduct(tx, input.productId, input.locationId);
  const unit = product.sellingUnits.find(candidate => candidate.id === input.sellingUnitId);
  if (!unit) throw new AppError('Selling package not found', 404);
  if (input.requestKey) {
    const previous = await tx.productPackagingEvent.findUnique({ where: { locationId_requestKey: { locationId: input.locationId, requestKey: input.requestKey } } });
    if (previous) {
      if (previous.sellingUnitId !== unit.id || previous.kind !== (input.action === 'count' ? 'COUNTED' : 'OPENED') ||
        (input.action === 'count' ? previous.newQuantity !== input.quantity : previous.quantity !== -input.quantity))
        throw new AppError('This retry key belongs to another packaging operation', 409);
      return packagingSummary(product);
    }
  }
  if (unit.version !== input.expectedVersion || product.stockVersion !== input.expectedStockVersion)
    throw new AppError('Stock or packaging changed. Review the current quantities and try again.', 409);
  if (!unit.isActive) throw new AppError('Activate this package before counting it', 400);
  const desired = input.action === 'count' ? input.quantity : unit.sealedQuantity - input.quantity;
  if (!Number.isSafeInteger(desired) || desired < 0) throw new AppError('Not enough unopened packages', 400);
  const otherSealed = product.sellingUnits.filter(candidate => candidate.id !== unit.id)
    .reduce((sum, candidate) => sum + candidate.sealedQuantity * candidate.unitsPerPackage, 0);
  if (otherSealed + desired * unit.unitsPerPackage > product.stockQuantity)
    throw new AppError('The unopened packages contain more units than the current stock. Correct total stock first.', 409);
  await recordPackageChange(tx, unit, input, desired - unit.sealedQuantity, input.action === 'count' ? 'COUNTED' : 'OPENED');
  return packagingSummary({ ...product, sellingUnits: product.sellingUnits.map(candidate => candidate.id === unit.id
    ? { ...candidate, sealedQuantity: desired, version: candidate.version + 1 } : candidate) });
}
