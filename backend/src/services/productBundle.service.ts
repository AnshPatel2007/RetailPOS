import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AppError } from '../utils/errorHandler';
import { lockInventory, moveInventory } from './inventory.service';
import { decimal, precision } from './inventoryCost.service';

/**
 * Variety packs (spec section 10). A variety pack is its own product: it is
 * bought, received and sold whole. Opening one moves its units out and its
 * value into the products it contains, so nothing is gained or lost and the
 * components are never stocked until a pack is opened.
 *
 * The pack's cost splits by count: a 24-pack bought for $24 is $1 an item, so
 * 12 red carry $12 and 6 blue carry $6, whatever each flavour costs alone.
 */
export interface BundleComponentInput { productId: string; quantity: number }

type Db = Pick<Prisma.TransactionClient, 'product' | 'productBundleComponent' | 'inventoryValuation'>;
const ONE_UNIT = decimal('0.00000001');

/** Best current unit cost: on-hand average, then the last unit cost, then the catalog cost. */
async function unitCosts(db: Db, productIds: string[]) {
  const [balances, products] = await Promise.all([
    db.inventoryValuation.findMany({ where: { productId: { in: productIds } } }),
    db.product.findMany({ where: { id: { in: productIds } }, select: { id: true, cost: true } }),
  ]);
  return new Map(productIds.map(id => {
    const balance = balances.find(row => row.productId === id);
    const catalog = products.find(row => row.id === id)?.cost;
    const cost = balance && balance.quantity > 0 && balance.value !== null ? balance.value.div(balance.quantity)
      : balance?.lastUnitCost ?? (catalog && decimal(catalog).gt(0) ? decimal(catalog) : null);
    return [id, cost && cost.gt(0) ? cost : null] as const;
  }));
}

/**
 * Split a value in proportion to weights. Largest-remainder rounding keeps the
 * parts summing exactly to the whole.
 */
export function allocateValue(total: Prisma.Decimal, weights: Prisma.Decimal[]) {
  const sum = weights.reduce((acc, weight) => acc.plus(weight), decimal(0));
  const safe = sum.gt(0) ? weights : weights.map(() => decimal(1));
  const safeSum = sum.gt(0) ? sum : decimal(weights.length);
  const shares = safe.map(weight => total.mul(weight).div(safeSum));
  const parts = shares.map(share => share.toDecimalPlaces(8, Prisma.Decimal.ROUND_DOWN));
  let remainder = total.minus(parts.reduce((acc, part) => acc.plus(part), decimal(0))).div(ONE_UNIT).round().toNumber();
  const order = shares.map((share, index) => ({ index, fraction: share.minus(parts[index]) }))
    .sort((a, b) => b.fraction.comparedTo(a.fraction) || a.index - b.index);
  for (const { index } of order) {
    if (remainder <= 0) break;
    parts[index] = parts[index].plus(ONE_UNIT);
    remainder--;
  }
  return parts;
}

/** Each product's share of a pack is its count of the pack's items. */
const countWeights = (components: { quantity: number }[]) => components.map(component => decimal(component.quantity));

