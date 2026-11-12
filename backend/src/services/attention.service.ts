/**
 * What needs the owner's attention today, as one sentence each.
 *
 * Every number is computed here from the store's records; nothing is written by
 * AI. Each rule is a small exported function so later work can add rules. The
 * same list feeds the Dashboard and the morning brief (ownerBrief.service.ts).
 */
import prisma from '../config/database';
import { AppError } from '../utils/errorHandler';
import { logger } from '../utils/logger';
import { getFinancialMetrics } from './financialMetrics.service';
import { getReportCalendar } from './reportDates.service';
import { priceReview } from './pricing.service';
import { listUnmatched } from './stockCorrection.service';
import { salesAnomalies } from './inventoryAnalytics.service';
import { costChangeAlertPercent } from '../validators/storeSettings.validator';
import { countPendingLabels } from './shelfLabels.service';
import { loadReorderPlan } from './reorder.service';
import { addDays, WEEKDAYS } from './reorderPlan';

export type Severity = 'high' | 'medium' | 'low';
export interface Finding {
  /** Stable id of the rule, for list keys and tests. */
  key: string;
  severity: Severity;
  /** One plain sentence; every number in it is also in `amount`, `count` or the store's records. */
  sentence: string;
  amount?: number;
  count?: number;
  /** The page where this is fixed. */
  href: string;
  /** Roles that may open that page. Absent: owners and managers. */
  roles?: string[];
}
type Calendar = Awaited<ReturnType<typeof getReportCalendar>>;
export interface AttentionContext {
  locationId: string;
  now: Date;
  calendar: Calendar;
  /** The last complete store day. */
  yesterday: { gte: Date; lt: Date };
  yesterdayMetrics: Awaited<ReturnType<typeof getFinancialMetrics>>;
  bills: Awaited<ReturnType<typeof billsDue>>;
}
export type AttentionRule = (context: AttentionContext) => Promise<Finding | null>;

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
export const usd = (amount: number) => amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const plural = (count: number, one: string, many = one + 's') => count === 1 ? one : many;
const shortDate = (date: Date, timezone: string) => date.toLocaleDateString('en-US', { timeZone: timezone, month: 'short', day: 'numeric' });
const dayKey = (date: Date, timezone: string) => date.toLocaleDateString('en-CA', { timeZone: timezone });
const openExceptions = ['OPEN', 'RECOUNT_REQUESTED'];

/** Items sold below recorded stock that nobody has counted yet. */
export const stockExceptions: AttentionRule = async ({ locationId, now, calendar }) => {
  const where = { locationId, status: { in: openExceptions } };
  const [count, oldest] = await Promise.all([
    prisma.inventoryException.count({ where }),
    prisma.inventoryException.findFirst({ where, orderBy: [{ firstNegativeAt: 'asc' }, { id: 'asc' }], select: { firstNegativeAt: true, product: { select: { name: true } } } }),
  ]);
  if (!count || !oldest) return null;
  const since = shortDate(oldest.firstNegativeAt, calendar.timezone);
  const waitedDays = Math.floor((now.getTime() - oldest.firstNegativeAt.getTime()) / 86400000);
  return { key: 'stock-exceptions', severity: waitedDays >= 7 || count >= 5 ? 'high' : 'medium', count, href: '/inventory/stock-control/exceptions',
    sentence: count === 1 ? `${oldest.product.name} sold more than recorded stock and is waiting for a count (since ${since}).`
      : `${count} items sold more than recorded stock and are waiting for a count. The oldest is ${oldest.product.name}, since ${since}.` };
};

