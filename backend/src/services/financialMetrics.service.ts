import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../utils/errorHandler';
import { inventoryPurchaseCategory } from './expenseAccounting.service';

export type MetricRange = { gte?: Date; lt?: Date; lte?: Date };
export type SaleCriteria = { shiftIds?: string[]; userIds?: string[]; paymentMethods?: string[]; statuses?: string[]; customerId?: string; minAmount?: number; maxAmount?: number; search?: string };
type Scope = { locationId?: string; userId?: string; criteria?: SaleCriteria };
type QueryClient = Pick<Prisma.TransactionClient, '$queryRaw'>;
const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const value = (input: unknown) => Number(input || 0);
export const recordedSaleWhere: Prisma.SaleWhereInput = { OR: [
  { status: { in: ['COMPLETED', 'REFUNDED'] } }, { status: 'VOIDED', voidEvent: { isNot: null } },
] };
export const recordedSaleSql = Prisma.sql`(s.status IN ('COMPLETED', 'REFUNDED') OR (s.status = 'VOIDED' AND EXISTS (SELECT 1 FROM sale_voids v WHERE v."saleId" = s.id)))`;

export function dateCondition(column: Prisma.Sql, range?: MetricRange) {
  if (!range) return Prisma.sql`TRUE`;
  const bounds = [range.gte, range.lt, range.lte].filter((date): date is Date => !!date);
  if (bounds.some(date => !Number.isFinite(date.getTime())) || (range.gte && (range.lt || range.lte) && range.gte > (range.lt || range.lte)!)) {
    throw new AppError('Select a valid date range', 400);
  }
  return Prisma.sql`${range.gte ? Prisma.sql`${column} >= (${range.gte}::timestamptz AT TIME ZONE 'UTC')` : Prisma.sql`TRUE`}
    AND ${range.lt ? Prisma.sql`${column} < (${range.lt}::timestamptz AT TIME ZONE 'UTC')` : Prisma.sql`TRUE`}
    AND ${range.lte ? Prisma.sql`${column} <= (${range.lte}::timestamptz AT TIME ZONE 'UTC')` : Prisma.sql`TRUE`}`;
}

export const saleScope = (scope: Scope) => Prisma.sql`
  ${scope.locationId ? Prisma.sql`s."locationId" = ${scope.locationId}` : Prisma.sql`s."locationId" IS NOT NULL`}
  AND ${scope.userId || scope.criteria?.userIds?.length || scope.criteria?.shiftIds?.length || scope.criteria?.customerId ? Prisma.sql`s."sourceType" = 'RECEIPT'` : Prisma.sql`TRUE`}
  AND ${scope.userId ? Prisma.sql`s."userId" = ${scope.userId}` : Prisma.sql`TRUE`}
  AND ${scope.criteria?.shiftIds?.length ? Prisma.sql`s."shiftId" IN (${Prisma.join(scope.criteria.shiftIds)})` : Prisma.sql`TRUE`}
  AND ${scope.criteria?.userIds?.length ? Prisma.sql`s."userId" IN (${Prisma.join(scope.criteria.userIds)})` : Prisma.sql`TRUE`}
  AND ${scope.criteria?.paymentMethods?.length ? Prisma.sql`s."paymentMethod"::text IN (${Prisma.join(scope.criteria.paymentMethods)})` : Prisma.sql`TRUE`}
  AND ${scope.criteria?.statuses?.length ? Prisma.sql`s.status::text IN (${Prisma.join(scope.criteria.statuses)})` : Prisma.sql`TRUE`}
  AND ${scope.criteria?.customerId ? Prisma.sql`s."customerId" = ${scope.criteria.customerId}` : Prisma.sql`TRUE`}
  AND ${scope.criteria?.minAmount !== undefined ? Prisma.sql`s.total >= ${scope.criteria.minAmount}` : Prisma.sql`TRUE`}
  AND ${scope.criteria?.maxAmount !== undefined ? Prisma.sql`s.total <= ${scope.criteria.maxAmount}` : Prisma.sql`TRUE`}
  AND ${scope.criteria?.search ? Prisma.sql`(POSITION(LOWER(${scope.criteria.search}) IN LOWER(s."saleNumber")) > 0 OR EXISTS (
    SELECT 1 FROM customers c WHERE c.id = s."customerId"
    AND ${scope.locationId ? Prisma.sql`c."locationId" = ${scope.locationId}` : Prisma.sql`c."locationId" IS NOT NULL`} AND (
      POSITION(LOWER(${scope.criteria.search}) IN LOWER(c."firstName" || ' ' || c."lastName")) > 0 OR
      POSITION(LOWER(${scope.criteria.search}) IN LOWER(COALESCE(c.email, ''))) > 0 OR
      POSITION(LOWER(${scope.criteria.search}) IN LOWER(COALESCE(c.phone, ''))) > 0)))` : Prisma.sql`TRUE`}`;

