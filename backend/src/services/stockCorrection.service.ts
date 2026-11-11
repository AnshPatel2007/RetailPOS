import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AppError } from '../utils/errorHandler';
import { lockInventory, moveInventory } from './inventory.service';
import { decimal, precision, previewInventoryValue } from './inventoryCost.service';
import { costKindForReason } from './stockReasons';
import { resolveException } from './inventoryException.service';

/**
 * Corrections for stock that was recorded against the wrong product.
 *
 * Direction: units move FROM the product that physically left (or arrived) TO the
 * product the records charged. The source loses units at its own cost; the target
 * gains them carrying that value. When the target was negative, the difference
 * between that real cost and the provisional cost its sales were booked at lands
 * in cost of goods for the current period. Revenue never changes.
 */
export const RECLASS_REASONS = ['SOLD_AS_OTHER', 'RECEIVED_AS_OTHER', 'RETURNED_AS_OTHER'] as const;
export type ReclassReason = typeof RECLASS_REASONS[number];
const exceptionResolution: Record<ReclassReason, 'WRONG_SKU_SOLD' | 'RECEIVED_AS_OTHER' | 'RETURNED_AS_OTHER'> = {
  SOLD_AS_OTHER: 'WRONG_SKU_SOLD', RECEIVED_AS_OTHER: 'RECEIVED_AS_OTHER', RETURNED_AS_OTHER: 'RETURNED_AS_OTHER',
};

const money = (value: Prisma.Decimal | null | undefined) => value == null ? null : precision(value);
const sumCogs = (...values: (Prisma.Decimal | null)[]) => values.some(v => v === null) ? null : values.reduce((a, b) => a!.plus(b!), decimal(0))!;

async function storeProducts(tx: Prisma.TransactionClient, locationId: string, ids: string[]) {
  await lockInventory(tx, ids);
  const products = await tx.product.findMany({ where: { id: { in: ids } } });
  if (products.length !== ids.length || products.some(p => p.locationId !== locationId)) throw new AppError('Both products must belong to this store', 400);
  if (products.some(p => !p.trackInventory)) throw new AppError('Both products must track inventory', 400);
  return new Map(products.map(p => [p.id, p]));
}

/** After a correction, an exception whose product is back at zero or above is resolved. */
async function settleException(tx: Prisma.TransactionClient, input: { exceptionId?: string | null; productId: string; locationId: string; userId: string;
  resolution: 'WRONG_SKU_SOLD' | 'RECEIVED_AS_OTHER' | 'RETURNED_AS_OTHER'; notes?: string | null }) {
  const exception = input.exceptionId
    ? await tx.inventoryException.findUnique({ where: { id: input.exceptionId } })
    : await tx.inventoryException.findUnique({ where: { openProductId: input.productId } });
  if (!exception || exception.status === 'RESOLVED') return null;
  const product = await tx.product.findUniqueOrThrow({ where: { id: exception.productId } });
  if (product.stockQuantity < 0) return exception;
  return resolveException(tx, { id: exception.id, locationId: input.locationId, userId: input.userId, resolution: input.resolution, notes: input.notes });
}