/** Yesterday's profit includes estimated costs, or cannot be worked out at all. */
export const profitNotConfirmed: AttentionRule = async ({ yesterdayMetrics: metrics }) => {
  if (metrics.costBasis === 'PROVISIONAL' && metrics.provisionalReason) return { key: 'profit-not-confirmed', severity: 'medium',
    amount: metrics.costCompleteness.pendingEstimatedCost, count: metrics.costCompleteness.pendingStockProblems,
    href: '/inventory/stock-control/exceptions', sentence: `Yesterday's profit is not final. ${metrics.provisionalReason}` };
  if (metrics.grossProfit === null && metrics.grossCollected > 0 && metrics.costCompleteness.missingRecords) return { key: 'profit-not-confirmed', severity: 'medium',
    count: metrics.costCompleteness.missingRecords, href: '/financial?tab=inventory&costTab=missing',
    sentence: `Yesterday's profit is unavailable: ${metrics.costCompleteness.missingRecords} ${plural(metrics.costCompleteness.missingRecords, 'sale or stock record has', 'sales or stock records have')} no cost on record.` };
  return null;
};

/** Drawers closed in the last 24 hours that did not match what they should hold. */
export const drawerDifferences: AttentionRule = async ({ locationId, now }) => {
  const shifts = await prisma.shift.findMany({ where: { locationId, isClosed: true, clockOutAt: { gte: new Date(now.getTime() - 86400000), lte: now }, cashDifference: { not: null } },
    select: { cashDifference: true, user: { select: { firstName: true } } }, orderBy: [{ clockOutAt: 'desc' }, { id: 'asc' }] });
  const off = shifts.map(shift => ({ name: shift.user.firstName, difference: Number(shift.cashDifference) })).filter(shift => Math.abs(shift.difference) >= 5)
    .sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));
  if (!off.length) return null;
  const describe = (shift: typeof off[number]) => `${usd(Math.abs(shift.difference))} ${shift.difference < 0 ? 'short' : 'over'}`;
  return { key: 'drawer-difference', severity: off.some(shift => Math.abs(shift.difference) >= 20) ? 'high' : 'medium', count: off.length,
    amount: money(off.reduce((sum, shift) => sum + Math.abs(shift.difference), 0)), href: '/team-time/shifts',
    sentence: off.length === 1 ? `${off[0].name}'s drawer closed ${describe(off[0])} in the last 24 hours.`
      : `${off.length} drawers closed with a difference in the last 24 hours: ${off.slice(0, 3).map(shift => `${shift.name} ${describe(shift)}`).join(', ')}${off.length > 3 ? ' and others' : ''}.` };
};

/** Prices that lose money or miss the minimum margin the owner set. */
export const pricesBelowTarget: AttentionRule = async ({ locationId }) => {
  const rows = await priceReview(prisma, locationId);
  const belowCost = rows.filter(row => row.status === 'BELOW_COST').length, belowMinimum = rows.filter(row => row.status === 'BELOW_MINIMUM').length;
  if (!belowCost && !belowMinimum) return null;
  const items = (count: number) => `${count} ${plural(count, 'item is', 'items are')}`;
  return { key: 'prices-below-target', severity: belowCost ? 'high' : 'medium', count: belowCost + belowMinimum, href: '/inventory/purchasing/price-review',
    sentence: belowCost && belowMinimum ? `${items(belowCost)} priced below cost and ${belowMinimum} below your minimum margin.`
      : belowCost ? `${items(belowCost)} priced below what ${belowCost === 1 ? 'it costs' : 'they cost'}.` : `${items(belowMinimum)} priced below your minimum margin.` };
};

/** Stock added without a supplier invoice: its cost is still an estimate. */
export const deliveriesWithoutInvoice: AttentionRule = async ({ locationId }) => {
  const open = await listUnmatched(prisma, locationId, 'open');
  if (!open.length) return null;
  const total = money(open.reduce((sum, row) => sum + Number(row.estimatedValue || 0), 0));
  return { key: 'deliveries-without-invoice', severity: 'low', count: open.length, amount: total, href: '/inventory/stock-control/exceptions?view=unmatched',
    sentence: `${open.length} stock ${plural(open.length, 'addition has', 'additions have')} no supplier invoice yet (${usd(total)} at estimated cost). Match ${open.length === 1 ? 'it' : 'them'} to confirm the cost.` };
};