/** One definition for booked sales, return-period tax/cost and approved expenses.
 * Missing facts propagate as null, never as a guessed margin or zero cost.
 * Queries aggregate in PostgreSQL and read one statement snapshot.
 */
export async function getFinancialMetrics(scope: Scope, range?: MetricRange, db: QueryClient = prisma) {
  const [row] = await db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
    WITH sold AS (
      SELECT s.id, s."sourceType", s.total::numeric, s.tax::numeric, s.discount::numeric
      FROM sales s WHERE ${recordedSaleSql} AND ${saleScope(scope)}
        AND ${dateCondition(Prisma.sql`s."createdAt"`, range)}
    ), sold_lines AS MATERIALIZED (
      -- Reuse one scoped line rollup for cost and completeness. A generic
      -- prepared plan otherwise repeats line-existence and NULL-cost probes
      -- for every sale, even when the selected period contains many sales.
      SELECT i."saleId", SUM(CASE WHEN i."inventoryEntryId" IS NOT NULL THEN v."cogsAmount" ELSE COALESCE(i."costAmount", i."unitCost" * i.quantity) END) AS cost,
        SUM(COALESCE(i."costAmount", i."unitCost" * i.quantity, 0)) AS "bookedCost",
        -- Provisional cost for units sold beyond recorded stock (never zero cost).
        SUM(CASE WHEN i."costStatus" = 'ESTIMATED' THEN COALESCE(CASE WHEN i."inventoryEntryId" IS NOT NULL THEN v."cogsAmount" END, i."costAmount", 0) ELSE 0 END) AS "estimatedCost",
        BOOL_OR(CASE WHEN i."inventoryEntryId" IS NOT NULL THEN v."cogsAmount" IS NULL ELSE i."costAmount" IS NULL AND i."unitCost" IS NULL END) AS "missingCost"
      FROM sale_items i JOIN sold s ON s.id = i."saleId" LEFT JOIN reported_inventory_values v ON v.id = i."inventoryEntryId" GROUP BY i."saleId"
    ), returned AS (
      SELECT r.* FROM refunds r JOIN sales s ON s.id = r."saleId"
      WHERE s.status IN ('COMPLETED', 'REFUNDED') AND ${saleScope(scope)}
        AND ${dateCondition(Prisma.sql`r."createdAt"`, range)}
    ), voided AS (
      SELECT v.* FROM sale_voids v JOIN sales s ON s.id = v."saleId"
      WHERE ${saleScope(scope)} AND ${dateCondition(Prisma.sql`v."createdAt"`, range)}
    ), returned_costs AS (
      SELECT r.id, CASE WHEN e.id IS NOT NULL THEN -e."cogsAmount" ELSE i."costReturned" END AS cost
      FROM returned r LEFT JOIN refund_items i ON i."refundId" = r.id
      LEFT JOIN reported_inventory_values e ON e."sourceKey" = 'refund-line:' || r.id || ':' || i."saleItemId"
    ), void_costs AS (
      SELECT v.id, CASE WHEN EXISTS (SELECT 1 FROM reported_inventory_values e WHERE e."sourceKey" = 'void-line:' || i.id)
        THEN (SELECT -e."cogsAmount" FROM reported_inventory_values e WHERE e."sourceKey" = 'void-line:' || i.id)
        ELSE COALESCE(i."costAmount", i."unitCost" * i.quantity) END AS cost
      FROM voided v LEFT JOIN sale_items i ON i."saleId" = v."saleId"
    ), inventory_adjustments AS (
      SELECT e."cogsAmount" AS amount FROM reported_inventory_values e
      WHERE ${scope.locationId ? Prisma.sql`e."locationId" = ${scope.locationId}` : Prisma.sql`TRUE`}
        AND ${scope.userId || scope.criteria ? Prisma.sql`FALSE` : Prisma.sql`TRUE`}
        AND (e.kind IN ('ADJUSTMENT','COUNT','CYCLE_COUNT','STOCK_LOSS','IMPORT','TRANSFER_LOSS','COST_CORRECTION','SKU_CORRECTION')
          -- Receipts into negative stock true up provisional sale costs in their own period.
          OR (e.kind IN ('PURCHASE','TRANSFER_IN','TRANSFER_RETURN') AND e."cogsAmount" <> 0))
        AND ${dateCondition(Prisma.sql`e."createdAt"`, range)}
      UNION ALL SELECT -e."valueChange" - r."creditAmount" FROM supplier_returns r
        JOIN reported_inventory_values e ON e."sourceKey" = 'supplier-return:' || r."idempotencyKey"
      WHERE ${scope.locationId ? Prisma.sql`r."locationId" = ${scope.locationId}` : Prisma.sql`TRUE`}
        AND ${scope.userId || scope.criteria ? Prisma.sql`FALSE` : Prisma.sql`TRUE`}
        AND ${dateCondition(Prisma.sql`r."createdAt"`, range)}
      UNION ALL SELECT -e."valueChange" - e."cogsAmount" FROM reported_inventory_values e
      WHERE e.kind = 'OFFLINE_SALE' AND e.mode <> 'NONSTOCK' AND ${scope.locationId ? Prisma.sql`e."locationId" = ${scope.locationId}` : Prisma.sql`TRUE`}
        AND ${scope.userId || scope.criteria ? Prisma.sql`FALSE` : Prisma.sql`TRUE`}
        AND ${dateCondition(Prisma.sql`e."createdAt"`, range)}
    ), obligations AS (
      SELECT e.category, e.amount::numeric FROM expenses e
      WHERE e.status IN ('APPROVED', 'PAID')
        AND ${scope.locationId ? Prisma.sql`e."locationId" = ${scope.locationId}` : Prisma.sql`e."locationId" IS NOT NULL`}
        AND ${dateCondition(Prisma.sql`e."expenseDate"`, range)}
    )
    SELECT
      (SELECT COALESCE(SUM(total), 0) FROM sold) AS collected,
      (SELECT COALESCE(SUM(tax), 0) FROM sold) AS tax,
      (SELECT COALESCE(SUM(discount), 0) FROM sold) AS discounts,
      (SELECT COUNT(*) FROM sold WHERE "sourceType" = 'RECEIPT') AS transactions,
      (SELECT COUNT(*) FROM sold WHERE "sourceType" = 'DAILY_SUMMARY') AS "historicalSummaries",
      (SELECT COALESCE(SUM(i.amount), 0) FROM historical_income i WHERE
        ${scope.locationId ? Prisma.sql`i."locationId" = ${scope.locationId}` : Prisma.sql`TRUE`}
        AND ${scope.userId || scope.criteria ? Prisma.sql`FALSE` : Prisma.sql`TRUE`}
        AND ${dateCondition(Prisma.sql`i."recognizedAt"`, range)}) AS "otherIncome",
      (SELECT COALESCE(SUM(i.amount), 0) FROM lottery_earning_postings i WHERE
        ${scope.locationId ? Prisma.sql`i."locationId" = ${scope.locationId}` : Prisma.sql`TRUE`}
        AND ${scope.userId || scope.criteria ? Prisma.sql`FALSE` : Prisma.sql`TRUE`}
        AND ${dateCondition(Prisma.sql`i."recognizedAt"`, range)}) AS "lotteryEarnings",
      (SELECT COUNT(*) FROM lottery_days d WHERE d.status = 'CLOSED' AND d."earningsIncomplete"
        AND ${scope.locationId ? Prisma.sql`d."locationId" = ${scope.locationId}` : Prisma.sql`TRUE`}
        AND ${scope.userId || scope.criteria ? Prisma.sql`FALSE` : Prisma.sql`TRUE`}
        AND ${dateCondition(Prisma.sql`d."recognizedAt"`, range)}
        AND NOT EXISTS (SELECT 1 FROM lottery_settlements t WHERE t."locationId" = d."locationId"
          AND t."periodStart" <= d."businessDate" AND t."periodEnd" >= d."businessDate")) AS "missingLotteryDays",
      (SELECT COALESCE(SUM(cost), 0) FROM sold_lines) AS cost,
      (SELECT COALESCE(SUM("bookedCost"), 0) FROM sold_lines) AS "bookedSaleCosts",
      (SELECT COALESCE(SUM("estimatedCost"), 0) FROM sold_lines) AS "estimatedSaleCosts",
      (SELECT COALESCE(SUM(amount), 0) FROM inventory_adjustments) AS "inventoryCostAdjustments",
      (SELECT COUNT(*) FROM inventory_adjustments WHERE amount IS NULL) AS "missingInventoryCosts",
      (SELECT COALESCE(SUM(COALESCE(e."inputValue", e."valueChange")),0) FROM reported_inventory_values e WHERE e.kind = 'PURCHASE'
        AND ${scope.locationId ? Prisma.sql`e."locationId" = ${scope.locationId}` : Prisma.sql`TRUE`}
        AND ${dateCondition(Prisma.sql`e."createdAt"`, range)}) AS "receivedInventoryPurchases",
      (SELECT COUNT(*) FROM sold s LEFT JOIN sold_lines i ON i."saleId" = s.id
         WHERE i."saleId" IS NULL OR i."missingCost") AS "missingCosts",
      (SELECT COALESCE(SUM(amount::numeric), 0) FROM returned) AS refunds,
      (SELECT COUNT(*) FROM returned) AS "refundCount",
      (SELECT COALESCE(SUM("taxAmount"), 0) FROM returned) AS "refundTax",
      (SELECT COUNT(*) FROM returned WHERE "taxAmount" IS NULL) AS "missingTax",
      (SELECT COALESCE(SUM(cost), 0) FROM returned_costs) AS "returnedCost",
      (SELECT COUNT(*) FROM returned_costs WHERE cost IS NULL) AS "missingReturnCosts",
      (SELECT COALESCE(SUM(amount), 0) FROM obligations WHERE category::text <> ${inventoryPurchaseCategory}) AS expenses,
      (SELECT COALESCE(SUM(amount), 0) FROM obligations WHERE category::text = ${inventoryPurchaseCategory}) AS "inventoryPurchases",
      (SELECT COALESCE(SUM(amount), 0) FROM voided) AS voids,
      (SELECT COUNT(*) FROM voided) AS "voidCount",
      (SELECT COALESCE(SUM("taxAmount"), 0) FROM voided) AS "voidTax",
      (SELECT COALESCE(SUM(cost), 0) FROM void_costs) AS "voidCost",
      (SELECT COUNT(*) FROM void_costs WHERE cost IS NULL) AS "missingVoidCosts",
      (SELECT COUNT(*) FROM sales s WHERE s.status = 'VOIDED' AND ${saleScope(scope)}
        AND NOT EXISTS (SELECT 1 FROM sale_voids v WHERE v."saleId" = s.id)
        AND ${dateCondition(Prisma.sql`s."createdAt"`, { lt: range?.lt, lte: range?.lte })}) AS "legacyVoids"
  `);
  return summarizeFinancialMetrics(row);
}

export function summarizeFinancialMetrics(row: Record<string, unknown>) {
  const grossCollected = money(value(row.collected));
  const taxCharged = money(value(row.tax));
  const refunds = money(value(row.refunds));
  const voids = money(value(row.voids)), voidTax = money(value(row.voidTax));
  const legacyVoids = value(row.legacyVoids);
  const historicalSummaries = value(row.historicalSummaries);
  const missingCosts = value(row.missingCosts) + value(row.missingReturnCosts) + value(row.missingVoidCosts);
  const taxUnavailable = value(row.missingTax) > 0;
  const refundTax = taxUnavailable ? null : money(value(row.refundTax));
  const netTax = refundTax === null ? null : money(taxCharged - refundTax - voidTax);
  const grossSales = money(grossCollected - taxCharged);
  const refundsBeforeTax = refundTax === null ? null : money(refunds - refundTax);
  const voidsBeforeTax = money(voids - voidTax);
  const netSales = refundsBeforeTax === null ? null : money(grossSales - refundsBeforeTax - voidsBeforeTax);
  const inventoryCostAdjustments = money(value(row.inventoryCostAdjustments));
  const recordedSaleCosts = money(value(row.cost) - value(row.returnedCost) - value(row.voidCost));
  const costIncomplete = missingCosts + value(row.missingInventoryCosts);
  const costOfGoodsSold = costIncomplete ? null : money(recordedSaleCosts + inventoryCostAdjustments);
  const estimatedSaleCosts = money(value(row.estimatedSaleCosts));
  const costEstimated = !costIncomplete && estimatedSaleCosts !== 0;
  const grossProfit = legacyVoids || netSales === null || costOfGoodsSold === null ? null : money(netSales - costOfGoodsSold);
  const expenses = money(value(row.expenses));
  const inventoryPurchases = money(value(row.inventoryPurchases));
  const operatingProfit = grossProfit === null ? null : money(grossProfit - expenses);
  const lotteryEarnings = money(value(row.lotteryEarnings)), missingLotteryDays = value(row.missingLotteryDays);
  const otherIncome = money(value(row.otherIncome) + lotteryEarnings);
  const margin = (profit: number | null) => profit !== null && netSales !== null && netSales > 0 ? money(profit / netSales * 100) : null;
  return {
    grossCollected, netCollected: money(grossCollected - refunds - voids), grossSales, refunds, refundsBeforeTax,
    voids, voidTax, voidsBeforeTax, voidCount: value(row.voidCount), legacyVoids,
    historyWarning: [legacyVoids ? 'Older voids have no recorded reversal date and are excluded from these figures. Their periods require review.' : '',
      historicalSummaries ? `${historicalSummaries} historical daily summaries are included. Receipt counts, order averages, discounts, item costs, staff and hourly allocations were not supplied.` : ''].filter(Boolean).join(' ') || null,
    taxCharged, refundTax, netTax, netSales, discounts: historicalSummaries ? null : money(value(row.discounts)),
    transactions: historicalSummaries ? null : value(row.transactions), recordedReceiptCount: value(row.transactions), historicalSummaries,
    refundCount: value(row.refundCount), costOfGoodsSold,
    recordedSaleCosts: missingCosts ? null : recordedSaleCosts, inventoryCostAdjustments: value(row.missingInventoryCosts) ? null : inventoryCostAdjustments,
    saleCostCorrections: money(value(row.cost) - value(row.bookedSaleCosts)), receivedInventoryPurchases: money(value(row.receivedInventoryPurchases)),
    estimatedSaleCosts,
    costCompleteness: { complete: !costIncomplete, missingRecords: costIncomplete, estimated: costEstimated, estimatedAmount: estimatedSaleCosts,
      label: costIncomplete ? 'Cost information incomplete' : costEstimated ? 'Includes estimated costs' : 'Recorded costs', reviewPath: '/financial?tab=inventory&costTab=missing' },
    grossProfit, expenses, operatingExpenses: expenses, inventoryPurchases, recordedExpenses: money(expenses + inventoryPurchases),
    operatingProfit, otherIncome, lotteryEarnings,
    earningsCompleteness: { complete: !missingLotteryDays, pendingDays: missingLotteryDays, reviewPath: '/lottery?tab=reports', label: missingLotteryDays ? 'Lottery earnings pending' : 'Confirmed earnings' },
    netProfit: operatingProfit === null || missingLotteryDays ? null : money(operatingProfit + otherIncome),
    grossMargin: margin(grossProfit), operatingMargin: margin(operatingProfit),
    costBasis: costIncomplete || legacyVoids ? 'UNAVAILABLE' : costEstimated ? 'ESTIMATED' : 'HISTORICAL',
    unavailableReason: legacyVoids ? 'Older voids have no recorded reversal date; historical profit requires review.' : taxUnavailable ? 'Original refund tax allocations are unavailable.'
      : costIncomplete ? 'Cost information incomplete. Review missing inventory and sale costs.' : missingLotteryDays ? 'Lottery earnings pending. Reconcile commissions in Lottery reports.' : null,
  };
}

/** Aggregate dated activity in SQL rather than loading every sale into memory.
 * Staff attribution follows the original seller, matching Sales report filters.
 * Payment amounts follow net original tender allocations and actual refund
 * payouts. Payment counts count each sale once per tender, not once per split.
 */
type Breakdown = 'day' | 'hour' | 'epochHour' | 'employee' | 'payment' | 'shift';
export async function getFinancialBreakdowns(scope: Scope, range: MetricRange, timezone: string, today: Date, db: QueryClient = prisma,
  groupings: Breakdown[] = ['day', 'hour', 'employee', 'payment']) {
  const queries: Record<Breakdown, Prisma.Sql> = {
    day: Prisma.sql`SELECT 'day' AS kind, TO_CHAR(local_time, 'YYYY-MM-DD') AS key, SUM(amount) AS total, SUM(gross) AS gross, CASE WHEN BOOL_OR(sale_count IS NULL) THEN NULL ELSE SUM(sale_count) END AS count
      FROM local_activity GROUP BY key`,
    hour: Prisma.sql`SELECT 'hour' AS kind, EXTRACT(HOUR FROM local_time)::text AS key, SUM(amount) AS total, SUM(gross) AS gross, CASE WHEN BOOL_OR(sale_count IS NULL) THEN NULL ELSE SUM(sale_count) END AS count
      FROM local_activity WHERE NOT is_summary AND ${dateCondition(Prisma.sql`occurred`, { gte: today })} GROUP BY EXTRACT(HOUR FROM local_time)`,
    employee: Prisma.sql`SELECT 'employee' AS kind, "userId" AS key, SUM(amount) AS total, SUM(gross) AS gross, CASE WHEN BOOL_OR(sale_count IS NULL) THEN NULL ELSE SUM(sale_count) END AS count FROM activity WHERE NOT is_summary GROUP BY "userId"`,
    payment: Prisma.sql`SELECT 'payment' AS kind, method AS key, SUM(amount) AS total, SUM(gross) AS gross, CASE WHEN BOOL_OR(sale_count IS NULL) THEN NULL ELSE SUM(sale_count) END AS count FROM payment_activity GROUP BY method`,
    epochHour: Prisma.sql`SELECT 'epochHour' AS kind, (EXTRACT(EPOCH FROM date_trunc('hour', occurred)) * 1000)::text AS key, SUM(amount) AS total, SUM(gross) AS gross, CASE WHEN BOOL_OR(sale_count IS NULL) THEN NULL ELSE SUM(sale_count) END AS count
      FROM activity WHERE NOT is_summary GROUP BY date_trunc('hour', occurred)`,
    shift: Prisma.sql`SELECT 'shift' AS kind, "shiftId" AS key, SUM(amount) AS total, SUM(gross) AS gross, CASE WHEN BOOL_OR(sale_count IS NULL) THEN NULL ELSE SUM(sale_count) END AS count FROM activity WHERE "shiftId" IS NOT NULL GROUP BY "shiftId"`,
  };
  const rows = await db.$queryRaw<{ kind: string; key: string; total: unknown; gross: unknown; count: unknown }[]>(Prisma.sql`
    WITH activity AS (
      SELECT s."createdAt" AS occurred, s."userId", s."shiftId", s."paymentMethod"::text AS method,
        s.total::numeric AS amount, s.total::numeric AS gross, CASE WHEN s."sourceType" = 'DAILY_SUMMARY' THEN NULL ELSE 1 END AS sale_count, s."sourceType" = 'DAILY_SUMMARY' AS is_summary
      FROM sales s WHERE ${recordedSaleSql} AND ${saleScope(scope)} AND ${dateCondition(Prisma.sql`s."createdAt"`, range)}
      UNION ALL
      SELECT r."createdAt", s."userId", s."shiftId", COALESCE(r.method::text, 'UNAVAILABLE'), -r.amount::numeric, 0::numeric, 0, FALSE
      FROM refunds r JOIN sales s ON s.id = r."saleId"
      WHERE s.status IN ('COMPLETED', 'REFUNDED') AND ${saleScope(scope)} AND ${dateCondition(Prisma.sql`r."createdAt"`, range)}
      UNION ALL
      SELECT v."createdAt", s."userId", s."shiftId", s."paymentMethod"::text, -v.amount, 0::numeric, 0, FALSE
      FROM sale_voids v JOIN sales s ON s.id = v."saleId"
      WHERE ${saleScope(scope)} AND ${dateCondition(Prisma.sql`v."createdAt"`, range)}
    ), payment_sales AS MATERIALIZED (
      SELECT s.id, s."sourceType", s."paymentMethod", s.total, s."changeDue" FROM sales s
      WHERE ${recordedSaleSql} AND ${saleScope(scope)} AND ${dateCondition(Prisma.sql`s."createdAt"`, range)}
    ), payment_totals AS (
      SELECT sp."saleId", sp."paymentMethod"::text AS method, SUM(sp.amount)::numeric AS amount
      FROM sale_payments sp JOIN payment_sales s ON s.id = sp."saleId" GROUP BY sp."saleId", sp."paymentMethod"
    ), payment_activity AS (
      SELECT CASE WHEN s."sourceType" = 'DAILY_SUMMARY' AND COALESCE(p.method, s."paymentMethod"::text) = 'OTHER' THEN 'UNAVAILABLE' ELSE COALESCE(p.method, s."paymentMethod"::text) END AS method,
        CASE WHEN p."saleId" IS NULL THEN s.total WHEN p.method = 'CASH' THEN p.amount - s."changeDue" ELSE p.amount END AS amount,
        CASE WHEN p."saleId" IS NULL THEN s.total WHEN p.method = 'CASH' THEN p.amount - s."changeDue" ELSE p.amount END AS gross, CASE WHEN s."sourceType" = 'DAILY_SUMMARY' THEN NULL ELSE 1 END AS sale_count
      FROM payment_sales s LEFT JOIN payment_totals p ON p."saleId" = s.id
      UNION ALL
      SELECT part->>'method', -(part->>'amount')::numeric, 0::numeric, 0
      FROM refunds r JOIN sales s ON s.id = r."saleId" CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN COALESCE(jsonb_array_length(r.tenders), 0) > 0 THEN r.tenders
        ELSE jsonb_build_array(jsonb_build_object('method', COALESCE(r.method, 'UNAVAILABLE'), 'amount', r.amount)) END
      ) part WHERE s.status IN ('COMPLETED', 'REFUNDED') AND ${saleScope(scope)} AND ${dateCondition(Prisma.sql`r."createdAt"`, range)}
      UNION ALL
      SELECT tender.key, -tender.value::numeric, 0::numeric, 0
      FROM sale_voids v JOIN sales s ON s.id = v."saleId" CROSS JOIN LATERAL jsonb_each_text(v.tenders) tender
      WHERE ${saleScope(scope)} AND ${dateCondition(Prisma.sql`v."createdAt"`, range)}
    ), local_activity AS (
      SELECT *, (occurred AT TIME ZONE 'UTC') AT TIME ZONE ${timezone} AS local_time FROM activity
    )
    ${Prisma.join(groupings.map(kind => queries[kind]), ' UNION ALL ')}
  `);
  return rows.map(row => ({ kind: row.kind, key: row.key, total: money(value(row.total)), gross: money(value(row.gross)), count: row.count === null ? null : value(row.count) }));
}

/** Returns in the selected period can relate to a sale in an earlier period. */
export async function getProductFinancialMetrics(scope: Scope, range?: MetricRange, db: QueryClient = prisma) {
  const rows = await db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
    WITH movements AS (
      SELECT i."productId", i."productName", i.sku, i.quantity, i.total::numeric AS collected,
        i.tax::numeric AS tax, CASE WHEN i."inventoryEntryId" IS NOT NULL THEN c."cogsAmount" ELSE COALESCE(i."costAmount", i."unitCost" * i.quantity) END AS cost,
        CASE WHEN i."inventoryEntryId" IS NOT NULL THEN c."cogsAmount" IS NULL ELSE i."costAmount" IS NULL AND i."unitCost" IS NULL END AS missing
      FROM sale_items i JOIN sales s ON s.id = i."saleId"
      LEFT JOIN reported_inventory_values c ON c.id = i."inventoryEntryId"
      WHERE ${recordedSaleSql} AND ${saleScope(scope)} AND ${dateCondition(Prisma.sql`s."createdAt"`, range)}
      UNION ALL
      SELECT i."productId", i."productName", i.sku, -ri.quantity, -ri.amount::numeric,
        -ri."taxAmount", CASE WHEN c.id IS NOT NULL THEN c."cogsAmount" ELSE -ri."costReturned" END,
        (CASE WHEN c.id IS NOT NULL THEN c."cogsAmount" IS NULL ELSE ri."costReturned" IS NULL END) OR ri."taxAmount" IS NULL
      FROM refund_items ri JOIN refunds r ON r.id = ri."refundId"
      JOIN sale_items i ON i.id = ri."saleItemId" JOIN sales s ON s.id = r."saleId"
      LEFT JOIN reported_inventory_values c ON c."sourceKey" = 'refund-line:' || r.id || ':' || i.id
      WHERE s.status IN ('COMPLETED', 'REFUNDED') AND ${saleScope(scope)} AND ${dateCondition(Prisma.sql`r."createdAt"`, range)}
      UNION ALL
      SELECT i->>'productId', i->>'productName', i->>'sku', -(i->>'quantity')::int, -(i->>'amount')::numeric,
        -(i->>'taxAmount')::numeric, CASE WHEN c.id IS NOT NULL THEN c."cogsAmount" ELSE -(i->>'costReversed')::numeric END,
        CASE WHEN c.id IS NOT NULL THEN c."cogsAmount" IS NULL ELSE (i->>'costReversed') IS NULL END
      FROM sale_voids v JOIN sales s ON s.id = v."saleId" CROSS JOIN LATERAL jsonb_array_elements(v.items) i
      LEFT JOIN reported_inventory_values c ON c."sourceKey" = 'void-line:' || (i->>'saleItemId')
      WHERE ${saleScope(scope)} AND ${dateCondition(Prisma.sql`v."createdAt"`, range)}
    ), unknown_returns AS (
      SELECT COUNT(*) AS count FROM refunds r JOIN sales s ON s.id = r."saleId"
      WHERE s.status IN ('COMPLETED', 'REFUNDED') AND ${saleScope(scope)} AND ${dateCondition(Prisma.sql`r."createdAt"`, range)}
        AND (r."pointsRestored" IS NULL OR NOT EXISTS (SELECT 1 FROM refund_items ri WHERE ri."refundId" = r.id))
    ), unknown_voids AS (
      SELECT DISTINCT i."productId" FROM sales s JOIN sale_items i ON i."saleId" = s.id
      WHERE s.status = 'VOIDED' AND ${saleScope(scope)}
        AND NOT EXISTS (SELECT 1 FROM sale_voids v WHERE v."saleId" = s.id)
        AND ${dateCondition(Prisma.sql`s."createdAt"`, { lt: range?.lt, lte: range?.lte })}
    )
    SELECT "productId", MAX("productName") AS "productName", MAX(sku) AS sku,
      SUM(quantity) AS quantity, SUM(collected) AS collected, SUM(tax) AS tax, SUM(cost) AS cost,
      BOOL_OR(missing) OR (SELECT count > 0 FROM unknown_returns)
        OR EXISTS (SELECT 1 FROM unknown_voids v WHERE v."productId" = movements."productId") AS missing,
      EXISTS (SELECT 1 FROM unknown_voids v WHERE v."productId" = movements."productId") AS "incompleteVoids",
      (SELECT count > 0 FROM unknown_returns) AS "incompleteReturns"
    FROM movements GROUP BY "productId"
  `);
  return rows.map(row => {
    const revenue = money(value(row.collected));
    const netSales = money(revenue - value(row.tax));
    const profit = row.missing ? null : money(netSales - value(row.cost));
    return {
      productId: String(row.productId), productName: String(row.productName), sku: String(row.sku),
      quantitySold: value(row.quantity), revenue, netSales: row.incompleteReturns ? null : netSales,
      profit, margin: profit !== null && netSales > 0 ? money(profit / netSales * 100) : null,
      costBasis: row.missing ? 'UNAVAILABLE' : 'HISTORICAL', incompleteReturns: Boolean(row.incompleteReturns), incompleteVoids: Boolean(row.incompleteVoids),
    };
  });
}