export async function reclassStock(tx: Prisma.TransactionClient, input: {
  locationId: string; userId: string; fromProductId: string; toProductId: string; quantity: number; reason: ReclassReason;
  exceptionId?: string | null; notes?: string | null; idempotencyKey: string;
}) {
  const previous = await tx.stockReclass.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (previous) {
    if (previous.fromProductId !== input.fromProductId || previous.toProductId !== input.toProductId || previous.quantity !== input.quantity) throw new AppError('This retry key belongs to a different correction', 409);
    return { reclass: previous, replayed: true };
  }
  if (input.fromProductId === input.toProductId) throw new AppError('Choose a different product', 400);
  const products = await storeProducts(tx, input.locationId, [input.fromProductId, input.toProductId]);
  const from = products.get(input.fromProductId)!, to = products.get(input.toProductId)!;
  const id = randomUUID();
  const label = input.reason === 'SOLD_AS_OTHER' ? `${from.name} was sold but rung up as ${to.name}`
    : input.reason === 'RECEIVED_AS_OTHER' ? `${to.name} was received under ${from.name}` : `${to.name} was returned under ${from.name}`;
  const notes = `${label}.${input.notes ? ' ' + input.notes : ''}`;
  const out = await moveInventory(tx, { productId: from.id, locationId: input.locationId, userId: input.userId, type: 'STOCK_RECLASS',
    sourceId: id, sourceKey: `stock-reclass:${id}:from`, quantity: -input.quantity, notes, allowNegative: true, reason: exceptionResolution[input.reason] });
  const movedValue = out.inventoryEntry.valueChange === null ? null : out.inventoryEntry.valueChange.negated();
  // Unknown source value: the target keeps its own shortfall cost (no COGS effect).
  const into = await moveInventory(tx, { productId: to.id, locationId: input.locationId, userId: input.userId, type: 'STOCK_RECLASS',
    sourceId: id, sourceKey: `stock-reclass:${id}:to`, quantity: input.quantity, notes, reason: exceptionResolution[input.reason],
    ...(movedValue === null ? { valueMode: 'AVERAGE' as const } : { valueMode: 'FIXED' as const, valueInput: movedValue }) });
  const reclass = await tx.stockReclass.create({ data: {
    id, locationId: input.locationId, fromProductId: from.id, toProductId: to.id, quantity: input.quantity, reason: input.reason,
    exceptionId: input.exceptionId ?? null, fromEntryId: out.inventoryEntry.id, toEntryId: into.inventoryEntry.id,
    cogsChange: money(sumCogs(out.inventoryEntry.cogsAmount, into.inventoryEntry.cogsAmount)),
    priceDifference: input.reason === 'SOLD_AS_OTHER' ? precision(from.price.minus(to.price).mul(input.quantity)).toDecimalPlaces(2) : null,
    notes: input.notes ?? null, userId: input.userId, idempotencyKey: input.idempotencyKey,
  } });
  await settleException(tx, { exceptionId: input.exceptionId, productId: to.id, locationId: input.locationId, userId: input.userId,
    resolution: exceptionResolution[input.reason], notes });
  return { reclass, replayed: false };
}

/**
 * Wrong product on a known sale line: the line's product (rung up) gets the units
 * back at the line's own cost, the product actually taken is depleted at its own
 * cost. The receipt and revenue stay exactly as recorded.
 */