/** Unpaid bills due in the next seven days, and any already overdue. */
export async function billsDue(locationId: string, calendar: Calendar) {
  const today = calendar.day(), until = calendar.day(8);
  const bills = await prisma.expense.findMany({ where: { locationId, status: { in: ['PENDING', 'APPROVED'] }, dueDate: { not: null, lt: until } }, select: { amount: true, dueDate: true } });
  const overdue = bills.filter(bill => bill.dueDate! < today);
  return { count: bills.length, amount: money(bills.reduce((sum, bill) => sum + Number(bill.amount), 0)), overdue: overdue.length,
    overdueAmount: money(overdue.reduce((sum, bill) => sum + Number(bill.amount), 0)), through: shortDate(calendar.day(7), calendar.timezone) };
}
export const billsDueSoon: AttentionRule = async ({ bills }) => {
  if (!bills.count) return null;
  return { key: 'bills-due', severity: bills.overdue ? 'high' : 'medium', count: bills.count, amount: bills.amount, href: '/financial?tab=expenses',
    sentence: `${bills.count} unpaid ${plural(bills.count, 'bill')} totaling ${usd(bills.amount)} ${plural(bills.count, 'is', 'are')} due by ${bills.through}`
      + (bills.overdue ? `; ${bills.overdue} ${plural(bills.overdue, 'is', 'are')} already overdue (${usd(bills.overdueAmount)}).` : '.') };
};

/** Purchase orders past their expected delivery date. */
export const ordersOverdue: AttentionRule = async ({ locationId, calendar }) => {
  const orders = await prisma.purchaseOrder.findMany({ where: { locationId, status: { in: ['ORDERED', 'PARTIALLY_RECEIVED'] }, expectedAt: { lt: calendar.day() } },
    select: { orderNumber: true, expectedAt: true, supplier: { select: { name: true } } }, orderBy: [{ expectedAt: 'asc' }, { id: 'asc' }] });
  if (!orders.length) return null;
  const oldest = orders[0], expected = shortDate(oldest.expectedAt!, calendar.timezone);
  return { key: 'orders-overdue', severity: 'medium', count: orders.length, href: '/inventory/purchasing/orders',
    sentence: orders.length === 1 ? `The order from ${oldest.supplier.name} (${oldest.orderNumber}) was expected ${expected} and has not been received.`
      : `${orders.length} purchase orders are past their expected delivery date. The oldest, from ${oldest.supplier.name}, was expected ${expected}.` };
};

/** Yesterday had at least three refunds and voids, and more than twice the usual number. */
export const refundsUnusuallyHigh: AttentionRule = async ({ locationId, calendar, yesterdayMetrics: metrics }) => {
  const count = metrics.refundCount + metrics.voidCount;
  if (count < 3) return null;
  const before = await getFinancialMetrics({ locationId }, { gte: calendar.day(-29), lt: calendar.day(-1) });
  const usual = (before.refundCount + before.voidCount) / 28;
  if (count <= usual * 2) return null;
  const amount = money(metrics.refunds + metrics.voids);
  return { key: 'refunds-high', severity: 'medium', count, amount, href: '/insights/reports/sales',
    sentence: `Yesterday had ${count} refunds and voids totaling ${usd(amount)}; a usual day has ${usual < 1 ? 'fewer than 1' : 'about ' + Math.round(usual)}.` };
};

/** Yesterday's sales were far from the recent pattern (same rule as the unusual-day check in reports). */
export const unusualSalesDay: AttentionRule = async ({ locationId, now, calendar }) => {
  const observed = await salesAnomalies({ locationId }, now);
  if (observed.status !== 'OBSERVED') return null;
  const day = observed.dailyAnomalies.find(row => row.date === dayKey(calendar.day(-1), calendar.timezone));
  if (!day) return null;
  return { key: 'unusual-sales-day', severity: 'low', amount: day.revenue, href: '/insights/reports/overview',
    sentence: `Yesterday's sales of ${usd(day.revenue)} were well ${day.revenue > day.expected ? 'above' : 'below'} the usual ${usd(day.expected)} for recent days.` };
};

