import { Prisma } from '@prisma/client';
import { AppError } from '../utils/errorHandler';
import { dateCondition, getFinancialMetrics, MetricRange, recordedSaleSql, saleScope } from './financialMetrics.service';
import { inventoryReconciliation } from './inventoryCostReport.service';
import { reportCalendar } from './reportDates.service';
import { isInventoryPurchase } from './expenseAccounting.service';

const money = (n: unknown) => Math.round(Number(n || 0) * 100) / 100;

/** Monthly workbook facts share the statement's read-only transaction snapshot.
 * Aggregate receipts in SQL; never manufacture register allocations or dated monthly expenses.
 */
export async function getProfitAndLossWorkbook(db: Prisma.TransactionClient, scope: { locationId?: string }, range: MetricRange, timezone: string) {
  const start = range.gte, end = range.lt || range.lte;
  if (!start || !end || end.getTime() - start.getTime() > 366 * 86400000) throw new AppError('Select up to one year for an Excel report.', 400);
  // All-store reports use the same UTC boundaries as the displayed statement.
  const stores = await db.location.findMany({ where: scope.locationId ? { id: scope.locationId } : {}, select: { id: true, name: true }, orderBy: { name: 'asc' } });
  const calendar = reportCalendar(timezone, start);
  const last = reportCalendar(timezone, new Date(end.getTime() - (range.lt ? 1 : 0)));
  if (stores.length * ((last.year - calendar.year) * 12 + last.month - calendar.month + 1) > 120) throw new AppError('Select a store or a shorter period for an Excel report.', 400);
  const months = [];
  for (const store of stores) {
    for (let offset = 0; ; offset++) {
      const monthStart = calendar.monthStart(offset), next = calendar.monthStart(offset + 1);
      if (monthStart >= end && (range.lt || monthStart > end)) break;
      const from = new Date(Math.max(start.getTime(), monthStart.getTime()));
      const monthlyRange: MetricRange = { gte: from, ...(next <= end ? { lt: next } : range.lt ? { lt: end } : { lte: end }) };
      const storeScope = { locationId: store.id };
      const metrics = await getFinancialMetrics(storeScope, monthlyRange, db);
      const days = await db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
        WITH sold AS (
          SELECT s.*, COALESCE((SELECT SUM(p.amount) FROM sale_payments p WHERE p."saleId" = s.id AND p."paymentMethod" = 'CARD'),
            CASE WHEN s."paymentMethod" = 'CARD' THEN s.total ELSE 0 END) AS card
          FROM sales s WHERE ${recordedSaleSql} AND ${saleScope(storeScope)} AND ${dateCondition(Prisma.sql`s."createdAt"`, monthlyRange)}
        ), activity AS (
          SELECT "createdAt" AS occurred, total::numeric AS sales, tax::numeric AS tax, 0::numeric AS refunds, 0::numeric AS voids,
            "sourceData", "sourceType" = 'DAILY_SUMMARY' AS historical, card FROM sold
          UNION ALL
          SELECT r."createdAt", 0, -r."taxAmount", r.amount::numeric, 0, NULL, FALSE, 0 FROM refunds r JOIN sales s ON s.id = r."saleId"
            WHERE s.status IN ('COMPLETED', 'REFUNDED') AND ${saleScope(storeScope)} AND ${dateCondition(Prisma.sql`r."createdAt"`, monthlyRange)}
          UNION ALL
          SELECT v."createdAt", 0, -v."taxAmount", 0, v.amount, NULL, FALSE, 0 FROM sale_voids v JOIN sales s ON s.id = v."saleId"
            WHERE ${saleScope(storeScope)} AND ${dateCondition(Prisma.sql`v."createdAt"`, monthlyRange)}
        )
        SELECT TO_CHAR(occurred AT TIME ZONE 'UTC' AT TIME ZONE ${timezone}, 'YYYY-MM-DD') AS date,
          SUM(sales) AS sales, SUM(refunds) AS refunds, SUM(voids) AS voids, SUM(card) AS card,
          CASE WHEN BOOL_OR(tax IS NULL) THEN NULL ELSE SUM(tax) END AS tax,
          CASE WHEN BOOL_OR(tax IS NULL) THEN NULL ELSE SUM(sales - refunds - voids - tax) END AS "netSales",
          CASE WHEN BOOL_OR(NOT historical OR "sourceData"->>'register1Cents' IS NULL) THEN NULL ELSE SUM(("sourceData"->>'register1Cents')::numeric) / 100 END AS "register1",
          CASE WHEN BOOL_OR(NOT historical OR "sourceData"->>'tax1Cents' IS NULL) THEN NULL ELSE SUM(("sourceData"->>'tax1Cents')::numeric) / 100 END AS "tax1",
          CASE WHEN BOOL_OR(NOT historical OR "sourceData"->>'register2Cents' IS NULL) THEN NULL ELSE SUM(("sourceData"->>'register2Cents')::numeric) / 100 END AS "register2",
          CASE WHEN BOOL_OR(NOT historical OR "sourceData"->>'tax2Cents' IS NULL) THEN NULL ELSE SUM(("sourceData"->>'tax2Cents')::numeric) / 100 END AS "tax2",
          CASE WHEN BOOL_OR(NOT historical OR "sourceData"->>'lotteryNetCents' IS NULL) THEN NULL ELSE SUM(("sourceData"->>'lotteryNetCents')::numeric) / 100 END AS "lotteryNet"
        FROM activity GROUP BY date ORDER BY date
      `);
      const expenses = await db.expense.findMany({ where: { locationId: store.id, expenseDate: monthlyRange, status: { in: ['APPROVED', 'PAID'] } },
        select: { category: true, description: true, amount: true, sourceType: true, expenseDate: true }, orderBy: [{ expenseDate: 'asc' }, { id: 'asc' }] });
      const income = await db.historicalIncome.groupBy({ by: ['kind'], where: { locationId: store.id, recognizedAt: monthlyRange }, _sum: { amount: true } });
      const lotteryDays = await db.lotteryDay.findMany({ where: { locationId: store.id, status: 'CLOSED', recognizedAt: monthlyRange }, select: { businessDate: true, totals: true } });
      const lotteryCorrections = await db.$queryRaw<{ date: string; amount: string }[]>(Prisma.sql`SELECT details->>'postingDate' AS date, details->>'netCollections' AS amount
        FROM lottery_audit_events WHERE "locationId" = ${store.id} AND action = 'CORRECTION'
        AND ${dateCondition(Prisma.sql`((details->>'postingDate')::timestamp AT TIME ZONE ${timezone} AT TIME ZONE 'UTC')`, monthlyRange)}`);
      const lotteryCollections = new Map<string, number>();
      for (const day of lotteryDays) { const totals = day.totals as { netCollections?: string | null }; if (totals.netCollections != null) lotteryCollections.set(day.businessDate, money(totals.netCollections)); }
      for (const correction of lotteryCorrections) lotteryCollections.set(correction.date, money((lotteryCollections.get(correction.date) || 0) + Number(correction.amount)));
      for (const [date, collections] of lotteryCollections) {
        const row = days.find(day => day.date === date);
        if (row) row.lotteryNet = collections;
        else days.push({ date, sales: 0, refunds: 0, voids: 0, card: 0, tax: 0, netSales: 0, register1: null, tax1: null, register2: null, tax2: null, lotteryNet: collections });
      }
      days.sort((a, b) => String(a.date).localeCompare(String(b.date)));
      // Payroll totals belong in P&L; employee-level pay details do not.
      const payroll = expenses.filter(e => e.category === 'PAYROLL');
      const publicExpenses = expenses.filter(e => e.category !== 'PAYROLL');
      if (payroll.length) publicExpenses.push({ ...payroll[0], description: 'Payroll', amount: new Prisma.Decimal(payroll.reduce((sum, e) => sum + Number(e.amount), 0)) });
      if (months.length >= 120) throw new AppError('Select a store or a shorter period for an Excel report.', 400);
      months.push({ store, month: new Date(Date.UTC(calendar.year, calendar.month - 1 + offset, 1)).toISOString().slice(0, 7),
        period: { start: from, end: monthlyRange.lt || monthlyRange.lte, endExclusive: !!monthlyRange.lt, timezone },
        metrics, estimate: null, reconciliation: await inventoryReconciliation(store.id, monthlyRange, db),
        days: days.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, key === 'date' ? value : value === null ? null : money(value)]))),
        expenses: publicExpenses.filter(e => !isInventoryPurchase(e.category)).map(e => ({ ...e, amount: money(e.amount),
          // Import provenance stays in the ledger; the workbook uses its concise source label.
          description: e.sourceType === 'MONTHLY_SUMMARY' ? e.description.split('. ')[0] : e.description })),
        income: [...income.map(i => ({ kind: i.kind, amount: money(i._sum.amount) })), ...(metrics.lotteryEarnings ? [{ kind: 'LOTTERY_EARNINGS', amount: metrics.lotteryEarnings }] : [])],
      });
    }
  }
  return { months };
}