export async function correctSaleLine(tx: Prisma.TransactionClient, input: {
  locationId: string; userId: string; saleId: string; saleItemId: string; actualProductId: string; quantity: number;
  reason: string; idempotencyKey: string; exceptionId?: string | null;
}) {
  const previous = await tx.saleItemCorrection.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (previous) {
    if (previous.saleItemId !== input.saleItemId || previous.toProductId !== input.actualProductId || previous.quantity !== input.quantity) throw new AppError('This retry key belongs to a different correction', 409);
    return { correction: previous, replayed: true };
  }
  const sale = await tx.sale.findUnique({ where: { id: input.saleId }, include: { items: true, refunds: { include: { items: true } } } });
  if (!sale || sale.locationId !== input.locationId) throw new AppError('Sale not found', 404);
  if (sale.status !== 'COMPLETED') throw new AppError('Only completed sales can be corrected', 400);
  const line = sale.items.find(item => item.id === input.saleItemId);
  if (!line) throw new AppError('Sale line not found', 404);
  if (line.sellingUnitId) throw new AppError('Correct a package line by recording the package count instead', 400);
  if (input.actualProductId === line.productId) throw new AppError('Choose the product the customer actually bought', 400);
  const refunded = sale.refunds.flatMap(refund => refund.items).filter(item => item.saleItemId === line.id).reduce((sum, item) => sum + item.quantity, 0);
  if (refunded) throw new AppError('This line has refunds; correct stock with a count instead', 409);
  const corrected = (await tx.saleItemCorrection.aggregate({ where: { saleItemId: line.id }, _sum: { quantity: true } }))._sum.quantity || 0;
  if (input.quantity + corrected > line.quantity) throw new AppError(`Only ${line.quantity - corrected} unit(s) on this line can still be corrected`, 400);
  const products = await storeProducts(tx, input.locationId, [line.productId, input.actualProductId]);
  const rung = products.get(line.productId)!, actual = products.get(input.actualProductId)!;
  const id = randomUUID();
  const notes = `Sale ${sale.saleNumber}: ${actual.name} was sold but rung up as ${rung.name}. ${input.reason}`;
  const back = await moveInventory(tx, { productId: rung.id, locationId: input.locationId, userId: input.userId, type: 'SKU_CORRECTION',
    sourceId: id, sourceKey: `sku-correction:${id}:from`, quantity: input.quantity, reason: 'WRONG_SKU_SOLD',
    valueMode: line.inventoryEntryId ? 'REFERENCE' : 'FIXED', referenceEntryId: line.inventoryEntryId,
    referenceQuantity: input.quantity, referenceOffset: corrected,
    valueInput: line.inventoryEntryId ? undefined : line.unitCost === null ? null : line.unitCost.mul(input.quantity), notes });
  const taken = await moveInventory(tx, { productId: actual.id, locationId: input.locationId, userId: input.userId, type: 'SKU_CORRECTION',
    sourceId: id, sourceKey: `sku-correction:${id}:to`, quantity: -input.quantity, notes, allowNegative: true, reason: 'WRONG_SKU_SOLD' });
  const correction = await tx.saleItemCorrection.create({ data: { id, saleId: sale.id, saleItemId: line.id, locationId: input.locationId,
    fromProductId: rung.id, toProductId: actual.id, quantity: input.quantity, reason: input.reason, userId: input.userId,
    reverseEntryId: back.inventoryEntry.id, applyEntryId: taken.inventoryEntry.id, idempotencyKey: input.idempotencyKey } });
  // One corrections ledger for reporting: units left as `actual`, recorded as `rung`.
  await tx.stockReclass.create({ data: {
    locationId: input.locationId, fromProductId: actual.id, toProductId: rung.id, quantity: input.quantity, reason: 'SOLD_AS_OTHER',
    exceptionId: input.exceptionId ?? null, saleId: sale.id, saleItemId: line.id, fromEntryId: taken.inventoryEntry.id, toEntryId: back.inventoryEntry.id,
    cogsChange: money(sumCogs(back.inventoryEntry.cogsAmount, taken.inventoryEntry.cogsAmount)),
    priceDifference: precision(actual.price.minus(line.price).mul(input.quantity)).toDecimalPlaces(2),
    notes: input.reason, userId: input.userId, idempotencyKey: 'sale-line:' + input.idempotencyKey,
  } });
  await settleException(tx, { exceptionId: input.exceptionId, productId: rung.id, locationId: input.locationId, userId: input.userId,
    resolution: 'WRONG_SKU_SOLD', notes });
  return { correction, replayed: false };
}

/** Units a stock-without-invoice entry covers, split into already-sold and later additions. */
function unmatchedUnits(entry: { kind: string; quantity: number; quantityBefore: number }) {
  const filled = entry.quantityBefore < 0 ? Math.min(entry.quantity, -entry.quantityBefore) : 0;
  const total = entry.kind === 'UNMATCHED_RECEIPT' ? entry.quantity : filled;
  return { total, sold: filled, above: total - filled };
}

/**
 * Enter the real supplier cost for stock that was added without an invoice. The
 * difference from the estimate posts once, now: units that filled a shortfall were
 * already sold (cost of goods); units still on hand are revalued.
 */
