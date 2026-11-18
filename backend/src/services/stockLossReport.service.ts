import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { dateCondition, MetricRange } from './financialMetrics.service';

type Reader = Pick<Prisma.TransactionClient, '$queryRaw'>;
const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/** Real losses: stock that left the store without being sold. */
export const LOSS_CAUSES = ['DAMAGED', 'EXPIRED', 'WASTE', 'THEFT', 'LOST', 'COUNT_SHORTFALL', 'TRANSFER_LOSS', 'OTHER', 'NOT_RECORDED'] as const;
export type LossCause = typeof LOSS_CAUSES[number];
/** Paper corrections: the records were wrong, the stock was not lost. */
export const CORRECTION_KINDS = ['WRONG_PRODUCT', 'LATE_DELIVERY', 'UNSCANNED_SALE'] as const;
export type CorrectionKind = typeof CORRECTION_KINDS[number];
export const STOCK_LOSS_LABELS: Record<LossCause | CorrectionKind, string> = {
  DAMAGED: 'Damaged', EXPIRED: 'Expired', WASTE: 'Waste', THEFT: 'Theft', LOST: 'Lost', COUNT_SHORTFALL: 'Count shortfall',
  TRANSFER_LOSS: 'Lost or damaged in a transfer', OTHER: 'Other', NOT_RECORDED: 'Reason not recorded',
  WRONG_PRODUCT: 'Wrong product rung up', LATE_DELIVERY: 'Deliveries entered late', UNSCANNED_SALE: 'Items sold without scanning',
};

const namedLosses = ['DAMAGED', 'EXPIRED', 'WASTE', 'THEFT', 'LOST'];
const wrongProduct = ['WRONG_SKU_SOLD', 'RECEIVED_AS_OTHER', 'RETURNED_AS_OTHER'];
const countReasons = ['MANUAL_COUNT', 'MISCOUNT', 'COUNT_DIFFERENCE', 'CORRECTION', 'NO_CHANGE_NEEDED', 'STOCK_FILE_IMPORT'];
// The stock log of an older row can name the kind of movement instead of a cause.
const movementWords = ['ADJUSTMENT', 'COUNT', 'CYCLE_COUNT', 'EXCEPTION_COUNT', 'IMPORT', 'STOCK_LOSS'];

/**
 * Where one stock decrease belongs. `kind` is how the entry was costed; `reason`
 * is why it happened (null when nobody recorded it).
 */
export function classifyStockDecrease(kind: string, reason: string | null):
  { group: 'LOSS'; cause: LossCause } | { group: 'CORRECTION'; cause: CorrectionKind } {
  const cause = reason && !movementWords.includes(reason) ? reason : null;
  if (kind === 'TRANSFER_LOSS') return { group: 'LOSS', cause: 'TRANSFER_LOSS' };
  if (kind === 'UNRECORDED_SALE') return { group: 'CORRECTION', cause: 'UNSCANNED_SALE' };
  if (cause && wrongProduct.includes(cause)) return { group: 'CORRECTION', cause: 'WRONG_PRODUCT' };
  if (cause && namedLosses.includes(cause)) return { group: 'LOSS', cause: cause as LossCause };
  if (['COUNT', 'CYCLE_COUNT', 'IMPORT'].includes(kind) || (cause && countReasons.includes(cause))) return { group: 'LOSS', cause: 'COUNT_SHORTFALL' };
  return { group: 'LOSS', cause: cause ? 'OTHER' : 'NOT_RECORDED' };
}

type Bucket = { events: number; units: number; known: number; missing: number };
const empty = (): Bucket => ({ events: 0, units: 0, known: 0, missing: 0 });
const add = (bucket: Bucket, row: { events: unknown; units: unknown; amount: unknown; missing: unknown }) => {
  bucket.events += Number(row.events); bucket.units += Number(row.units || 0);
  bucket.known += Number(row.amount || 0); bucket.missing += Number(row.missing);
};
/** A cost that is not on record stays unavailable; it is never counted as zero. */
const line = (bucket: Bucket) => ({ events: bucket.events, units: bucket.units,
  amount: bucket.missing ? null : money(bucket.known), knownAmount: money(bucket.known), missingValues: bucket.missing });

/**
 * Stock losses for one store and period, at cost, by cause; and separately the
 * paper corrections that changed the records without any stock being lost.
 *
 * A row written before causes were stored takes its cause from the resolved
 * stock exception or the stock log; with neither it is "Reason not recorded".
 * Costs use approved cost revisions (the same view the P&L reads).
 */
