/**
 * Money Ahead: the store's money over the next 14 store days, money coming in
 * against money going out. Pure, so it is unit tested; cashPlan.service.ts loads
 * the facts from the records.
 *
 * Coming in: the usual sales of each weekday (the median of the last six such
 * weekdays, sales after refunds), split by how the store is usually paid: cash
 * the same day, cards a few business days later less the card fee, gift cards
 * and accounts bring no new money. Card sales already made arrive on their own
 * deposit day. With the lottery's sweep day chosen, lottery sales come in each
 * day and the sweep takes about a week of them.
 * Going out: entries the loader has dated (bills, recurring expenses, payroll,
 * deliveries, sales tax, the owner's planned items).
 *
 * With "money today" entered for today, each day shows what is left. A plan whose
 * weekdays are not all known yet is "still learning" and never raises an alert.
 */
export const PLAN_DAYS = 14;
export const HISTORY_WEEKS = 6;
export const MIN_WEEKDAY_SAMPLES = 4;
/** An alert looks this many days ahead (today included). */
export const TIGHT_WITHIN_DAYS = 7;
/** Without money today: a day is tight when this much more goes out than comes in. */
export const TIGHT_GAP = 500;

export type CashEntryKind = 'CASH_SALES' | 'CARD_DEPOSIT' | 'LOTTERY_SALES' | 'LOTTERY_SWEEP' | 'BILL' | 'RECURRING' | 'PAYROLL' | 'DELIVERY' | 'SALES_TAX' | 'PLANNED';
export interface CashEntry {
  /** Stable within a plan, for list keys. */
  key: string;
  flow: 'IN' | 'OUT';
  kind: CashEntryKind;
  label: string;
  amount: number;
  /** Worked out from the store's history or a setting: shown as "about". */
  estimate: boolean;
  /** Plain words about where it comes from ("overdue since 2026-11-03" is written by the screen). */
  note?: string;
  /** The store days whose card sales make up a deposit. */
  saleDays?: string[];
  /** The day it was due, for an overdue bill moved to today. */
  dueDate?: string;
  /** The page that holds the record behind it. */
  href?: string;
}
export interface DatedEntry extends CashEntry { date: string }
export interface PlanDay { date: string; weekday: number; in: number; out: number; balance: number | null; entries: CashEntry[] }

export interface CashPlanInput {
  /** The store's date today (YYYY-MM-DD). */
  today: string;
  days?: number;
  /** Sales after refunds and voids by store day (tax included) before today. A day that is missing had no sales. */
  dailySales: Record<string, number>;
  /** The store's first day with a sale, or null before its first sale. */
  firstSaleDay: string | null;
  /** How the last 28 days of sales were paid, after refunds. */
  paymentMix: { cash: number; card: number; other: number };
  /** Card sales after card refunds and voids, by store day, before today. */
  recentCardSales: Record<string, number>;
  cardDepositDays: number;
  cardFeePercent: number;
  /** Lottery money, when the owner chose the sweep day and closed lottery days give an average. */
  lottery: { sweepWeekday: number; dailyAverage: number; recent: Record<string, number> } | null;
  /** Money the business had this morning, when the owner entered it today. */
  startingMoney: number | null;
  /** Bills, recurring expenses, payroll, deliveries, sales tax and planned items, already dated. */
  entries: DatedEntry[];
}

export const money = (value: number) => Math.round((value + Math.sign(value) * Number.EPSILON) * 100) / 100;
export const addDays = (date: string, days: number) => {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
};
export const weekdayOf = (date: string) => { const [year, month, day] = date.split('-').map(Number); return new Date(Date.UTC(year, month - 1, day)).getUTCDay(); };
export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** For each weekday (0 = Sunday): the median of that weekday's sales over the last six weeks, from the first sale on; null with fewer than four such days. */
export function weekdaySales(today: string, dailySales: Record<string, number>, firstSaleDay: string | null): (number | null)[] {
  const samples: number[][] = [[], [], [], [], [], [], []];
  if (firstSaleDay) for (let back = 1; back <= HISTORY_WEEKS * 7; back++) {
    const day = addDays(today, -back);
    if (day >= firstSaleDay) samples[weekdayOf(day)].push(dailySales[day] ?? 0);
  }
  return samples.map(values => values.length >= MIN_WEEKDAY_SAMPLES ? money(median(values)) : null);
}

