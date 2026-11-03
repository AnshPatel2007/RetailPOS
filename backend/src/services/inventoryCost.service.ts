import { InventoryValueEntry, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AppError } from '../utils/errorHandler';
Prisma.Decimal.set({ precision: 40 });

// Eight decimal places are retained until reporting. All calculations use decimal
// arithmetic; exhausting a balance consumes its entire value, including residue.
export const decimal = (n: Prisma.Decimal.Value) => new Prisma.Decimal(n);
export const precision = (n: Prisma.Decimal) => n.toDecimalPlaces(8, Prisma.Decimal.ROUND_HALF_UP);
export type CostState = { quantity: number; value: Prisma.Decimal | null };
/** VERIFIED: backed by recorded inventory value. ESTIMATED: provisional cost for
 * units the records did not hold. UNKNOWN: no cost source exists at all. */
export type CostStatus = 'VERIFIED' | 'ESTIMATED' | 'UNKNOWN';
export type CostInput = { quantity: number; mode: string; inputValue?: Prisma.Decimal | null; kind: string; provisionalUnitCost?: Prisma.Decimal | null };
export type CostResult = { quantity: number; value: Prisma.Decimal | null; change: Prisma.Decimal | null; cogs: Prisma.Decimal | null; costStatus: CostStatus };
const cogsKinds = ['SALE', 'RETURN', 'VOID_RETURN', 'ADJUSTMENT', 'COUNT', 'CYCLE_COUNT', 'STOCK_LOSS', 'IMPORT', 'SKU_CORRECTION'];
const sum = (a: Prisma.Decimal | null, b: Prisma.Decimal | null) => a === null || b === null ? null : precision(a.plus(b));

/**
 * Moving weighted average that tolerates negative on-hand quantities.
 *
 * A physical store sells what the customer holds, so an outflow may exceed the
 * recorded quantity. The covered units leave at the average; the shortfall is
 * valued at a provisional unit cost and marked ESTIMATED, never as free goods.
 * A negative position carries a negative value at that unit cost.
 *
 * An inflow into a negative position first fills the shortfall. The difference
 * between its actual cost and the provisional value of the filled units is a
 * current-period cost true-up (returned as `cogs` for non-sale kinds); the
 * remaining units carry the inflow's own cost. The average is never rebuilt
 * from a negative base.
 */
