import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { dateCondition, MetricRange } from './financialMetrics.service';

type Reader = Pick<Prisma.TransactionClient, '$queryRaw'>;
/** An as-of statement uses posting dates and approved revisions of those facts. */
export async function inventoryReconciliation(locationId: string, range: MetricRange, db: Reader = prisma) {
  const rows = await db.$queryRaw<{ kind: string; value: Prisma.Decimal | null; quantity: bigint; entries: bigint; missing: bigint }[]>(Prisma.sql`
    SELECT kind, SUM("valueChange") AS value, SUM(quantity) AS quantity, COUNT(*) AS entries,
      COUNT(*) FILTER (WHERE "valueChange" IS NULL) AS missing
    FROM effective_inventory_values e WHERE e."locationId" = ${locationId} AND ${dateCondition(Prisma.sql`e."createdAt"`, range)}
    GROUP BY kind ORDER BY kind`);
  const balanceAt = async (bound: MetricRange) => {
    const [result] = await db.$queryRaw<{ value: Prisma.Decimal | null; knownValue: Prisma.Decimal; missing: bigint; quantity: bigint }[]>(Prisma.sql`
      WITH latest AS (SELECT DISTINCT ON ("productId") "productId", "valueAfter", "quantityAfter" FROM effective_inventory_values e
        WHERE e."locationId" = ${locationId} AND ${dateCondition(Prisma.sql`e."createdAt"`, bound)} ORDER BY "productId", sequence DESC),
      unstarted AS (SELECT p.id FROM products p WHERE p."locationId" = ${locationId} AND p."trackInventory" AND p."stockQuantity" > 0
        AND ${dateCondition(Prisma.sql`p."createdAt"`, bound)} AND NOT EXISTS (SELECT 1 FROM latest l WHERE l."productId" = p.id)),
      unknown_history AS (SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM latest) AND EXISTS (SELECT 1 FROM sales s
        WHERE s."locationId" = ${locationId} AND s."sourceType" = 'DAILY_SUMMARY' AND ${dateCondition(Prisma.sql`s."createdAt"`, { lt: range.lt, lte: range.lte })}) THEN 1 ELSE 0 END AS missing)
      SELECT CASE WHEN COUNT(*) FILTER (WHERE "valueAfter" IS NULL) > 0 OR (SELECT COUNT(*) FROM unstarted) > 0 OR (SELECT missing FROM unknown_history) > 0 THEN NULL ELSE COALESCE(SUM("valueAfter"),0) END AS value,
        COALESCE(SUM("valueAfter"),0) AS "knownValue", COUNT(*) FILTER (WHERE "valueAfter" IS NULL) + (SELECT COUNT(*) FROM unstarted) + (SELECT missing FROM unknown_history) AS missing,
        COALESCE(SUM("quantityAfter"),0) AS quantity FROM latest`);
    return { value: result.value === null ? null : Number(result.value), knownValue: Number(result.knownValue), missingProducts: Number(result.missing), quantity: Number(result.quantity) };
  };
  const opening = await balanceAt({ lt: range.gte || new Date(0) });
  const closing = await balanceAt({ lt: range.lt, lte: range.lte });
  const [transit] = await db.$queryRaw<{ value: Prisma.Decimal; missing: bigint; quantity: bigint }[]>(Prisma.sql`
    WITH flows AS (
      SELECT e.id, ABS(e.quantity) - COALESCE((SELECT SUM(COALESCE(r."referenceQuantity", ABS(r.quantity))) FROM effective_inventory_values r
        WHERE r."referenceEntryId" = e.id AND r.kind IN ('TRANSFER_IN','TRANSFER_RETURN','TRANSFER_LOSS') AND ${dateCondition(Prisma.sql`r."createdAt"`, { lt: range.lt, lte: range.lte })}),0) AS remaining,
        ABS(e."valueChange") AS cost, ABS(e.quantity) AS quantity,
        COALESCE((SELECT SUM(CASE WHEN r.kind = 'TRANSFER_LOSS' THEN r."inputValue" ELSE ABS(r."valueChange") END) FROM effective_inventory_values r
          WHERE r."referenceEntryId" = e.id AND r.kind IN ('TRANSFER_IN','TRANSFER_RETURN','TRANSFER_LOSS') AND ${dateCondition(Prisma.sql`r."createdAt"`, { lt: range.lt, lte: range.lte })}),0) AS resolved
      FROM effective_inventory_values e WHERE e."locationId" = ${locationId} AND e.kind = 'TRANSFER_OUT'
        AND ${dateCondition(Prisma.sql`e."createdAt"`, { lt: range.lt, lte: range.lte })})
    SELECT COALESCE(SUM(cost - resolved),0) AS value,
      COUNT(*) FILTER (WHERE cost IS NULL AND remaining > 0) AS missing, COALESCE(SUM(remaining),0) AS quantity FROM flows`);
  return { opening, movements: rows.map(row => ({ kind: row.kind, value: Number(row.missing) ? null : Number(row.value || 0), knownValue: Number(row.value || 0),
    quantity: Number(row.quantity), entries: Number(row.entries), missingEntries: Number(row.missing) })), closing,
    inTransit: { value: Number(transit.missing) ? null : Number(transit.value), quantity: Number(transit.quantity), missingEntries: Number(transit.missing) },
    complete: !opening.missingProducts && !closing.missingProducts && rows.every(row => !Number(row.missing)) && !Number(transit.missing) };
}