/** The day the card sales of `day` reach the bank: this many business days (Monday to Friday) later; zero means the same day. */
export function depositDay(day: string, businessDays: number): string {
  let date = day;
  for (let left = businessDays; left > 0;) { date = addDays(date, 1); if (![0, 6].includes(weekdayOf(date))) left--; }
  return date;
}

/** The days from `from` to `to` (both included) falling on these weekdays. */
export function datesOnWeekdays(weekdays: number[], from: string, to: string): string[] {
  const dates: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) if (weekdays.includes(weekdayOf(day))) dates.push(day);
  return dates;
}

/** "Net 15", "net-30", "NET 7 days": pay that many days after delivery. Anything else: on delivery. */
export const netTermsDays = (paymentTerms: string | null | undefined) => {
  const found = /\bnet\s*-?\s*(\d{1,3})\b/i.exec(paymentTerms ?? '');
  return found ? Number(found[1]) : 0;
};

export interface PlannedItemRule {
  repeat: string; date: string | null; weekday: number | null; dayOfMonth: number | null; endsOn: string | null;
}
/** The days an owner's planned item falls on from `from` to `to`: once, every week on a weekday, or every month on a day (the month's last day when shorter). */
export function plannedItemDates(item: PlannedItemRule, from: string, to: string): string[] {
  const end = item.endsOn && item.endsOn < to ? item.endsOn : to;
  if (item.repeat === 'ONCE') return item.date && item.date >= from && item.date <= end ? [item.date] : [];
  if (item.repeat === 'WEEKLY') return item.weekday === null ? [] : datesOnWeekdays([item.weekday], from, end);
  if (item.repeat !== 'MONTHLY' || !item.dayOfMonth) return [];
  const dates: string[] = [];
  for (let day = from; day <= end; day = addDays(day, 1)) {
    const [year, month, date] = day.split('-').map(Number);
    if (date === Math.min(item.dayOfMonth, new Date(Date.UTC(year, month, 0)).getUTCDate())) dates.push(day);
  }
  return dates;
}

export function planCash(input: CashPlanInput) {
  const length = input.days ?? PLAN_DAYS;
  const dates = Array.from({ length }, (_, index) => addDays(input.today, index));
  const last = dates[dates.length - 1];
  const usual = weekdaySales(input.today, input.dailySales, input.firstSaleDay);
  const { cash, card, other } = input.paymentMix;
  const paid = Math.max(0, cash) + Math.max(0, card) + Math.max(0, other);
  const mix = paid > 0 ? { cash: Math.max(0, cash) / paid, card: Math.max(0, card) / paid } : null;
  // Every weekday must be known before the plan can say a day is tight.
  const learning = !mix || usual.some(value => value === null);
  const byDay = new Map<string, CashEntry[]>(dates.map(date => [date, []]));
  const add = (date: string, entry: CashEntry) => { if (entry.amount > 0) byDay.get(date)?.push(entry); };
  const keep = 1 - Math.min(100, Math.max(0, input.cardFeePercent)) / 100;

  // Cash sales arrive the same day.
  if (mix) for (const day of dates) {
    const sales = usual[weekdayOf(day)];
    if (sales) add(day, { key: 'cash-sales:' + day, flow: 'IN', kind: 'CASH_SALES', label: 'Cash sales', amount: money(sales * mix.cash), estimate: true });
  }
  // Card sales arrive on their deposit day: those already made, then the expected ones.
  const deposits = new Map<string, { amount: number; saleDays: string[] }>();
  const deposit = (saleDay: string, amount: number) => {
    const on = depositDay(saleDay, input.cardDepositDays);
    if (on < input.today || on > last || amount <= 0) return;
    const found = deposits.get(on) ?? { amount: 0, saleDays: [] };
    found.amount += amount * keep; found.saleDays.push(saleDay);
    deposits.set(on, found);
  };
  for (const [day, amount] of Object.entries(input.recentCardSales).sort(([a], [b]) => a.localeCompare(b))) if (day < input.today) deposit(day, amount);
  if (mix) for (const day of dates) { const sales = usual[weekdayOf(day)]; if (sales) deposit(day, sales * mix.card); }
  for (const [on, found] of deposits) add(on, { key: 'card-deposit:' + on, flow: 'IN', kind: 'CARD_DEPOSIT', label: 'Card deposit', amount: money(found.amount), estimate: true, saleDays: found.saleDays });

  // Lottery: its sales come in every day; the sweep takes the seven days before it (as recorded, or the usual day).
  if (input.lottery && input.lottery.dailyAverage > 0) {
    const { sweepWeekday, dailyAverage, recent } = input.lottery;
    for (const day of dates) {
      add(day, { key: 'lottery-sales:' + day, flow: 'IN', kind: 'LOTTERY_SALES', label: 'Lottery sales', amount: money(dailyAverage), estimate: true });
      if (weekdayOf(day) !== sweepWeekday) continue;
      let amount = 0;
      for (let back = 1; back <= 7; back++) { const earlier = addDays(day, -back); amount += earlier < input.today && recent[earlier] !== undefined ? recent[earlier] : dailyAverage; }
      add(day, { key: 'lottery-sweep:' + day, flow: 'OUT', kind: 'LOTTERY_SWEEP', label: 'Lottery sweep', amount: money(amount), estimate: true });
    }
  }
  for (const { date, ...entry } of input.entries) if (date >= input.today && date <= last) add(date, { ...entry, amount: money(entry.amount) });

  let balance = input.startingMoney;
  const days: PlanDay[] = dates.map(date => {
    const entries = byDay.get(date)!.sort((a, b) => (a.flow === b.flow ? b.amount - a.amount : a.flow === 'IN' ? -1 : 1) || a.key.localeCompare(b.key));
    const inflow = money(entries.filter(entry => entry.flow === 'IN').reduce((sum, entry) => sum + entry.amount, 0));
    const outflow = money(entries.filter(entry => entry.flow === 'OUT').reduce((sum, entry) => sum + entry.amount, 0));
    if (balance !== null) balance = money(balance + inflow - outflow);
    return { date, weekday: weekdayOf(date), in: inflow, out: outflow, balance, entries };
  });
  const lowest = input.startingMoney === null ? null : days.reduce((low, day) => day.balance! < low.balance! ? day : low, days[0]);
  return {
    today: input.today, learning, usualSales: usual, startingMoney: input.startingMoney, days,
    totals: { in: money(days.reduce((sum, day) => sum + day.in, 0)), out: money(days.reduce((sum, day) => sum + day.out, 0)),
      lowest: lowest && { date: lowest.date, balance: lowest.balance! } },
    tight: learning ? null : tightDay(days, input.startingMoney !== null),
  };
}
export type CashPlan = ReturnType<typeof planCash>;