export function valueMovement(before: CostState, input: CostInput): CostResult {
  const quantity = before.quantity + input.quantity;
  if (!Number.isSafeInteger(quantity)) throw new AppError('Invalid inventory quantity', 400);
  if (input.mode === 'NONSTOCK') return { quantity, value: before.value, change: decimal(0), cogs: input.inputValue ?? null,
    costStatus: input.inputValue == null ? 'UNKNOWN' : 'VERIFIED' };
  if (['TRANSFER_LOSS', 'RETURN_LOSS'].includes(input.kind)) return { quantity, value: before.value, change: decimal(0),
    cogs: input.kind === 'TRANSFER_LOSS' ? input.inputValue ?? null : decimal(0), costStatus: 'VERIFIED' };
  if (input.mode === 'OPENING') {
    const after = input.inputValue ?? null;
    const change = before.value === null || after === null ? null : precision(after.minus(before.value));
    return { quantity, value: after, change, cogs: decimal(0), costStatus: after === null ? 'UNKNOWN' : 'VERIFIED' };
  }
  const isCogsKind = cogsKinds.includes(input.kind);

  // Outflow beyond the recorded quantity (sales, shrink, transfers at average).
  if (input.quantity < 0 && quantity < 0) {
    if (input.mode !== 'AVERAGE') throw new AppError('Insufficient recorded stock for this return or correction', 409);
    const requested = -input.quantity;
    const covered = before.quantity > 0 ? before.quantity : 0;
    const shortfall = requested - covered;
    const coveredChange = covered === 0 ? decimal(0) : before.value === null ? null : before.value.negated();
    // A negative position already carries its own provisional unit cost.
    const unitCost = before.quantity < 0 && before.value !== null ? before.value.div(before.quantity) : input.provisionalUnitCost ?? null;
    const shortfallChange = unitCost === null ? null : precision(unitCost.mul(-shortfall));
    const change = sum(coveredChange, shortfallChange);
    const initial = before.quantity === 0 ? decimal(0) : before.value;
    const value = sum(initial, change);
    return { quantity, value, change, cogs: isCogsKind ? change?.negated() ?? null : decimal(0),
      costStatus: change === null ? 'UNKNOWN' : 'ESTIMATED' };
  }

  // Inflow into a negative position: fill the shortfall first.
  if (input.quantity > 0 && before.quantity < 0 && input.mode !== 'AVERAGE') {
    const inflowValue = input.inputValue ?? null;
    if (inflowValue === null) return { quantity, value: null, change: null, cogs: null, costStatus: 'UNKNOWN' };
    const hole = -before.quantity;
    const filled = Math.min(input.quantity, hole);
    const filledValue = filled === input.quantity ? inflowValue : precision(inflowValue.mul(filled).div(input.quantity));
    const remainderValue = precision(inflowValue.minus(filledValue));
    // Share of the (negative) provisional value this inflow cancels.
    const holeShare = before.value === null ? null : filled === hole ? before.value : precision(before.value.mul(filled).div(hole));
    const value = quantity > 0 ? remainderValue : quantity === 0 ? decimal(0)
      : before.value === null || holeShare === null ? null : precision(before.value.minus(holeShare));
    const change = before.value === null || value === null ? null : precision(value.minus(before.value));
    // An unknown shortfall had no booked cost, so its full actual cost is recognized now.
    const trueUp = holeShare === null ? filledValue : precision(filledValue.plus(holeShare));
    return { quantity, value, change, cogs: isCogsKind ? precision(trueUp.minus(inflowValue)) : trueUp, costStatus: 'VERIFIED' };
  }

  let change: Prisma.Decimal | null;
  if (input.mode === 'AVERAGE') {
    change = input.quantity === 0 ? decimal(0) : before.value === null ? null : input.quantity === -before.quantity ? before.value.negated()
      : before.quantity ? precision(before.value.mul(input.quantity).div(before.quantity)) : input.quantity ? null : decimal(0);
  } else change = input.inputValue ?? null;
  const initial = before.quantity === 0 ? decimal(0) : before.value;
  const value = quantity === 0 ? decimal(0) : initial === null || change === null ? null : precision(initial.plus(change));
  if (quantity >= 0 && value?.isNegative()) throw new AppError('This cost would produce a negative inventory value', 409);
  const cogs = isCogsKind ? change?.negated() ?? null : decimal(0);
  // Averaging out of a negative position uses its provisional unit cost.
  const costStatus: CostStatus = change === null ? 'UNKNOWN' : before.quantity < 0 ? 'ESTIMATED' : 'VERIFIED';
  return { quantity, value, change, cogs, costStatus };
}

/** Provisional unit cost when the records hold fewer units than were sold:
 * last valid average/receipt cost, then an owner-set provisional cost, then the
 * latest supplier price. Null only when no cost source exists. */
export function provisionalUnitCost(sources: { lastUnitCost?: Prisma.Decimal | null; provisionalUnitCost?: Prisma.Decimal | null; catalogCost?: Prisma.Decimal | null }) {
  for (const candidate of [sources.lastUnitCost, sources.provisionalUnitCost, sources.catalogCost]) {
    if (candidate !== null && candidate !== undefined && decimal(candidate).greaterThan(0)) return decimal(candidate);
  }
  return null;
}

/** Cumulative allocation gives the last returned/transferred unit any remainder. */
export function portion(value: Prisma.Decimal | null, quantity: number, offset: number, count: number) {
  if (value === null) return null;
  if (!quantity || offset < 0 || count < 0 || offset + count > quantity) throw new AppError('Invalid cost allocation quantity', 409);
  return precision(value.mul(offset + count).div(quantity)).minus(precision(value.mul(offset).div(quantity)));
}