/** Emails or exports from the last week that did not go through. */
export const jobFailures: AttentionRule = async ({ locationId, now }) => {
  const count = await prisma.backgroundJob.count({ where: { locationId, status: { in: ['FAILED', 'REVIEW'] }, updatedAt: { gte: new Date(now.getTime() - 7 * 86400000) } } });
  if (!count) return null;
  return { key: 'job-failures', severity: 'medium', count, href: '/settings/jobs', roles: ['ADMIN', 'SUPER_ADMIN'],
    sentence: `${count} ${plural(count, 'email or export', 'emails or exports')} did not go through this week and ${plural(count, 'needs', 'need')} a look.` };
};

/** Credits suppliers still owe the store; those older than 30 days make it more urgent. */
export const supplierCreditsOutstanding: AttentionRule = async ({ locationId, now }) => {
  const open = await prisma.supplierCredit.findMany({ where: { locationId, status: 'OPEN' }, select: { amount: true, createdAt: true } });
  if (!open.length) return null;
  const amount = money(open.reduce((sum, credit) => sum + Number(credit.amount), 0));
  const cutoff = new Date(now.getTime() - 30 * 86400000);
  const old = money(open.filter(credit => credit.createdAt < cutoff).reduce((sum, credit) => sum + Number(credit.amount), 0));
  return { key: 'supplier-credits', severity: old ? 'medium' : 'low', count: open.length, amount, href: '/inventory/purchasing/credits',
    sentence: `Suppliers owe you ${usd(amount)} in ${open.length} ${plural(open.length, 'credit')}` + (old ? `; ${usd(old)} of it is more than 30 days old.` : '.') };
};

/** Items whose unit cost rose by at least the store's alert percent on a delivery in the last seven days. */
export const costsWentUp: AttentionRule = async ({ locationId, now }) => {
  const [location, lines] = await Promise.all([
    prisma.location.findUnique({ where: { id: locationId }, select: { settings: true } }),
    prisma.purchaseReceiptItem.findMany({ where: { previousUnitCost: { gt: 0 }, unitCost: { not: null },
      receipt: { createdAt: { gte: new Date(now.getTime() - 7 * 86400000) }, purchaseOrder: { locationId } } },
    select: { previousUnitCost: true, unitCost: true, purchaseOrderItem: { select: { productId: true, productName: true } } } }),
  ]);
  const alert = costChangeAlertPercent(location?.settings);
  const rises = new Map<string, { name: string; percent: number }>();
  for (const line of lines) {
    const percent = Math.round((Number(line.unitCost) - Number(line.previousUnitCost)) / Number(line.previousUnitCost) * 1000) / 10;
    const item = line.purchaseOrderItem;
    if (percent >= alert && percent > (rises.get(item.productId)?.percent ?? -Infinity)) rises.set(item.productId, { name: item.productName, percent });
  }
  if (!rises.size) return null;
  const top = [...rises.values()].sort((a, b) => b.percent - a.percent || a.name.localeCompare(b.name))[0];
  return { key: 'costs-went-up', severity: 'medium', count: rises.size, href: '/inventory/purchasing/price-review',
    sentence: rises.size === 1 ? `${top.name} cost ${top.percent}% more on a delivery this week. Check its price.`
      : `${rises.size} items cost more on deliveries this week, up to ${top.percent}% (${top.name}). Check their prices.` };
};

/** Shelf labels still showing an old price. */
export const labelsOutOfDate: AttentionRule = async ({ locationId }) => {
  const count = await countPendingLabels(prisma, locationId);
  if (!count) return null;
  return { key: 'labels-out-of-date', severity: 'low', count, href: '/inventory?labels=pending',
    sentence: `${count} shelf ${plural(count, 'label is', 'labels are')} out of date after price changes. Print new ones.` };
};