/** The first day of the coming week that runs short (with money today) or where far more goes out than comes in. */
export function tightDay(days: PlanDay[], withBalance: boolean) {
  const day = days.slice(0, TIGHT_WITHIN_DAYS).find(candidate => withBalance ? candidate.balance! < 0 : candidate.out - candidate.in >= TIGHT_GAP);
  return day ? { ...day, short: withBalance, biggest: day.entries.filter(entry => entry.flow === 'OUT').slice(0, 3) } : null;
}

/** "$1,850": about-figures to the nearest $10, and to the nearest $100 from $10,000 up. */
export const aboutUsd = (value: number) => {
  const step = Math.abs(value) < 10000 ? 10 : 100;
  return '$' + (Math.round(Math.abs(value) / step) * step).toLocaleString('en-US');
};
/** "$1,950", or "$1,950.50" when there are cents. */
export const exactUsd = (value: number) => '$' + Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2 });
const amount = (value: number, estimate: boolean) => estimate ? 'about ' + aboutUsd(value) : exactUsd(value);
const listed = (parts: string[]) => parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : parts[0] ?? '';

/** The alert's one sentence, every number from the plan. */
export function tightSentence(tight: NonNullable<CashPlan['tight']>, today: string) {
  const name = tight.date === today ? 'Today' : tight.date === addDays(today, 1) ? 'Tomorrow' : WEEKDAY_NAMES[tight.weekday];
  const outEstimated = tight.entries.some(entry => entry.flow === 'OUT' && entry.estimate);
  const outgoing = tight.entries.filter(entry => entry.flow === 'OUT').length;
  const items = (outgoing > tight.biggest.length ? 'including ' : '') + listed(tight.biggest.map(entry => `${entry.label} ${amount(entry.amount, entry.estimate)}`));
  const coming = tight.in > 0 ? `about ${aboutUsd(tight.in)} comes in` : 'nothing comes in';
  return `${name} looks tight: ${amount(tight.out, outEstimated)} goes out (${items}) and ${coming}`
    + (tight.short ? `, so the business would be about ${aboutUsd(tight.balance!)} short.` : '.');
}
