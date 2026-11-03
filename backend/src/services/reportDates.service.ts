import prisma from '../config/database';
import { AppError } from '../utils/errorHandler';
import { MetricRange } from './financialMetrics.service';

/** A calendar day is not always 24 hours. Convert each midnight separately. */
export function reportCalendar(timezone: string, now = new Date()) {
  let formatter: Intl.DateTimeFormat;
  try { formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' }); }
  catch { throw new AppError('The store timezone is invalid. Update the store settings.', 400); }
  const parts = (date: Date) => Object.fromEntries(formatter.formatToParts(date).map(p => [p.type, Number(p.value)]));
  const local = parts(now);
  const midnight = (year: number, month: number, day: number) => {
    const target = Date.UTC(year, month - 1, day);
    let guess = target;
    for (let i = 0; i < 6; i++) {
      const p = parts(new Date(guess));
      const correction = target - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
      guess += correction;
      if (!correction) return new Date(guess);
    }
    throw new AppError('The selected date does not have a valid midnight in the store timezone.', 400);
  };
  return { timezone, now, year: local.year, month: local.month, dayOfMonth: local.day,
    weekday: new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay(), midnight,
    day: (offset = 0) => midnight(local.year, local.month, local.day + offset),
    monthStart: (offset = 0) => midnight(local.year, local.month + offset, 1),
    yearStart: (offset = 0) => midnight(local.year + offset, 1, 1),
  };
}

export async function getReportCalendar(scope: { locationId?: string }, now = new Date()) {
  const store = scope.locationId ? await prisma.location.findUnique({ where: { id: scope.locationId }, select: { timezone: true } }) : null;
  if (scope.locationId && !store) throw new AppError('Store not found', 404);
  // A platform-wide explicit date range is in UTC; selected-store reports use that store's zone.
  return reportCalendar(store?.timezone || 'UTC', now);
}

export function parseReportDate(calendar: ReturnType<typeof reportCalendar>, input: unknown, inclusiveEnd = false) {
  if (typeof input !== 'string') throw new AppError('Select a valid report date', 400);
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    const [year, month, day] = input.split('-').map(Number);
    const check = new Date(Date.UTC(year, month - 1, day));
    if (year < 2000 || check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) throw new AppError('Select a valid report date', 400);
    return { date: calendar.midnight(year, month, day + Number(inclusiveEnd)), exclusive: inclusiveEnd };
  }
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(input) || !Number.isFinite(Date.parse(input))) throw new AppError('Use a calendar date or a timestamp with its timezone', 400);
  return { date: new Date(input), exclusive: false };
}

export async function getReportRange(scope: { locationId?: string }, start: unknown, end: unknown, fallback: 'month' | 'year' | 'all' = 'all') {
  const calendar = await getReportCalendar(scope);
  const parse = (input: unknown, inclusiveEnd = false) => parseReportDate(calendar, input, inclusiveEnd);
  const from = start ? parse(start).date : fallback === 'month' ? calendar.monthStart() : fallback === 'year' ? calendar.yearStart() : undefined;
  const until = end ? parse(end, true) : { date: calendar.now, exclusive: false };
  if (from && from >= until.date) throw new AppError('The report end must be after its start', 400);
  const range: MetricRange = { ...(from ? { gte: from } : {}), ...(until.exclusive ? { lt: until.date } : { lte: until.date }) };
  return { range, start: from, end: until.date, endExclusive: until.exclusive, timezone: calendar.timezone };
}
