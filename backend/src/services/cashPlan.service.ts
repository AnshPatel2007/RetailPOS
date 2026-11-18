/**
 * Money Ahead: loads the facts for the pure planner (cashPlan.ts) from one
 * store's records. Owner-only (routes/financial.routes.ts).
 *
 * Coming in: sales history and how sales were paid (getFinancialBreakdowns, the
 * one source for sales figures), card sales already made, and, with the sweep day
 * chosen, closed lottery days. Going out: unpaid bills by due date (overdue ones
 * today), recurring expenses, payroll at each pay period's end (about the last
 * three periods, or the wages already recorded when more), supplier deliveries on
 * their delivery days (an open order's own amount, or about their last four
 * deliveries), sales tax when the owner chose its schedule, and planned items.
 */
import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../utils/errorHandler';
import { dateCondition, getFinancialBreakdowns, getFinancialMetrics, recordedSaleWhere } from './financialMetrics.service';
import { reportCalendar } from './reportDates.service';
import { storeDay } from './reorder.service';
import { usualDeliveryWeekdays } from './reorderPlan';
import { payrollPeriod } from './payroll.service';
import { recurringDatesBetween } from './recurringDates';
import { addDays, datesOnWeekdays, median, money, netTermsDays, planCash, plannedItemDates, tightSentence, CashPlan, DatedEntry, PLAN_DAYS } from './cashPlan';

/** Card sales of this many days before today may still be on their way to the bank. */
const CARD_LOOKBACK_DAYS = 10;
/** Lottery money is planned once this many lottery days were closed in the last four weeks. */
const LOTTERY_MIN_DAYS = 7;
const DELIVERY_HISTORY_DAYS = 120, DELIVERY_PATTERN_DAYS = 56;

export const defaultCashPlanSettings = { cardDepositDays: 2, cardFeePercent: 0, salesTaxFrequency: 'NONE', salesTaxDueDay: 20,
  lotterySweepWeekday: null as number | null, startingMoney: null as number | null, startingMoneyDate: null as string | null };

export async function cashPlanSettings(locationId: string) {
  const row = await prisma.cashPlanSetting.findUnique({ where: { locationId } });
  if (!row) return { ...defaultCashPlanSettings };
  return { cardDepositDays: row.cardDepositDays, cardFeePercent: Number(row.cardFeePercent), salesTaxFrequency: row.salesTaxFrequency, salesTaxDueDay: row.salesTaxDueDay,
    lotterySweepWeekday: row.lotterySweepWeekday, startingMoney: row.startingMoney === null ? null : Number(row.startingMoney), startingMoneyDate: row.startingMoneyDate };
}

const shortDay = (day: string) => new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const monthName = (year: number, month: number) => new Date(Date.UTC(year, month - 1, 15)).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
const lastDayOfMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const pad = (value: number) => String(value).padStart(2, '0');