export async function effectiveEntry(tx: Prisma.TransactionClient, id: string) {
  const entry = await tx.inventoryValueEntry.findUnique({ where: { id } });
  if (!entry) throw new AppError('Original inventory cost record is unavailable', 409);
  const revision = await tx.inventoryCostRevision.findFirst({ where: { entryId: id }, orderBy: { sequence: 'desc' } });
  return { ...entry, ...(revision ? { inputValue: revision.inputValue, valueBefore: revision.valueBefore,
    valueChange: revision.valueChange, valueAfter: revision.valueAfter, cogsAmount: revision.cogsAmount } : {}) };
}

export type ValuePosting = {
  productId: string; locationId: string; userId: string; type: string; sourceId?: string; sourceKey?: string;
  valueInput?: Prisma.Decimal.Value | null; valueMode?: 'AVERAGE' | 'FIXED' | 'OPENING' | 'REFERENCE';
  referenceEntryId?: string | null; referenceQuantity?: number; referenceOffset?: number;
  notes?: string; forceUnknown?: boolean;
  costKind?: string;
};

/** Caller holds the product lock and owns the enclosing business transaction. */
export async function postInventoryValue(tx: Prisma.TransactionClient, posting: ValuePosting, previousQty: number, newQty: number) {
  let balance = await tx.inventoryValuation.findUnique({ where: { productId: posting.productId } });
  if (!balance) {
    const baseline = await tx.inventoryValueEntry.create({ data: {
      productId: posting.productId, locationId: posting.locationId, userId: posting.userId,
      kind: 'BASELINE', mode: 'OPENING', sourceId: posting.productId, sourceKey: 'baseline:' + posting.productId,
      quantity: previousQty, quantityBefore: 0, quantityAfter: previousQty, inputValue: previousQty ? null : 0,
      valueBefore: 0, valueChange: previousQty ? null : 0, valueAfter: previousQty ? null : 0, cogsAmount: 0,
      notes: previousQty ? 'Existing stock requires an owner-confirmed opening value.' : 'Empty inventory.',
    } });
    balance = await tx.inventoryValuation.create({ data: { productId: posting.productId, locationId: posting.locationId,
      quantity: previousQty, value: previousQty ? null : 0, lastEntryId: baseline.id } });
  }
  if (balance.quantity !== previousQty) throw new AppError('Inventory quantities need reconciliation before this operation', 409);
  const quantity = newQty - previousQty;
  const mode = posting.valueMode ?? (quantity <= 0 ? 'AVERAGE' : ['COUNT', 'CYCLE_COUNT'].includes(posting.type) ? 'AVERAGE' : 'FIXED');
  let inputValue = posting.valueInput === undefined || posting.valueInput === null ? null : precision(decimal(posting.valueInput));
  if (mode === 'REFERENCE') {
    if (!posting.referenceEntryId) throw new AppError('The original cost reference is required', 409);
    const source = await effectiveEntry(tx, posting.referenceEntryId);
    const referenceValue = ['SALE', 'OFFLINE_SALE'].includes(source.kind) ? source.cogsAmount : source.valueChange?.abs() ?? null;
    inputValue = portion(referenceValue, Math.abs(source.quantity) || source.referenceQuantity || 0, posting.referenceOffset ?? 0, posting.referenceQuantity ?? Math.abs(quantity));
    if (quantity < 0) inputValue = inputValue?.negated() ?? null;
  }
  // Only an outflow beyond recorded stock needs a provisional unit cost.
  let provisional: Prisma.Decimal | null = null;
  if (quantity < 0 && newQty < 0 && !(previousQty < 0 && balance.value !== null)) {
    const product = await tx.product.findUnique({ where: { id: posting.productId }, select: { cost: true, provisionalUnitCost: true } });
    // Crossing zero from a valued positive balance uses that balance's average.
    const average = previousQty > 0 && balance.value !== null ? balance.value.div(previousQty) : null;
    provisional = provisionalUnitCost({ lastUnitCost: average ?? balance.lastUnitCost, provisionalUnitCost: product?.provisionalUnitCost, catalogCost: product?.cost });
  }
  const result = valueMovement({ quantity: previousQty, value: balance.value }, { quantity, mode, inputValue, kind: posting.type, provisionalUnitCost: provisional });
  // An offline sale consumes today's stock; today's cost is only an estimate of
  // its cost at the earlier sale time, so it is booked and flagged ESTIMATED.
  const costStatus: CostStatus = posting.forceUnknown ? (result.cogs === null ? 'UNKNOWN' : 'ESTIMATED') : result.costStatus;
  const entry = await tx.inventoryValueEntry.create({ data: {
    productId: posting.productId, locationId: posting.locationId, userId: posting.userId,
    kind: posting.forceUnknown ? 'OFFLINE_SALE' : posting.type, mode, sourceId: posting.sourceId || randomUUID(),
    sourceKey: posting.sourceKey || `${posting.type}:${posting.sourceId || randomUUID()}:${posting.productId}`,
    quantity, quantityBefore: previousQty, quantityAfter: newQty, inputValue, valueBefore: balance.value,
    valueChange: result.change, valueAfter: result.value, cogsAmount: result.cogs, costStatus,
    referenceEntryId: posting.referenceEntryId, referenceQuantity: posting.referenceQuantity, referenceOffset: posting.referenceOffset ?? 0,
    notes: posting.notes,
  } });
  // Remember the last trustworthy unit cost for future shortfalls.
  const lastUnitCost = newQty > 0 && result.value !== null ? precision(result.value.div(newQty))
    : quantity > 0 && inputValue !== null && inputValue.greaterThan(0) ? precision(inputValue.div(quantity)) : balance.lastUnitCost;
  await tx.inventoryValuation.update({ where: { productId: posting.productId }, data: { quantity: newQty, value: result.value,
    lastEntryId: entry.id, lastUnitCost, ...(mode === 'OPENING' && result.value !== null ? { verifiedAt: new Date() } : {}) } });
  return entry;
}