/**
 * The day before an order must go in to make a supplier's next delivery: how
 * many items will run out before the delivery after it. Suppliers without
 * delivery days are not checked.
 */
export const supplierOrderDueTomorrow: AttentionRule = async ({ locationId, now }) => {
  if (!await prisma.supplier.count({ where: { locationId, isActive: true, NOT: { deliveryDays: { isEmpty: true } } } })) return null;
  const plan = await loadReorderPlan({ locationId }, now);
  const due = plan.suppliers.filter(supplier => supplier.supplierId && supplier.nextDelivery
    && addDays(plan.today, 1 + Math.max(1, supplier.leadTimeDays ?? 1)) === supplier.nextDelivery)
    .map(supplier => ({ ...supplier, short: supplier.items.filter(item => item.runsOutBeforeFollowing).length }))
    .filter(supplier => supplier.short > 0)
    .sort((a, b) => b.short - a.short || a.supplierName.localeCompare(b.supplierName));
  if (!due.length) return null;
  const [first, ...others] = due;
  const [year, month, day] = first.nextDelivery!.split('-').map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return { key: 'order-due-tomorrow', severity: 'medium', count: first.short, href: '/inventory/purchasing/suggestions?supplier=' + first.supplierId,
    sentence: `${first.supplierName} delivers ${weekday}; order by tomorrow. ${first.short} ${plural(first.short, 'item')} will run out before the following delivery.`
      + (others.length ? ` ${others.length} other ${plural(others.length, 'supplier also needs an order', 'suppliers also need orders')} by tomorrow.` : '') };
};

/** Shown in this order within one severity. Later packages append their rules here. */
export const attentionRules: AttentionRule[] = [stockExceptions, profitNotConfirmed, drawerDifferences, pricesBelowTarget, billsDueSoon,
  ordersOverdue, refundsUnusuallyHigh, deliveriesWithoutInvoice, jobFailures, unusualSalesDay, costsWentUp, supplierCreditsOutstanding, labelsOutOfDate, supplierOrderDueTomorrow];
const rank: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

/**
 * The store's attention list and the two money figures shown beside it.
 * A rule that fails is skipped and reported as `incomplete`, so one bad query
 * never hides the rest of the list.
 */
export async function collectAttention(locationId: string, now = new Date(), role = 'ADMIN') {
  if (!locationId) throw new AppError('A store assignment is required', 403);
  const calendar = await getReportCalendar({ locationId }, now);
  const yesterday = { gte: calendar.day(-1), lt: calendar.day() };
  const [yesterdayMetrics, bills] = await Promise.all([getFinancialMetrics({ locationId }, yesterday), billsDue(locationId, calendar)]);
  const context: AttentionContext = { locationId, now, calendar, yesterday, yesterdayMetrics, bills };
  let incomplete = false;
  const found = await Promise.all(attentionRules.map((rule, order) => rule(context).then(finding => finding && { finding, order })
    .catch(error => { incomplete = true; logger.warn('Attention rule failed: ' + (error instanceof Error ? error.message : 'unknown error')); return null; })));
  const items = found.filter((row): row is { finding: Finding; order: number } => !!row)
    .filter(row => !row.finding.roles || row.finding.roles.includes(role))
    .sort((a, b) => rank[a.finding.severity] - rank[b.finding.severity] || a.order - b.order).map(row => row.finding);
  return {
    asOf: now.toISOString(), timezone: calendar.timezone, incomplete, items,
    figures: {
      yesterday: { date: dayKey(yesterday.gte, calendar.timezone), sales: yesterdayMetrics.netCollected, grossProfit: yesterdayMetrics.grossProfit,
        grossMargin: yesterdayMetrics.grossMargin, costBasis: yesterdayMetrics.costBasis },
      billsDue: { count: bills.count, amount: bills.amount, overdue: bills.overdue },
    },
  };
}
