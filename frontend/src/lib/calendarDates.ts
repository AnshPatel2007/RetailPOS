import { CalendarDate, endOfMonth, parseDate, startOfMonth, today } from '@internationalized/date';

/** Date-only values never pass through JavaScript's UTC timestamp parser. */
export function calendarDate(value?: string | null): CalendarDate | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  try { const date = parseDate(value); return date.year >= 1 && date.toString() === value ? date : null; } catch { return null; }
}
export function inputDate(value: string): string | null {
  if (!value) return '';
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const normalized = match ? `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}` : value;
  return calendarDate(normalized)?.toString() || null;
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