export async function getStockLossReport(locationId: string, range: MetricRange, db: Reader = prisma) {
  const rows = await db.$queryRaw<{ kind: string; reason: string | null; direction: string; events: bigint; units: bigint | null; amount: Prisma.Decimal | null; missing: bigint }[]>(Prisma.sql`
    WITH entries AS (
      SELECT e.kind, COALESCE(b.reason, x.resolution, l.type) AS reason,
        CASE WHEN e.kind = 'TRANSFER_LOSS' OR e.quantity < 0 THEN 'DOWN' ELSE 'UP' END AS direction,
        CASE WHEN e.kind = 'TRANSFER_LOSS' THEN COALESCE(e."referenceQuantity", 0) ELSE ABS(e.quantity) END AS units,
        CASE WHEN e.kind = 'TRANSFER_LOSS' THEN e."cogsAmount"   -- the stock left at shipping; the loss is booked here
          WHEN e.kind = 'UNMATCHED_RECEIPT' THEN e."valueChange"  -- value of goods added without an invoice
          WHEN e.quantity > 0 THEN -e."cogsAmount"                -- stock found above the records
          ELSE -e."valueChange" END AS amount
      FROM reported_inventory_values e
      JOIN inventory_value_entries b ON b.id = e.id
      LEFT JOIN LATERAL (SELECT x.resolution FROM inventory_exceptions x WHERE x."adjustmentEntryId" = e.id LIMIT 1) x ON TRUE
      LEFT JOIN LATERAL (SELECT l.type FROM inventory_logs l WHERE l."productId" = e."productId" AND l."sourceId" IN (e.id, e."sourceId")
        ORDER BY l."createdAt", l.id LIMIT 1) l ON TRUE
      WHERE e."locationId" = ${locationId} AND e.mode <> 'NONSTOCK' AND ${dateCondition(Prisma.sql`e."createdAt"`, range)}
        AND ((e.kind IN ('STOCK_LOSS','ADJUSTMENT','COUNT','CYCLE_COUNT','IMPORT','UNRECORDED_SALE') AND e.quantity < 0)
          OR e.kind = 'TRANSFER_LOSS'
          OR (e.kind IN ('ADJUSTMENT','COUNT','CYCLE_COUNT','IMPORT') AND e.quantity > 0 AND e."cogsAmount" < 0)
          OR (e.kind = 'UNMATCHED_RECEIPT' AND e.quantity > 0))
    )
    SELECT kind, reason, direction, COUNT(*) AS events, SUM(units) AS units, SUM(amount) AS amount,
      COUNT(*) FILTER (WHERE amount IS NULL) AS missing
    FROM entries GROUP BY kind, reason, direction`);
  // Wrong-product fixes are kept in their own ledger: one row per correction, both products.
  const [reclassed] = await db.$queryRaw<{ events: bigint; units: bigint | null; amount: Prisma.Decimal | null; missing: bigint }[]>(Prisma.sql`
    SELECT COUNT(*) AS events, SUM(r.quantity) AS units, SUM(ABS(f."valueChange")) AS amount,
      COUNT(*) FILTER (WHERE f."valueChange" IS NULL) AS missing
    FROM stock_reclasses r JOIN reported_inventory_values f ON f.id = r."fromEntryId"
    WHERE r."locationId" = ${locationId} AND ${dateCondition(Prisma.sql`r."createdAt"`, range)}`);

  const losses = new Map<LossCause, Bucket>(), corrections = new Map<CorrectionKind, Bucket>(), found = empty();
  const bucket = <Key>(map: Map<Key, Bucket>, key: Key) => map.get(key) ?? map.set(key, empty()).get(key)!;
  for (const row of rows) {
    if (row.kind === 'UNMATCHED_RECEIPT') add(bucket(corrections, 'LATE_DELIVERY'), row);
    else if (row.direction === 'UP') add(found, row);
    else {
      const place = classifyStockDecrease(row.kind, row.reason);
      add(place.group === 'LOSS' ? bucket(losses, place.cause) : bucket(corrections, place.cause), row);
    }
  }
  if (Number(reclassed.events)) add(bucket(corrections, 'WRONG_PRODUCT'), reclassed);

  const total = [...losses.values()].reduce((sum, item) => ({ events: sum.events + item.events, units: sum.units + item.units,
    known: sum.known + item.known, missing: sum.missing + item.missing }), empty());
  const totals = line(total), foundLine = line(found);
  return {
    losses: LOSS_CAUSES.filter(cause => losses.has(cause)).map(cause => ({ cause, label: STOCK_LOSS_LABELS[cause], ...line(losses.get(cause)!) })),
    total: totals,
    // Stock a count found above the records. It offsets count shortfalls; it is not income.
    found: foundLine,
    netLoss: totals.amount === null || foundLine.amount === null ? null : money(totals.amount - foundLine.amount),
    corrections: CORRECTION_KINDS.filter(kind => corrections.has(kind)).map(kind => ({ kind, label: STOCK_LOSS_LABELS[kind], ...line(corrections.get(kind)!) })),
  };
}
