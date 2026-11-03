import { Prisma } from '@prisma/client';
import { dateCondition, MetricRange, recordedSaleSql, SaleCriteria, saleScope, summarizeFinancialMetrics } from './financialMetrics.service';

type Scope = { locationId?: string; userId?: string; criteria?: SaleCriteria };
type QueryClient = Pick<Prisma.TransactionClient, '$queryRaw'>;

/** The sales collection report consumes receipt totals, not inventory margins or
 * expense obligations. Read only those facts; use the shared financial formulas
 * and filters so missing refund tax and legacy void warnings keep their meaning.
 */
export async function getSalesCollectionMetrics(scope: Scope, range: MetricRange, db: QueryClient, options: { includeUnbookedRows?: boolean } = {}) {
  const visible = options.includeUnbookedRows ? Prisma.sql`TRUE` : recordedSaleSql;
  const [row] = await db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
    WITH selected_originals AS MATERIALIZED (
      SELECT s."sourceType", s.total::numeric, s.tax::numeric, s.discount::numeric, ${recordedSaleSql} AS booked FROM sales s
      WHERE ${visible} AND ${saleScope(scope)} AND ${dateCondition(Prisma.sql`s."createdAt"`, range)}
    ), sold AS (
      SELECT "sourceType", total, tax, discount FROM selected_originals WHERE booked
    ), returned AS (
      SELECT r.amount::numeric, r."taxAmount" FROM refunds r JOIN sales s ON s.id = r."saleId"
      WHERE s.status IN ('COMPLETED', 'REFUNDED') AND ${saleScope(scope)}
        AND ${dateCondition(Prisma.sql`r."createdAt"`, range)}
    ), voided AS (
      SELECT v.amount, v."taxAmount", ${visible} AS visible FROM sale_voids v JOIN sales s ON s.id = v."saleId"
      WHERE ${saleScope(scope)} AND ${dateCondition(Prisma.sql`v."createdAt"`, range)}
    ) SELECT
      (SELECT COALESCE(SUM(total), 0) FROM sold) AS collected,
      (SELECT COALESCE(SUM(tax), 0) FROM sold) AS tax,
      (SELECT COALESCE(SUM(discount), 0) FROM sold) AS discounts,
      (SELECT COUNT(*) FROM sold WHERE "sourceType" = 'RECEIPT') AS transactions,
      (SELECT COUNT(*) FROM sold WHERE "sourceType" = 'DAILY_SUMMARY') AS "historicalSummaries",
      (SELECT COALESCE(SUM(amount), 0) FROM returned) AS refunds,
      (SELECT COUNT(*) FROM returned) AS "refundCount",
      (SELECT COALESCE(SUM("taxAmount"), 0) FROM returned) AS "refundTax",
      (SELECT COUNT(*) FROM returned WHERE "taxAmount" IS NULL) AS "missingTax",
      (SELECT COALESCE(SUM(amount), 0) FROM voided) AS voids,
      (SELECT COUNT(*) FROM voided) AS "voidCount",
      (SELECT COALESCE(SUM("taxAmount"), 0) FROM voided) AS "voidTax",
      (SELECT COUNT(*) FROM selected_originals) AS "saleRows",
      (SELECT COUNT(*) FROM voided WHERE visible) AS "voidRows",
      (SELECT COUNT(*) FROM sales s WHERE s.status = 'VOIDED' AND ${saleScope(scope)}
        AND NOT EXISTS (SELECT 1 FROM sale_voids v WHERE v."saleId" = s.id)
        AND ${dateCondition(Prisma.sql`s."createdAt"`, { lt: range.lt, lte: range.lte })}) AS "legacyVoids"
  `);
  const { netCollected, grossCollected, refunds, refundCount, voids, voidCount, transactions, netTax, netSales, discounts, historyWarning, historicalSummaries } = summarizeFinancialMetrics(row);
  // Cost/profit fields from the full summarizer are deliberately not exposed:
  // this query has not loaded the original inventory cost facts.
  return { netCollected, grossCollected, refunds, refundCount, voids, voidCount, transactions, netTax, netSales, discounts, historyWarning, historicalSummaries,
    // Explicit audit filters can expose PENDING/HOLD/undated VOIDED rows. They
    // count as visible rows while their booked financial contribution stays zero.
    entryCounts: { SALE: Number(row.saleRows || 0), REFUND: refundCount, VOID: Number(row.voidRows || 0) } };
}