export async function getBundle(db: Db, productId: string, locationId: string) {
  const product = await db.product.findFirst({ where: { id: productId, locationId }, include: {
    bundleComponents: { include: { component: { select: { id: true, name: true, sku: true, trackInventory: true, stockQuantity: true } } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
    bundleMemberships: { include: { bundle: { select: { id: true, name: true, sku: true } } } },
  } });
  if (!product) throw new AppError('Product not found at this store', 404);
  const [packCost] = [...(await unitCosts(db, [product.id])).values()];
  const itemsPerPack = product.bundleComponents.reduce((sum, row) => sum + row.quantity, 0);
  const parts = packCost && itemsPerPack ? allocateValue(precision(packCost), countWeights(product.bundleComponents)) : null;
  return {
    productId: product.id, stockQuantity: product.stockQuantity, packUnitCost: packCost ? Number(packCost.toDecimalPlaces(4)) : null,
    itemsPerPack, costPerItem: packCost && itemsPerPack ? Number(packCost.div(itemsPerPack).toDecimalPlaces(4)) : null,
    components: product.bundleComponents.map((row, index) => ({ productId: row.componentProductId, name: row.component.name, sku: row.component.sku,
      quantity: row.quantity, stockQuantity: row.component.stockQuantity,
      valuePerPack: parts ? Number(parts[index].toDecimalPlaces(4)) : null })),
    // A product can't be both: packs it is part of.
    partOf: product.bundleMemberships.map(row => ({ productId: row.bundle.id, name: row.bundle.name, sku: row.bundle.sku, quantity: row.quantity })),
  };
}

export async function setBundleContents(tx: Prisma.TransactionClient, input: { productId: string; locationId: string; components: BundleComponentInput[] }) {
  await tx.$queryRaw(Prisma.sql`SELECT id FROM products WHERE id = ${input.productId} FOR UPDATE`);
  const bundle = await tx.product.findFirst({ where: { id: input.productId, locationId: input.locationId }, include: { bundleMemberships: true } });
  if (!bundle) throw new AppError('Product not found at this store', 404);
  const ids = input.components.map(component => component.productId);
  if (new Set(ids).size !== ids.length) throw new AppError('List each product once', 400);
  if (ids.includes(bundle.id)) throw new AppError('A variety pack cannot contain itself', 400);
  if (input.components.length) {
    if (!bundle.trackInventory) throw new AppError('Track stock for the variety pack before setting its contents', 400);
    if (bundle.bundleMemberships.length) throw new AppError(`${bundle.name} is inside another variety pack, so it cannot have contents of its own`, 400);
    if (input.components.length < 2 && input.components[0].quantity < 2) throw new AppError('A variety pack contains at least two units', 400);
    const components = await tx.product.findMany({ where: { id: { in: ids }, locationId: input.locationId }, include: { bundleComponents: { select: { id: true } } } });
    if (components.length !== ids.length) throw new AppError('Every product in the pack must belong to this store', 400);
    const untracked = components.find(component => !component.trackInventory);
    if (untracked) throw new AppError(`Track stock for ${untracked.name} before adding it to a pack`, 400);
    const nested = components.find(component => component.bundleComponents.length);
    if (nested) throw new AppError(`${nested.name} is a variety pack itself; add its contents instead`, 400);
  }
  await tx.productBundleComponent.deleteMany({ where: { bundleProductId: bundle.id } });
  // One statement stamps every row with the same time; a millisecond apart keeps the order they were entered.
  const enteredAt = Date.now();
  if (input.components.length) await tx.productBundleComponent.createMany({ data: input.components.map((component, index) => ({
    bundleProductId: bundle.id, componentProductId: component.productId, locationId: input.locationId,
    quantity: component.quantity, createdAt: new Date(enteredAt + index) })) });
}

/** Open variety packs: the pack's units leave stock and their value moves into the contents. */
export async function openBundle(tx: Prisma.TransactionClient, input: { productId: string; locationId: string; userId: string; quantity: number; idempotencyKey: string }) {
  const previous = await tx.bundleOpening.findUnique({ where: { locationId_idempotencyKey: { locationId: input.locationId, idempotencyKey: input.idempotencyKey } } });
  if (previous) {
    if (previous.bundleProductId !== input.productId || previous.quantity !== input.quantity) throw new AppError('This retry key belongs to a different opening', 409);
    return { opening: previous, replayed: true };
  }
  const bundle = await tx.product.findFirst({ where: { id: input.productId, locationId: input.locationId },
    include: { bundleComponents: { include: { component: { select: { name: true } } } } } });
  if (!bundle) throw new AppError('Product not found at this store', 404);
  if (!bundle.bundleComponents.length) throw new AppError(`Set what ${bundle.name} contains before opening it`, 400);
  const contents = [...bundle.bundleComponents].sort((a, b) => a.componentProductId.localeCompare(b.componentProductId));
  await lockInventory(tx, [bundle.id, ...contents.map(component => component.componentProductId)]);
  const id = randomUUID();
  const notes = `Opened ${input.quantity} x ${bundle.name}`;
  // Opening needs the packs on record, like any stock move other than a sale.
  const out = await moveInventory(tx, { productId: bundle.id, locationId: input.locationId, userId: input.userId, type: 'BUNDLE_OPEN',
    sourceId: id, sourceKey: `bundle-open:${id}:pack`, quantity: -input.quantity, notes });
  const value = out.inventoryEntry.valueChange === null ? null : out.inventoryEntry.valueChange.negated();
  const parts = value === null ? null : allocateValue(value, countWeights(contents));
  const allocation: { productId: string; name: string; quantity: number; value: number | null; entryId: string }[] = [];
  for (const [index, component] of contents.entries()) {
    const units = component.quantity * input.quantity;
    const into = await moveInventory(tx, { productId: component.componentProductId, locationId: input.locationId, userId: input.userId, type: 'BUNDLE_OPEN',
      sourceId: id, sourceKey: `bundle-open:${id}:${component.componentProductId}`, quantity: units, notes,
      // Unknown pack value: each product keeps its own cost (no gain or loss is invented).
      ...(parts === null ? { valueMode: 'AVERAGE' as const } : { valueMode: 'FIXED' as const, valueInput: parts[index] }) });
    allocation.push({ productId: component.componentProductId, name: component.component.name, quantity: units,
      value: parts === null ? null : Number(parts[index]), entryId: into.inventoryEntry.id });
  }
  const opening = await tx.bundleOpening.create({ data: { id, locationId: input.locationId, bundleProductId: bundle.id, quantity: input.quantity,
    bundleEntryId: out.inventoryEntry.id, value, allocation, userId: input.userId, idempotencyKey: input.idempotencyKey } });
  return { opening, replayed: false };
}
