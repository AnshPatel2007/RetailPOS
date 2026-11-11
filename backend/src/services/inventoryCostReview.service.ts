import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { AppError } from '../utils/errorHandler';
import { decimal, effectiveEntry, portion, valueMovement } from './inventoryCost.service';
import { lockInventory, moveInventory } from './inventory.service';

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export type OpeningInput = { idempotencyKey: string; notes: string; items: { productId: string; quantity: number; value: number; expectedVersion: number }[] };
export async function confirmOpening(tx: Prisma.TransactionClient, locationId: string, userId: string, input: OpeningInput) {
  const requestHash = hash(input);
  const replay = await tx.operationReceipt.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (replay) {
    if (replay.locationId !== locationId || replay.kind !== 'INVENTORY_OPENING' || replay.requestHash !== requestHash) throw new AppError('This retry key was used for a different operation', 409);
    return replay.result;
  }
  if (new Set(input.items.map(i => i.productId)).size !== input.items.length) throw new AppError('Select each product only once', 400);
  await lockInventory(tx, input.items.map(i => i.productId));
  for (const line of input.items) {
    const product = await tx.product.findUnique({ where: { id: line.productId } });
    if (!product || product.locationId !== locationId || !product.trackInventory) throw new AppError('Select tracked products at this store', 400);
    const verified = await tx.inventoryValueEntry.findFirst({ where: { productId: product.id, kind: 'OPENING' } });
    if (verified) throw new AppError('Opening inventory was already confirmed for ' + product.name + '. Use a cost correction.', 409);
    if (line.quantity === 0 && line.value !== 0) throw new AppError('Empty inventory must have zero value', 400);
    await moveInventory(tx, { productId: product.id, locationId, userId, type: 'OPENING', sourceId: input.idempotencyKey,
      sourceKey: 'opening:' + input.idempotencyKey + ':' + product.id, setQuantity: line.quantity, expectedVersion: line.expectedVersion,
      valueMode: 'OPENING', valueInput: line.value, notes: input.notes });
  }
  const [missing] = await tx.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*) AS count FROM products p LEFT JOIN inventory_valuations v ON v."productId" = p.id
    WHERE p."locationId" = ${locationId} AND p."trackInventory" AND p."isActive" AND (v."verifiedAt" IS NULL AND p."stockQuantity" > 0)`;
  const activated = Number(missing.count) === 0;
  if (activated) await tx.location.update({ where: { id: locationId }, data: { costingActivatedAt: new Date() } });
  const result = { confirmed: input.items.length, activated, remaining: Number(missing.count) };
  await tx.operationReceipt.create({ data: { idempotencyKey: input.idempotencyKey, kind: 'INVENTORY_OPENING', targetId: locationId, userId, locationId, requestHash, result } });
  return result;
}

export type CorrectionInput = { entryId: string; value: number; reason: string };
/** Re-derive the provisional unit cost a shortfall originally used: the corrected
 * average when crossing zero from stock, else the cost the posting recorded. */
function replayProvisional(before: { quantity: number; value: Prisma.Decimal | null }, row: { kind: string; quantity: number; quantityBefore: number; valueChange: Prisma.Decimal | null; unmatchedValue?: Prisma.Decimal | null }) {
  // An addition valued at a provisional cost keeps the unit cost it recorded.
  if (row.quantity > 0) {
    if (!row.unmatchedValue) return null;
    const units = row.kind !== 'UNMATCHED_RECEIPT' && row.quantityBefore < 0 ? Math.min(row.quantity, -row.quantityBefore) : row.quantity;
    return units ? row.unmatchedValue.div(units) : null;
  }
  if (before.quantity + row.quantity >= 0) return null;
  if (before.quantity > 0 && before.value !== null) return before.value.div(before.quantity);
  if (row.quantityBefore <= 0 && row.valueChange !== null) return row.valueChange.negated().div(-row.quantity);
  return null;
}
export async function previewCostCorrection(tx: Prisma.TransactionClient, locationId: string, input: CorrectionInput) {
  const source = await effectiveEntry(tx, input.entryId);
  if (source.locationId !== locationId) throw new AppError('Cost record not found at this store', 404);
  if (!['OPENING', 'BASELINE', 'PURCHASE', 'SALE', 'OFFLINE_SALE'].includes(source.kind) && !(source.quantity > 0 && ['ADJUSTMENT','IMPORT'].includes(source.kind))) throw new AppError('Correct the original receipt, opening value, documented addition or missing sale cost', 400);
  if (['SALE', 'OFFLINE_SALE'].includes(source.kind) && source.cogsAmount !== null) throw new AppError('Correct the original receipt to adjust an already recorded sale cost', 400);
  if (!source.quantityAfter && source.mode === 'OPENING' && input.value) throw new AppError('Empty inventory must have zero value', 400);
  // Bound replay work. Each affected product is replayed in original posting order,
  // including references carrying its cost into another store or a customer return.
  const rows = await tx.inventoryValueEntry.findMany({ where: { sequence: { gte: source.sequence } }, orderBy: { sequence: 'asc' }, take: 25001 });
  if (rows.length > 25000) throw new AppError('This correction spans more than 25,000 movements. Contact support for a reviewed period correction.', 409);
  const revisions = await tx.inventoryCostRevision.findMany({ where: { entryId: { in: rows.map(r => r.id) } }, orderBy: { sequence: 'desc' } });
  const latest = new Map<string, typeof revisions[number]>();
  for (const r of revisions) if (!latest.has(r.entryId)) latest.set(r.entryId, r);
  const effective = rows.map(row => { const r = latest.get(row.id); return r ? { ...row, inputValue: r.inputValue, valueBefore: r.valueBefore, valueChange: r.valueChange, valueAfter: r.valueAfter, cogsAmount: r.cogsAmount } : row; });
  const states = new Map<string, { quantity: number; value: Prisma.Decimal | null }>();
  const calculated = new Map<string, typeof source>();
  const changes: { entryId: string; productId: string; locationId: string; kind: string; sourceId: string; inputValue: Prisma.Decimal | null;
    valueBefore: Prisma.Decimal | null; valueChange: Prisma.Decimal | null; valueAfter: Prisma.Decimal | null; cogsAmount: Prisma.Decimal | null;
    previousCogs: Prisma.Decimal | null; previousValue: Prisma.Decimal | null; effectiveAt: Date }[] = [];
  const saleResolution = ['SALE', 'OFFLINE_SALE'].includes(source.kind);
  for (const row of effective) {
    // Current-period correction entries summarize revisions already present in
    // the replayed facts; replaying them again would count the change twice.
    if (row.kind === 'COST_CORRECTION') continue;
    // An invoice true-up revalues on-hand stock by a fixed amount; carry it.
    if (row.kind === 'UNMATCHED_TRUE_UP') {
      const prior = states.get(row.productId);
      if (prior) states.set(row.productId, { quantity: prior.quantity, value: prior.value === null || row.valueChange === null ? null : prior.value.plus(row.valueChange) });
      continue;
    }
    const reference = row.referenceEntryId ? calculated.get(row.referenceEntryId) : undefined;
    if (row.id !== source.id && !states.has(row.productId) && !reference) continue;
    const before = states.get(row.productId) || { quantity: row.quantityBefore, value: row.valueBefore };
    let inputValue = row.id === source.id ? decimal(input.value) : row.inputValue;
    if (reference) {
      const referencedValue = ['SALE', 'OFFLINE_SALE'].includes(reference.kind) ? reference.cogsAmount : reference.valueChange?.abs() ?? null;
      inputValue = portion(referencedValue, Math.abs(reference.quantity) || reference.referenceQuantity || 0, row.referenceOffset, row.referenceQuantity ?? Math.abs(row.quantity));
      if (row.quantity < 0 || (row.mode === 'NONSTOCK' && ['RETURN','VOID_RETURN'].includes(row.kind))) inputValue = inputValue?.negated() ?? null;
    }
    const result = row.id === source.id && saleResolution ? { quantity: row.quantityAfter, value: row.valueAfter, change: row.valueChange, cogs: decimal(input.value) }
      : valueMovement(before, { quantity: row.quantity, mode: row.mode, inputValue, kind: row.kind, provisionalUnitCost: replayProvisional(before, row) });
    if (row.kind === 'OFFLINE_SALE' && !(row.id === source.id && saleResolution)) result.cogs = row.cogsAmount;
    const next = { ...row, inputValue, valueBefore: before.value, valueChange: result.change, valueAfter: result.value, cogsAmount: result.cogs };
    calculated.set(row.id, next);
    states.set(row.productId, { quantity: result.quantity, value: result.value });
    if (hash([row.valueBefore, row.valueChange, row.valueAfter, row.cogsAmount, row.inputValue]) !== hash([next.valueBefore, next.valueChange, next.valueAfter, next.cogsAmount, next.inputValue]))
      changes.push({ entryId: row.id, productId: row.productId, locationId: row.locationId, kind: row.kind, sourceId: row.sourceId,
        inputValue, valueBefore: next.valueBefore, valueChange: next.valueChange, valueAfter: next.valueAfter, cogsAmount: next.cogsAmount,
        previousCogs: row.cogsAmount, previousValue: row.valueAfter, effectiveAt: row.effectiveAt });
  }
  const balances = [...states].map(([productId, state]) => ({ productId, ...state }));
  const token = hash({ input, changes, balances, watermark: rows.at(-1)?.sequence, revisions: revisions.map(r => r.id) });
  // Filling a cost that was never recorded restates its (incomplete) period;
  // changing an already-booked cost is recognized when confirmed.
  const fillsMissing = saleResolution || source.inputValue === null;
  const recognition = fillsMissing ? 'RESTATED' : 'CURRENT_PERIOD';
  return { token, changes, balances, source, recognition,
    explanation: fillsMissing
      ? 'This fills a missing cost in its original period (that period was reported as incomplete). Booked sales remain unchanged.'
      : 'This records an audit entry and recognizes the cost difference in the current period. Earlier reports stay unchanged; booked sales remain unchanged.' };
}

export async function confirmCostCorrection(tx: Prisma.TransactionClient, locationId: string, userId: string,
  input: CorrectionInput & { idempotencyKey: string; token: string }) {
  const requestHash = hash(input);
  const replay = await tx.inventoryCostCorrection.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (replay) {
    if (replay.locationId !== locationId || replay.requestHash !== requestHash) throw new AppError('This retry key belongs to a different correction', 409);
    return { id: replay.id, replayed: true };
  }
  const clean = { entryId: input.entryId, value: input.value, reason: input.reason };
  const preliminary = await previewCostCorrection(tx, locationId, clean);
  await lockInventory(tx, preliminary.balances.map(b => b.productId));
  const preview = await previewCostCorrection(tx, locationId, clean);
  if (preview.token !== input.token) throw new AppError('Inventory changed. Review a fresh correction preview before confirming.', 409);
  const correction = await tx.inventoryCostCorrection.create({ data: { locationId, userId, sourceEntryId: input.entryId,
    inputValue: input.value, reason: input.reason, idempotencyKey: input.idempotencyKey, requestHash, preview: json(preview),
    recognition: preview.recognition } });
  for (const row of preview.changes) await tx.inventoryCostRevision.create({ data: { correctionId: correction.id, entryId: row.entryId,
    inputValue: row.inputValue, valueBefore: row.valueBefore, valueChange: row.valueChange, valueAfter: row.valueAfter, cogsAmount: row.cogsAmount } });
  if (preview.recognition === 'CURRENT_PERIOD') {
    // One dated entry per product carries the sold share of the difference into
    // this period as COGS. The on-hand share is already in the revised balance
    // (and the revisions the valuation view reads), so the entry restates no value.
    const cogsDelta = new Map<string, Prisma.Decimal | null>();
    for (const row of preview.changes) {
      const prior = cogsDelta.has(row.productId) ? cogsDelta.get(row.productId)! : decimal(0);
      const delta = row.cogsAmount === null || row.previousCogs === null ? (row.cogsAmount === row.previousCogs ? decimal(0) : null)
        : row.cogsAmount.minus(row.previousCogs);
      cogsDelta.set(row.productId, prior === null || delta === null ? null : prior.plus(delta));
    }
    for (const balance of preview.balances) {
      const current = await tx.inventoryValuation.findUnique({ where: { productId: balance.productId } });
      if (!current) continue;
      const product = await tx.product.findUnique({ where: { id: balance.productId }, select: { locationId: true } });
      const cogs = cogsDelta.get(balance.productId) ?? decimal(0);
      if (cogs?.isZero()) continue;
      await tx.inventoryValueEntry.create({ data: { productId: balance.productId, locationId: product?.locationId || locationId, userId,
        kind: 'COST_CORRECTION', mode: 'CORRECTION', sourceId: correction.id, sourceKey: 'cost-correction:' + correction.id + ':' + balance.productId,
        quantity: 0, quantityBefore: current.quantity, quantityAfter: current.quantity, inputValue: null,
        valueBefore: balance.value, valueChange: 0, valueAfter: balance.value, cogsAmount: cogs, costStatus: cogs === null ? 'UNKNOWN' : 'VERIFIED',
        notes: input.reason } });
    }
  }
  for (const balance of preview.balances) await tx.inventoryValuation.updateMany({ where: { productId: balance.productId }, data: { value: balance.value,
    ...(balance.quantity > 0 && balance.value !== null ? { lastUnitCost: balance.value.div(balance.quantity).toDecimalPlaces(8) } : {}) } });
  return { id: correction.id, affectedEntries: preview.changes.length, recognition: preview.recognition, replayed: false };
}

export async function supplierReturn(tx: Prisma.TransactionClient, locationId: string, userId: string,
  input: { receiptEntryId: string; quantity: number; creditAmount: number; reason: string; idempotencyKey: string }) {
  const requestHash = hash(input);
  const previous = await tx.supplierReturn.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (previous) {
    if (previous.locationId !== locationId || previous.requestHash !== requestHash) throw new AppError('This retry key belongs to a different supplier return', 409);
    return previous;
  }
  const receipt = await effectiveEntry(tx, input.receiptEntryId);
  if (receipt.kind !== 'PURCHASE' || receipt.locationId !== locationId) throw new AppError('Select the original receipt at this store', 400);
  await lockInventory(tx, [receipt.productId]);
  const returned = await tx.supplierReturn.aggregate({ where: { receiptEntryId: receipt.id }, _sum: { quantity: true } });
  if (input.quantity + (returned._sum.quantity || 0) > receipt.quantity) throw new AppError('Return exceeds the original received quantity', 400);
  const moved = await moveInventory(tx, { productId: receipt.productId, locationId, userId, type: 'SUPPLIER_RETURN', reason: 'SUPPLIER_RETURN',
    sourceId: input.idempotencyKey, sourceKey: 'supplier-return:' + input.idempotencyKey, quantity: -input.quantity, notes: input.reason });
  const carryingValue = moved.inventoryEntry.valueChange?.negated() ?? null;
  const costAdjustment = carryingValue?.minus(input.creditAmount) ?? null;
  return tx.supplierReturn.create({ data: { ...input, productId: receipt.productId, locationId, userId, carryingValue, costAdjustment, requestHash } });
}
