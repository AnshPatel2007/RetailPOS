import { InventoryValueEntry, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AppError } from '../utils/errorHandler';
Prisma.Decimal.set({ precision: 40 });

// Eight decimal places are retained until reporting. All calculations use decimal
// arithmetic; exhausting a balance consumes its entire value, including residue.
export const decimal = (n: Prisma.Decimal.Value) => new Prisma.Decimal(n);
export const precision = (n: Prisma.Decimal) => n.toDecimalPlaces(8, Prisma.Decimal.ROUND_HALF_UP);
export type CostState = { quantity: number; value: Prisma.Decimal | null };
export type CostInput = { quantity: number; mode: string; inputValue?: Prisma.Decimal | null; kind: string };
export function valueMovement(before: CostState, input: CostInput) {
  const quantity = before.quantity + input.quantity;
  if (quantity < 0) throw new AppError('Inventory cannot be negative', 409);
  if (input.mode === 'NONSTOCK') return { quantity, value: before.value, change: decimal(0), cogs: input.inputValue ?? null };
  if (['TRANSFER_LOSS', 'RETURN_LOSS'].includes(input.kind)) return { quantity, value: before.value, change: decimal(0),
    cogs: input.kind === 'TRANSFER_LOSS' ? input.inputValue ?? null : decimal(0) };
  let change: Prisma.Decimal | null;
  if (input.mode === 'OPENING') {
    const after = input.inputValue ?? null;
    change = before.value === null || after === null ? null : precision(after.minus(before.value));
    return { quantity, value: after, change, cogs: decimal(0) };
  }
  if (input.mode === 'AVERAGE') {
    change = input.quantity === 0 ? decimal(0) : before.value === null ? null : input.quantity === -before.quantity ? before.value.negated()
      : before.quantity ? precision(before.value.mul(input.quantity).div(before.quantity)) : input.quantity ? null : decimal(0);
  } else change = input.inputValue ?? null;
  const initial = before.quantity === 0 ? decimal(0) : before.value;
  const value = quantity === 0 ? decimal(0) : initial === null || change === null ? null : precision(initial.plus(change));
  if (value?.isNegative()) throw new AppError('This cost would produce a negative inventory value', 409);
  const cogsKinds = ['SALE', 'RETURN', 'VOID_RETURN', 'ADJUSTMENT', 'COUNT', 'CYCLE_COUNT', 'STOCK_LOSS', 'IMPORT'];
  const cogs = cogsKinds.includes(input.kind) ? change?.negated() ?? null : decimal(0);
  return { quantity, value, change, cogs };
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
  const result = valueMovement({ quantity: previousQty, value: balance.value }, { quantity, mode, inputValue, kind: posting.type });
  // An offline sale consumes today's stock, but it cannot establish a historical
  // sale cost. Its physical depletion and unavailable sale snapshot are distinct.
  const entry = await tx.inventoryValueEntry.create({ data: {
    productId: posting.productId, locationId: posting.locationId, userId: posting.userId,
    kind: posting.forceUnknown ? 'OFFLINE_SALE' : posting.type, mode, sourceId: posting.sourceId || randomUUID(),
    sourceKey: posting.sourceKey || `${posting.type}:${posting.sourceId || randomUUID()}:${posting.productId}`,
    quantity, quantityBefore: previousQty, quantityAfter: newQty, inputValue, valueBefore: balance.value,
    valueChange: result.change, valueAfter: result.value, cogsAmount: posting.forceUnknown ? null : result.cogs,
    referenceEntryId: posting.referenceEntryId, referenceQuantity: posting.referenceQuantity, referenceOffset: posting.referenceOffset ?? 0,
    notes: posting.notes,
  } });
  await tx.inventoryValuation.update({ where: { productId: posting.productId }, data: { quantity: newQty, value: result.value,
    lastEntryId: entry.id, ...(mode === 'OPENING' && result.value !== null ? { verifiedAt: new Date() } : {}) } });
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