/** A read-only quote used only while the checkout transaction holds product locks. */
export async function saleCost(tx: Prisma.TransactionClient, product: { id: string; stockQuantity: number; trackInventory: boolean; verifiedUnitCost: Prisma.Decimal | null }, quantity: number) {
  if (!product.trackInventory) return product.verifiedUnitCost === null ? null : precision(product.verifiedUnitCost.mul(quantity));
  const balance = await tx.inventoryValuation.findUnique({ where: { productId: product.id } });
  if (!balance || balance.value === null) return null;
  return valueMovement(balance, { quantity: -quantity, mode: 'AVERAGE', kind: 'SALE' }).change?.negated() ?? null;
}

export type ReplayEntry = InventoryValueEntry;

export async function postNonstockCost(tx: Prisma.TransactionClient, input: {
  productId: string; locationId: string; userId: string; sourceId: string; sourceKey: string; kind: string;
  quantity: number; cost: Prisma.Decimal | null; referenceEntryId?: string | null; referenceOffset?: number;
}) {
  let cost = input.cost;
  if (input.referenceEntryId) {
    const original = await effectiveEntry(tx, input.referenceEntryId);
    cost = portion(original.cogsAmount, original.referenceQuantity || Math.abs(original.quantity), input.referenceOffset || 0, input.quantity);
  }
  const cogs = ['RETURN','VOID_RETURN'].includes(input.kind) ? cost?.negated() ?? null : cost;
  return tx.inventoryValueEntry.create({ data: { productId: input.productId, locationId: input.locationId, userId: input.userId,
    kind: input.kind, mode: 'NONSTOCK', sourceId: input.sourceId, sourceKey: input.sourceKey, quantity: 0, quantityBefore: 0, quantityAfter: 0,
    valueBefore: 0, valueChange: 0, valueAfter: 0, inputValue: cogs, cogsAmount: cogs,
    referenceEntryId: input.referenceEntryId, referenceQuantity: input.quantity, referenceOffset: input.referenceOffset || 0 } });
}
