/** A calendar date, as printed on an ID or shown on the store's wall calendar. */
export interface CalendarDate { year: number; month: number; day: number }

/**
 * Reads a date of birth as the calendar date it names. "2005-11-15" (with or
 * without a time after it) is November 15 wherever the server runs; any other
 * form is read as a timestamp and its UTC date is used. Null when it is not a
 * real date.
 */
export function parseCalendarDate(value: unknown): CalendarDate | null {
  if (typeof value !== 'string') return null;
  const written = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/.exec(value.trim());
  if (written) {
    const [year, month, day] = [Number(written[1]), Number(written[2]), Number(written[3])];
    const check = new Date(Date.UTC(year, month - 1, day));
    return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day ? { year, month, day } : null;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? { year: parsed.getUTCFullYear(), month: parsed.getUTCMonth() + 1, day: parsed.getUTCDate() } : null;
}

/** Completed years from a birth date to a day, both calendar dates: 21 only from the birthday itself. */
export function ageOn(birth: CalendarDate, day: CalendarDate): number {
  const hadBirthday = day.month > birth.month || (day.month === birth.month && day.day >= birth.day);
  return day.year - birth.year - (hadBirthday ? 0 : 1);
}
