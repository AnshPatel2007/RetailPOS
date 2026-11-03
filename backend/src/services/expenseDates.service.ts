import { AppError } from '../utils/errorHandler';
import { MetricRange } from './financialMetrics.service';
import { getReportCalendar, parseReportDate } from './reportDates.service';

export const expenseCalendarDate = (date: Date, timezone: string) => new Intl.DateTimeFormat('en-CA', {
  timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date);

/** Unbounded expense lists must still include future obligations. */
export async function expensePeriod(scope: { locationId?: string }, start?: unknown, end?: unknown) {
  const calendar = await getReportCalendar(scope);
  const from = start ? parseReportDate(calendar, start).date : undefined;
  const until = end ? parseReportDate(calendar, end, true) : undefined;
  if (from && until && (until.exclusive ? from >= until.date : from > until.date)) throw new AppError('The report end must be after its start', 400);
  const range: MetricRange | undefined = from || until ? {
    ...(from ? { gte: from } : {}), ...(until ? until.exclusive ? { lt: until.date } : { lte: until.date } : {}),
  } : undefined;
  return { range, timezone: calendar.timezone };
}

/** Date-only manual entries mean midnight in the assigned store, never server midnight. */
export async function expenseRecordDates(locationId: string, expenseDate?: string, dueDate?: string | null) {
  const calendar = await getReportCalendar({ locationId });
  return {
    ...(expenseDate !== undefined ? { expenseDate: parseReportDate(calendar, expenseDate).date } : {}),
    ...(dueDate !== undefined ? { dueDate: dueDate ? parseReportDate(calendar, dueDate).date : null } : {}),
  };
}