export async function matchUnmatchedCost(tx: Prisma.TransactionClient, input: { entryId: string; locationId: string; userId: string; actualUnitCost: number; notes?: string | null }) {
  const entry = await tx.inventoryValueEntry.findUnique({ where: { id: input.entryId } });
  if (!entry || entry.locationId !== input.locationId || !entry.unmatchedValue) throw new AppError('Stock addition not found', 404);
  const existing = await tx.unmatchedCostMatch.findUnique({ where: { entryId: entry.id } });
  if (existing) {
    if (!existing.actualUnitCost.equals(input.actualUnitCost)) throw new AppError('A cost was already entered for this addition', 409);
    return { match: existing, replayed: true };
  }
  await lockInventory(tx, [entry.productId]);
  const units = unmatchedUnits(entry);
  if (!units.total) throw new AppError('This addition has no units to match', 409);
  const estimatedUnit = entry.unmatchedValue.div(units.total);
  const delta = decimal(input.actualUnitCost).minus(estimatedUnit);
  const balance = await tx.inventoryValuation.findUniqueOrThrow({ where: { productId: entry.productId } });
  const onHand = Math.min(units.above, Math.max(0, balance.quantity));
  const valueChange = precision(delta.mul(onHand));
  const cogs = precision(delta.mul(units.total - onHand));
  const valueAfter = balance.value === null ? null : precision(balance.value.plus(valueChange));
  const id = randomUUID();
  const trueUp = await tx.inventoryValueEntry.create({ data: {
    productId: entry.productId, locationId: entry.locationId, userId: input.userId, kind: 'UNMATCHED_TRUE_UP', mode: 'CORRECTION',
    sourceId: id, sourceKey: `unmatched-true-up:${entry.id}`, quantity: 0, quantityBefore: balance.quantity, quantityAfter: balance.quantity,
    inputValue: null, valueBefore: balance.value, valueChange, valueAfter, cogsAmount: cogs, costStatus: 'VERIFIED',
    referenceEntryId: entry.id, notes: input.notes ?? `Supplier cost ${input.actualUnitCost} entered for stock added without an invoice`,
  } });
  await tx.inventoryValuation.update({ where: { productId: entry.productId }, data: { value: valueAfter,
    ...(balance.quantity > 0 && valueAfter !== null ? { lastUnitCost: precision(valueAfter.div(balance.quantity)) } : {}) } });
  const match = await tx.unmatchedCostMatch.create({ data: { id, entryId: entry.id, locationId: entry.locationId, productId: entry.productId,
    actualUnitCost: input.actualUnitCost, trueUpEntryId: trueUp.id, notes: input.notes ?? null, userId: input.userId } });
  return { match, replayed: false };
}

export async function listUnmatched(db: Prisma.TransactionClient, locationId: string | null, status: 'open' | 'matched' | 'all') {
  const entries = await db.inventoryValueEntry.findMany({
    where: { unmatchedValue: { not: null }, ...(locationId ? { locationId } : {}) }, orderBy: { sequence: 'desc' }, take: 500,
  });
  const ids = entries.map(e => e.id);
  const [matches, products] = await Promise.all([
    db.unmatchedCostMatch.findMany({ where: { entryId: { in: ids } } }),
    db.product.findMany({ where: { id: { in: [...new Set(entries.map(e => e.productId))] } }, select: { id: true, name: true, sku: true } }),
  ]);
  const matchBy = new Map(matches.map(m => [m.entryId, m])), productBy = new Map(products.map(p => [p.id, p]));
  return entries.map(entry => {
    const units = unmatchedUnits(entry);
    const match = matchBy.get(entry.id) ?? null;
    return { entryId: entry.id, createdAt: entry.createdAt, kind: entry.kind, notes: entry.notes, product: productBy.get(entry.productId) ?? null,
      units: units.total, soldUnits: units.sold, estimatedValue: entry.unmatchedValue, estimatedUnitCost: units.total ? precision(entry.unmatchedValue!.div(units.total)) : null,
      match: match && { actualUnitCost: match.actualUnitCost, matchedAt: match.createdAt } };
  }).filter(row => status === 'all' || (status === 'open' ? !row.match : !!row.match));
}

