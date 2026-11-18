import { getReportCalendar, parseReportDate, storeDateRange } from './reportDates.service';

export const expenseCalendarDate = (date: Date, timezone: string) => new Intl.DateTimeFormat('en-CA', {
  timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date);

/** Unbounded expense lists must still include future obligations. */
export const expensePeriod = storeDateRange;

/** Date-only manual entries mean midnight in the assigned store, never server midnight. */
export async function expenseRecordDates(locationId: string, expenseDate?: string, dueDate?: string | null) {
  const calendar = await getReportCalendar({ locationId });
  return {
    ...(expenseDate !== undefined ? { expenseDate: parseReportDate(calendar, expenseDate).date } : {}),
    ...(dueDate !== undefined ? { dueDate: dueDate ? parseReportDate(calendar, dueDate).date : null } : {}),
  };
}
