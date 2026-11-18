import { AppError } from '../utils/errorHandler';

/**
 * When a recurring expense falls due. Its dates are calendar days kept at UTC
 * midnight (the Date's UTC date is the day). Shared by "Generate Due Expenses"
 * and Money Ahead, so both see the same dates.
 */
export interface RecurringRule { frequency: string; dayOfMonth: number | null; startDate: Date }

/** The date after `date`: daily, weekly and every two weeks by days; months on the chosen day (the month's last day when shorter). */
export function nextRecurringDate(date: Date, rule: RecurringRule): Date {
  const next = new Date(date);
  const days = ({ DAILY: 1, WEEKLY: 7, BIWEEKLY: 14 } as Record<string, number>)[rule.frequency];
  if (days) { next.setUTCDate(next.getUTCDate() + days); return next; }
  const months = ({ MONTHLY: 1, QUARTERLY: 3, YEARLY: 12 } as Record<string, number>)[rule.frequency];
  if (!months) throw new AppError('Unsupported recurring frequency', 400);
  const day = rule.dayOfMonth || rule.startDate.getUTCDate();
  next.setUTCDate(1); next.setUTCMonth(next.getUTCMonth() + months);
  const last = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, last));
  return next;
}

const calendarDay = (date: Date) => date.toISOString().slice(0, 10);

/**
 * Its due dates from `from` to `to` (YYYY-MM-DD, both included): from its next due
 * date on, never after its end date. Dates before `from` are skipped, not moved.
 */
export function recurringDatesBetween(rule: RecurringRule & { nextDueDate: Date; endDate: Date | null }, from: string, to: string): string[] {
  const dates: string[] = [];
  let date = new Date(rule.nextDueDate);
  for (let step = 0; step < 2000 && calendarDay(date) <= to; step++) {
    if (rule.endDate && calendarDay(date) > calendarDay(rule.endDate)) break;
    if (calendarDay(date) >= from) dates.push(calendarDay(date));
    date = nextRecurringDate(date, rule);
  }
  return dates;
}