export async function loadCashPlan(locationId: string, now = new Date()) {
  const store = await prisma.location.findUnique({ where: { id: locationId }, select: { timezone: true, payrollFrequency: true } });
  if (!store) throw new AppError('Store not found', 404);
  const timezone = store.timezone, calendar = reportCalendar(timezone, now);
  const dayOf = (date: Date) => storeDay(timezone, date).date;
  const today = storeDay(timezone, now).date, last = addDays(today, PLAN_DAYS - 1);
  const scope = { locationId }, notes: string[] = [];
  const settings = await cashPlanSettings(locationId);
  const recentDays = Array.from({ length: CARD_LOOKBACK_DAYS }, (_, index) => ({ day: addDays(today, -(index + 1)), range: { gte: calendar.day(-(index + 1)), lt: calendar.day(-index) } }));

  const [dailyRows, mixRows, cardRows, firstSale, bills, undatedBills, recurring, planned, lotteryDays, receipts, orders, suppliers, payrollHistory, payrollNow, unbilledWages] = await Promise.all([
    getFinancialBreakdowns(scope, { gte: calendar.day(-42), lt: calendar.day() }, timezone, calendar.day(), prisma, ['day']),
    getFinancialBreakdowns(scope, { gte: calendar.day(-28), lt: calendar.day() }, timezone, calendar.day(), prisma, ['payment']),
    Promise.all(recentDays.map(({ range }) => getFinancialBreakdowns(scope, range, timezone, calendar.day(), prisma, ['payment']))),
    prisma.sale.findFirst({ where: { locationId, ...recordedSaleWhere }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { createdAt: true } }),
    prisma.expense.findMany({ where: { locationId, status: { in: ['PENDING', 'APPROVED'] }, dueDate: { not: null, lt: calendar.day(PLAN_DAYS) } },
      select: { id: true, description: true, vendor: true, amount: true, dueDate: true, category: true }, orderBy: [{ dueDate: 'asc' }, { id: 'asc' }] }),
    prisma.expense.count({ where: { locationId, status: { in: ['PENDING', 'APPROVED'] }, dueDate: null } }),
    prisma.recurringExpense.findMany({ where: { locationId, isActive: true }, orderBy: [{ nextDueDate: 'asc' }, { id: 'asc' }] }),
    prisma.cashPlanItem.findMany({ where: { locationId, isActive: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    settings.lotterySweepWeekday === null ? Promise.resolve([]) :
      prisma.lotteryDay.findMany({ where: { locationId, status: 'CLOSED', businessDate: { gte: addDays(today, -28), lt: today } }, select: { businessDate: true, totals: true } }),
    // Each delivery's value: what went into stock, charges included.
    prisma.$queryRaw<{ supplierId: string; createdAt: Date; value: Prisma.Decimal | null }[]>(Prisma.sql`
      SELECT po."supplierId", r."createdAt", SUM(COALESCE(i."inventoryValue", i."acceptedQty" * i."unitCost")) AS value
      FROM purchase_receipts r JOIN purchase_orders po ON po.id = r."purchaseOrderId" LEFT JOIN purchase_receipt_items i ON i."receiptId" = r.id
      WHERE po."locationId" = ${locationId} AND ${dateCondition(Prisma.sql`r."createdAt"`, { gte: calendar.day(-DELIVERY_HISTORY_DAYS) })}
      GROUP BY r.id, po."supplierId", r."createdAt"`),
    prisma.purchaseOrder.findMany({ where: { locationId, status: { in: ['ORDERED', 'PARTIALLY_RECEIVED'] }, expectedAt: { not: null } },
      select: { id: true, orderNumber: true, expectedAt: true, supplierId: true, items: { select: { quantity: true, receivedQty: true, cost: true } } }, orderBy: [{ expectedAt: 'asc' }, { id: 'asc' }] }),
    prisma.supplier.findMany({ where: { locationId, isActive: true }, select: { id: true, name: true, deliveryDays: true, paymentTerms: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }] }),
    prisma.payrollEntry.groupBy({ by: ['periodStart'], where: { locationId, periodEnd: { lte: now } }, _sum: { grossPay: true }, orderBy: { periodStart: 'desc' }, take: 3 }),
    prisma.payrollEntry.aggregate({ where: { locationId, periodEnd: { gt: now } }, _sum: { grossPay: true } }),
    // Wages of a pay period that ended this week and has not become a bill yet.
    prisma.payrollEntry.aggregate({ where: { locationId, expenseId: null, periodEnd: { lte: now, gt: calendar.day(-7) } }, _sum: { grossPay: true } }),
  ]);
  const entries: DatedEntry[] = [];

  // Unpaid bills: on their due date, or today when overdue.
  for (const bill of bills) {
    const due = dayOf(bill.dueDate!);
    const wages = bill.category === 'PAYROLL' ? /^Gross wages: (.+?) \|/.exec(bill.description)?.[1] : undefined;
    entries.push({ date: due < today ? today : due, key: 'bill:' + bill.id, flow: 'OUT', kind: 'BILL', amount: Number(bill.amount), estimate: false,
      label: bill.category === 'PAYROLL' ? 'Wages' + (wages ? ` (${wages})` : '') : (bill.vendor || bill.description).replace(/ \(Auto-generated\)$/, ''),
      ...(due < today ? { dueDate: due } : {}), href: '/financial?tab=expenses' });
  }
  if (undatedBills) notes.push(`${undatedBills} unpaid ${undatedBills === 1 ? 'bill has' : 'bills have'} no due date and ${undatedBills === 1 ? 'is' : 'are'} not in the plan. Add a due date in Finances > Expenses.`);

  // Recurring expenses not yet entered as bills.
  for (const item of recurring) for (const date of recurringDatesBetween(item, today, last)) {
    entries.push({ date, key: 'recurring:' + item.id + ':' + date, flow: 'OUT', kind: 'RECURRING', label: item.vendor || item.description,
      amount: Number(item.amount), estimate: false, note: 'Recurring', href: '/financial?tab=recurring' });
  }

  // Payroll: at the end of each pay period, about the last three periods (or what is already recorded, when more).
  const usualPayroll = payrollHistory.length ? median(payrollHistory.map(row => Number(row._sum.grossPay ?? 0))) : null;
  if (usualPayroll !== null && usualPayroll > 0) {
    let period = payrollPeriod(now, store.payrollFrequency, timezone), first = true;
    while (dayOf(period.end) <= last) {
      const amount = first ? Math.max(usualPayroll, Number(payrollNow._sum.grossPay ?? 0)) : usualPayroll;
      entries.push({ date: dayOf(period.end), key: 'payroll:' + period.end.toISOString(), flow: 'OUT', kind: 'PAYROLL', label: 'Payroll', amount, estimate: true,
        note: `Pay period to ${shortDay(dayOf(new Date(period.end.getTime() - 1)))}`, href: '/team-time/payroll' });
      period = payrollPeriod(period.end, store.payrollFrequency, timezone); first = false;
    }
  } else if (Number(payrollNow._sum.grossPay ?? 0) > 0) notes.push('Payroll is left out until a whole pay period has been recorded.');
  if (Number(unbilledWages._sum.grossPay ?? 0) > 0) entries.push({ date: today, key: 'payroll:unbilled', flow: 'OUT', kind: 'PAYROLL', label: 'Payroll',
    amount: Number(unbilledWages._sum.grossPay), estimate: false, note: 'Wages of a finished pay period, not yet a bill', href: '/team-time/payroll' });

  // Supplier deliveries: an open order's own amount, or about the supplier's usual delivery on its delivery days.
  const deliveries = new Map<string, Map<string, number>>();
  for (const receipt of receipts) {
    const byDay = deliveries.get(receipt.supplierId) ?? new Map<string, number>();
    const day = dayOf(receipt.createdAt);
    byDay.set(day, (byDay.get(day) ?? 0) + Number(receipt.value ?? 0));
    deliveries.set(receipt.supplierId, byDay);
  }
  for (const supplier of suppliers) {
    const history = [...(deliveries.get(supplier.id) ?? new Map<string, number>()).entries()].sort(([a], [b]) => b.localeCompare(a));
    const usual = history.length >= 2 ? median(history.slice(0, 4).map(([, value]) => value)) : null;
    const weekdays = supplier.deliveryDays.length ? supplier.deliveryDays
      : usualDeliveryWeekdays(history.filter(([day]) => day >= addDays(today, -DELIVERY_PATTERN_DAYS)).map(([day]) => day));
    const terms = netTermsDays(supplier.paymentTerms);
    const pay = (delivered: string) => addDays(delivered, terms);
    const termsNote = (delivered: string) => terms ? `Delivered ${shortDay(delivered)}, paid net ${terms}` : '';
    const ordered = new Set<string>();
    for (const order of orders.filter(row => row.supplierId === supplier.id)) {
      const amount = order.items.reduce((sum, item) => sum + Math.max(0, item.quantity - item.receivedQty) * Number(item.cost), 0);
      const expected = dayOf(order.expectedAt!), delivered = expected < today ? today : expected;
      ordered.add(delivered);
      if (amount > 0 && pay(delivered) <= last) entries.push({ date: pay(delivered), key: 'order:' + order.id, flow: 'OUT', kind: 'DELIVERY', label: supplier.name + ' delivery',
        amount, estimate: false, note: [`Order ${order.orderNumber}`, expected < today ? `expected ${shortDay(expected)}` : '', termsNote(delivered)].filter(Boolean).join(', '),
        href: '/inventory/purchasing/orders' });
    }
    if (!usual) continue;
    for (const delivered of datesOnWeekdays(weekdays, today, last)) {
      // Already delivered today, or an order covers that delivery.
      if ((delivered === today && history.some(([day]) => day === today)) || ordered.has(delivered) || pay(delivered) > last) continue;
      entries.push({ date: pay(delivered), key: 'delivery:' + supplier.id + ':' + delivered, flow: 'OUT', kind: 'DELIVERY', label: supplier.name + ' delivery',
        amount: usual, estimate: true, note: termsNote(delivered) || 'Usual delivery', href: '/inventory/purchasing/suppliers' });
    }
  }

  // Sales tax: what was collected in the period it pays for (about, when that period is still running).
  if (settings.salesTaxFrequency !== 'NONE') {
    const quarterly = settings.salesTaxFrequency === 'QUARTERLY';
    for (let offset = 0; offset < 2; offset++) {
      const year = calendar.year + Math.floor((calendar.month - 1 + offset) / 12), month = (calendar.month - 1 + offset) % 12 + 1;
      if (quarterly && ![1, 4, 7, 10].includes(month)) continue;
      const due = `${year}-${pad(month)}-${pad(Math.min(settings.salesTaxDueDay, lastDayOfMonth(year, month)))}`;
      if (due < today || due > last) continue;
      const months = quarterly ? 3 : 1;
      const start = calendar.midnight(year, month - months, 1), end = calendar.midnight(year, month, 1);
      const collected = (await getFinancialMetrics(scope, { gte: start, lt: end < now ? end : now })).netTax;
      const period = quarterly ? 'the last quarter' : monthName(year, month - 1 || 12);
      if (collected === null) { notes.push(`Sales tax for ${period} is left out: some refunds have no tax recorded.`); continue; }
      const running = end > now, share = (now.getTime() - start.getTime()) / (end.getTime() - start.getTime());
      entries.push({ date: due, key: 'sales-tax:' + due, flow: 'OUT', kind: 'SALES_TAX', label: 'Sales tax', amount: running && share > 0 ? collected / share : collected,
        estimate: running, note: running ? `For ${period}, still running` : `Collected in ${period}`, href: '/financial?tab=pnl' });
    }
  }

  for (const item of planned) for (const date of plannedItemDates(item, today, last)) {
    entries.push({ date, key: 'planned:' + item.id + ':' + date, flow: item.direction === 'IN' ? 'IN' : 'OUT', kind: 'PLANNED', label: item.label, amount: Number(item.amount), estimate: false, note: 'Planned' });
  }

  // Lottery money, when the owner chose the sweep day.
  const recentLottery: Record<string, number> = {};
  for (const day of lotteryDays) {
    const collected = Number((day.totals as { netCollections?: string | null } | null)?.netCollections);
    if (Number.isFinite(collected)) recentLottery[day.businessDate] = collected;
  }
  const lotteryCount = Object.keys(recentLottery).length;
  const lotteryAverage = lotteryCount >= LOTTERY_MIN_DAYS ? Object.values(recentLottery).reduce((sum, value) => sum + value, 0) / lotteryCount : null;
  if (settings.lotterySweepWeekday !== null && lotteryAverage === null) notes.push('The lottery is left out until a week of lottery days has been closed.');

  const mix = { cash: 0, card: 0, other: 0 };
  for (const row of mixRows) {
    if (row.key === 'UNAVAILABLE') continue;
    const part = row.key === 'CARD' || row.key === 'EBT' ? 'card' : ['GIFT_CARD', 'STORE_CREDIT', 'HOUSE_ACCOUNT'].includes(row.key) ? 'other' : 'cash';
    mix[part] += row.total;
  }
  const plan = planCash({
    today, dailySales: Object.fromEntries(dailyRows.map(row => [row.key, row.total])), firstSaleDay: firstSale ? dayOf(firstSale.createdAt) : null, paymentMix: mix,
    recentCardSales: Object.fromEntries(recentDays.map(({ day }, index) => [day, cardRows[index].find(row => row.key === 'CARD')?.total ?? 0])),
    cardDepositDays: settings.cardDepositDays, cardFeePercent: settings.cardFeePercent,
    lottery: settings.lotterySweepWeekday !== null && lotteryAverage !== null ? { sweepWeekday: settings.lotterySweepWeekday, dailyAverage: lotteryAverage, recent: recentLottery } : null,
    startingMoney: settings.startingMoneyDate === today ? settings.startingMoney : null, entries,
  });
  return { plan, timezone, settings, notes, tightSentence: plan.tight ? tightSentence(plan.tight, today) : null,
    items: planned.map(item => ({ id: item.id, label: item.label, direction: item.direction, amount: Number(item.amount), repeat: item.repeat,
      date: item.date, weekday: item.weekday, dayOfMonth: item.dayOfMonth, endsOn: item.endsOn })),
    hints: { lotteryWeekly: lotteryAverage === null ? null : money(lotteryAverage * 7) } };
}
export type CashPlanReport = Awaited<ReturnType<typeof loadCashPlan>>;

/**
 * The plan for the alerts bell and the morning brief, kept for ten minutes per store
 * (the bell asks every two minutes). Saving Money Ahead forgets it. Not kept in tests.
 */
const kept = new Map<string, { day: string; at: number; plan: CashPlan }>();
const KEEP_MS = 10 * 60 * 1000;
export async function cashPlanForAlerts(locationId: string, now = new Date()): Promise<CashPlan> {
  if (process.env.NODE_ENV === 'test') return (await loadCashPlan(locationId, now)).plan;
  const found = kept.get(locationId), day = now.toISOString().slice(0, 13);
  if (found && found.day === day && Date.now() - found.at < KEEP_MS) return found.plan;
  const { plan } = await loadCashPlan(locationId, now);
  kept.set(locationId, { day, at: Date.now(), plan });
  return plan;
}
export const forgetCashPlan = (locationId: string) => { kept.delete(locationId); };
