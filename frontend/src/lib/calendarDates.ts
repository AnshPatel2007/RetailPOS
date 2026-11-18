import { CalendarDate, endOfMonth, parseDate, startOfMonth, today } from '@internationalized/date';

/** Date-only values never pass through JavaScript's UTC timestamp parser. */
export function calendarDate(value?: string | null): CalendarDate | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  try { const date = parseDate(value); return date.year >= 1 && date.toString() === value ? date : null; } catch { return null; }
}
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/**
 * A typed date in any common form ("Nov 4, 2026", "November 4 2026", "11/4/2026",
 * "11/4/26", "11-4-2026", "2026-11-04") as an ISO date, '' for empty, or null.
 */
export function inputDate(value: string): string | null {
  const text = value.trim();
  if (!text) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  const year = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));
  let match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (match) return calendarDate(`${match[1]}-${pad(+match[2])}-${pad(+match[3])}`)?.toString() || null;
  match = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (match) return calendarDate(`${year(match[3])}-${pad(+match[1])}-${pad(+match[2])}`)?.toString() || null;
  match = text.match(/^([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{2}|\d{4})$/i);
  if (match) {
    const month = MONTHS.indexOf(match[1].slice(0, 3).toLowerCase());
    if (month >= 0) return calendarDate(`${year(match[3])}-${pad(month + 1)}-${pad(+match[2])}`)?.toString() || null;
  }
  return null;
}
/** "Nov 4, 2026" for an ISO date; anything else is returned unchanged. */
export function friendlyDate(value: string) {
  const date = calendarDate(value);
  return date ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(date.toDate('UTC')) : value;
}
export function monthLabel(value: string) {
  const date = calendarDate(value + '-01');
  return date ? new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date.toDate('UTC')) : value;
}
export const datePresets = [
  ['today', 'Today'], ['yesterday', 'Yesterday'], ['last7', 'Last 7 days'], ['last30', 'Last 30 days'],
  ['thisMonth', 'This month'], ['lastMonth', 'Last month'], ['ytd', 'Year to date'],
] as const;
export function previousFullWeek(timezone: string, now = today(timezone)) {
  // Convert only the store's calendar date to UTC to obtain its weekday; never
  // derive the store date from a device-local midnight or a UTC timestamp slice.
  const weekday = now.toDate('UTC').getUTCDay() || 7;
  const start = now.subtract({ days: weekday + 6 });
  return { startDate: start.toString(), endDate: start.add({ days: 6 }).toString() };
}
export function presetRange(preset: string, timezone: string, now = today(timezone)) {
  const yesterday = now.subtract({ days: 1 });
  const previous = now.subtract({ months: 1 });
  const ranges: Record<string, [CalendarDate, CalendarDate]> = {
    today: [now, now], yesterday: [yesterday, yesterday], last7: [now.subtract({ days: 6 }), now], last30: [now.subtract({ days: 29 }), now],
    thisMonth: [startOfMonth(now), now], lastMonth: [startOfMonth(previous), endOfMonth(previous)], ytd: [new CalendarDate(now.year, 1, 1), now],
  };
  const range = ranges[preset];
  return range ? { startDate: range[0].toString(), endDate: range[1].toString() } : null;
}