export async function listCorrections(db: Prisma.TransactionClient, locationId: string | null, range?: { gte?: Date; lte?: Date }) {
  const rows = await db.stockReclass.findMany({ where: { ...(locationId ? { locationId } : {}), ...(range ? { createdAt: range } : {}) }, orderBy: { createdAt: 'desc' }, take: 500 });
  const productIds = [...new Set(rows.flatMap(r => [r.fromProductId, r.toProductId]))];
  const saleIds = [...new Set(rows.map(r => r.saleId).filter((id): id is string => !!id))];
  const [products, sales] = await Promise.all([
    db.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true, sku: true, price: true } }),
    db.sale.findMany({ where: { id: { in: saleIds } }, select: { id: true, saleNumber: true, shiftId: true, user: { select: { firstName: true, lastName: true } } } }),
  ]);
  const productBy = new Map(products.map(p => [p.id, p])), saleBy = new Map(sales.map(s => [s.id, s]));
  return rows.map(row => {
    const sale = row.saleId ? saleBy.get(row.saleId) : undefined;
    return { id: row.id, createdAt: row.createdAt, reason: row.reason, quantity: row.quantity, notes: row.notes,
      recordedAs: productBy.get(row.toProductId) ?? null, actually: productBy.get(row.fromProductId) ?? null,
      sale: sale ? { id: sale.id, saleNumber: sale.saleNumber, cashier: sale.user ? `${sale.user.firstName} ${sale.user.lastName}` : null } : null,
      cogsChange: row.cogsChange, priceDifference: row.priceDifference };
  });
}

/** What a resolution would do, computed with the same valuation rules as posting. */
export async function previewResolution(tx: Prisma.TransactionClient, input: { productId: string; locationId: string; userId: string } & (
  { action: 'count'; countedQuantity: number; resolution: string } | { action: 'reclass'; fromProductId: string; quantity: number })) {
  const target = await tx.product.findUnique({ where: { id: input.productId } });
  if (!target || target.locationId !== input.locationId) throw new AppError('Product not found at this store', 404);
  const base = { locationId: input.locationId, userId: input.userId };
  if (input.action === 'count') {
    const change = input.countedQuantity - target.stockQuantity;
    const kind = costKindForReason(input.resolution, change, 'COUNT');
    const result = change === 0 ? null : await previewInventoryValue(tx, { ...base, productId: target.id, type: kind }, target.stockQuantity, input.countedQuantity);
    return { changes: [{ productId: target.id, name: target.name, from: target.stockQuantity, to: input.countedQuantity }],
      cogsChange: result ? result.cogs : decimal(0), unmatchedValue: result?.unmatched ?? null, kind };
  }
  const source = await tx.product.findUnique({ where: { id: input.fromProductId } });
  if (!source || source.locationId !== input.locationId) throw new AppError('Product not found at this store', 404);
  const out = await previewInventoryValue(tx, { ...base, productId: source.id, type: 'STOCK_RECLASS' }, source.stockQuantity, source.stockQuantity - input.quantity);
  const moved = out.change === null ? null : out.change.negated();
  const into = await previewInventoryValue(tx, { ...base, productId: target.id, type: 'STOCK_RECLASS',
    ...(moved === null ? { valueMode: 'AVERAGE' as const } : { valueMode: 'FIXED' as const, valueInput: moved }) }, target.stockQuantity, target.stockQuantity + input.quantity);
  return { changes: [
      { productId: source.id, name: source.name, from: source.stockQuantity, to: source.stockQuantity - input.quantity },
      { productId: target.id, name: target.name, from: target.stockQuantity, to: target.stockQuantity + input.quantity }],
    cogsChange: sumCogs(out.cogs, into.cogs), unmatchedValue: into.unmatched ?? null, kind: 'STOCK_RECLASS',
    priceDifference: precision(source.price.minus(target.price).mul(input.quantity)).toDecimalPlaces(2) };
}
