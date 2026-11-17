/**
 * Store Pulse (pure; loader and scheduler in storePulse.service.ts): is the store
 * running the way it usually does right now?
 *
 * Each weekday's pattern is learned from the last six weeks: when the first drawer
 * opened, when the last drawer opened that day closed, and the sales in each hour,
 * as medians. A weekday with fewer than three open days is still being learned and
 * stays silent (a store closed on Sundays never hears about Sundays).
 *
 * Four alerts, each raised once per stretch (its key names the stretch) and closed
 * when its condition clears:
 * - nobody on the register: 20 minutes after the usual opening and inside the usual
 *   hours, no drawer is open and none closed (or sold) in the last 20 minutes;
 * - a quiet register: a drawer is open and there has been no sale for as long as five
 *   of this hour's usual sales take (20 to 90 minutes), only in hours that usually
 *   have 3 or more sales, at most 3 a day;
 * - a register not heard from for 5 minutes while the person signed in on it still
 *   has a drawer open and is not on another register;
 * - a drawer still open an hour after its day's usual closing, with no sale for 30 minutes.
 * "The store is closed today" silences the first two.
 */

export const LEARN_WEEKS = 6;
export const MIN_DAYS = 3;
/** Minutes after the usual opening (and the shortest quiet stretch). */
export const GRACE_MINUTES = 20;
export const QUIET_SALES = 5;
export const QUIET_MAX_MINUTES = 90;
export const QUIET_MIN_HOURLY = 3;
export const QUIET_PER_DAY = 3;
export const REGISTER_SILENT_MINUTES = 5;
export const LEFT_OPEN_AFTER_MINUTES = 60;
export const LEFT_OPEN_QUIET_MINUTES = 30;

export type PulseKind = 'PULSE_NOT_OPEN' | 'PULSE_QUIET' | 'PULSE_REGISTER' | 'PULSE_LEFT_OPEN';
export const PULSE_KINDS: PulseKind[] = ['PULSE_NOT_OPEN', 'PULSE_QUIET', 'PULSE_REGISTER', 'PULSE_LEFT_OPEN'];
/** Who is on, and the closed-today switch. */
export const PULSE_HREF = '/team-time/shifts';
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** One past store day the store was open (a drawer opened on it). */
export interface PastDay {
  /** YYYY-MM-DD */
  date: string;
  weekday: number;
  /** Minutes after the day's midnight when the first drawer opened. */
  opened: number;
  /** Minutes after the day's midnight when the last drawer opened that day closed (past 1440 after midnight); null if none closed. */
  closed: number | null;
  /** Sales in each local hour of the day (24 entries). */
  salesByHour: number[];
}
export interface WeekdayPattern {
  weekday: number;
  /** Open days of this weekday in the last six weeks. */
  days: number;
  learned: boolean;
  opensAt: number | null;
  closesAt: number | null;
  /** Usual sales in each local hour (median of the open days). */
  salesByHour: number[];
}
export interface PulseSwitches { notOpen: boolean; quiet: boolean; register: boolean; leftOpen: boolean }
export interface OpenDrawer {
  shiftId: string; userId: string; name: string; openedAt: Date;
  /** Weekday of the store day it opened on, and minutes from that day's midnight to now. */
  weekday: number; minutesIntoDay: number;
}
export interface RegisterSeen {
  id: string; name: string; lastSeenAt: Date;
  /** Who was signed in on it, and whether that session is still signed in (signing out ends it). */
  userId: string | null; sessionLive: boolean;
}
export interface PulseState {
  timezone: string;
  now: Date;
  /** The store day (YYYY-MM-DD), its weekday, and the minutes since its midnight. */
  today: string; weekday: number; minute: number;
  closedToday: boolean;
  switches: PulseSwitches;
  /** Open drawers, earliest first. */
  openDrawers: OpenDrawer[];
  /** The last drawer that closed today. */
  lastClosed: { at: Date; name: string } | null;
  lastSaleAt: Date | null;
  registers: RegisterSeen[];
  /** Quiet-register alerts already raised today (at most 3 a day). */
  quietAlertsToday: number;
}
export interface PulseAlert { key: string; kind: PulseKind; severity: 'high' | 'medium'; sentence: string; href: string }

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Each weekday's usual pattern from the most recent six open days of that weekday. */
export function learnPatterns(days: PastDay[]): WeekdayPattern[] {
  return WEEKDAYS.map((_, weekday) => {
    const these = days.filter(day => day.weekday === weekday).sort((a, b) => b.date.localeCompare(a.date)).slice(0, LEARN_WEEKS);
    const opensAt = median(these.map(day => day.opened)), closesAt = median(these.flatMap(day => day.closed === null ? [] : [day.closed]));
    return {
      weekday, days: these.length, learned: these.length >= MIN_DAYS,
      opensAt: opensAt === null ? null : Math.round(opensAt), closesAt: closesAt === null ? null : Math.round(closesAt),
      salesByHour: Array.from({ length: 24 }, (_, hour) => median(these.map(day => day.salesByHour[hour] ?? 0)) ?? 0),
    };
  });
}

/** "6:05 AM" for minutes after midnight (past 1440 is the next morning). */
export function minuteText(minute: number) {
  const whole = ((Math.round(minute) % 1440) + 1440) % 1440, hour = Math.floor(whole / 60);
  return `${hour % 12 || 12}:${String(whole % 60).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}
/** A usual time, to the nearest 5 minutes. */
export const usualText = (minute: number) => minuteText(Math.round(minute / 5) * 5);
/** Minutes after local midnight of a moment, on the store's clock. */
export function localMinute(at: Date, timezone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
    .formatToParts(at).map(part => [part.type, part.value]));
  return (Number(parts.hour) % 24) * 60 + Number(parts.minute);
}
export const clockText = (at: Date, timezone: string) => minuteText(localMinute(at, timezone));
/** "between 5 and 6 PM", "between 11 AM and 12 PM". */
export function hourRangeText(hour: number) {
  const part = (h: number) => ({ number: h % 12 || 12, half: h % 24 < 12 ? 'AM' : 'PM' });
  const from = part(hour), to = part(hour + 1);
  return from.half === to.half ? `between ${from.number} and ${to.number} ${to.half}` : `between ${from.number} ${from.half} and ${to.number} ${to.half}`;
}
const possessive = (name: string) => `${name}'s`;

/**
 * What should be raised now, and every key that still holds (an open alert whose key
 * is not among them has cleared). A raised key always holds.
 */
export function checkPulse(state: PulseState, patterns: WeekdayPattern[]): { raise: PulseAlert[]; holds: Set<string> } {
  const raise: PulseAlert[] = [], holds = new Set<string>();
  const today = patterns[state.weekday], dayName = WEEKDAYS[state.weekday];
  const minutesSince = (at: Date | null | undefined) => at ? (state.now.getTime() - at.getTime()) / 60000 : Infinity;
  const clock = (at: Date) => clockText(at, state.timezone);

  // Nobody on the register, in the usual hours.
  if (state.switches.notOpen && !state.closedToday && !state.openDrawers.length) {
    const closed = state.lastClosed;
    const key = closed ? `pulse:nobody:${state.today}:${closed.at.toISOString()}` : `pulse:not-open:${state.today}`;
    holds.add(key);
    const inHours = today.learned && today.opensAt !== null && state.minute >= today.opensAt + GRACE_MINUTES
      && (today.closesAt === null || state.minute < today.closesAt - GRACE_MINUTES);
    if (inHours && minutesSince(state.lastSaleAt) >= GRACE_MINUTES && minutesSince(closed?.at) >= GRACE_MINUTES) {
      if (!closed) raise.push({ key, kind: 'PULSE_NOT_OPEN', severity: 'high', href: PULSE_HREF,
        sentence: `Nobody had clocked in by ${minuteText(state.minute)}. On ${dayName}s the store usually opens by ${usualText(today.opensAt!)}.` });
      else if (today.closesAt !== null) raise.push({ key, kind: 'PULSE_NOT_OPEN', severity: 'medium', href: PULSE_HREF,
        sentence: `Nobody has been on the register since ${clock(closed.at)}, when ${possessive(closed.name)} drawer closed. On ${dayName}s the store is usually open until ${usualText(today.closesAt)}.` });
    }
  }

  // A quiet register: far longer without a sale than this hour usually goes.
  if (state.switches.quiet && !state.closedToday && state.openDrawers.length) {
    const firstOpen = state.openDrawers.reduce((earliest, drawer) => drawer.openedAt < earliest ? drawer.openedAt : earliest, state.openDrawers[0].openedAt);
    const afterSale = !!state.lastSaleAt && state.lastSaleAt > firstOpen;
    const since = afterSale ? state.lastSaleAt! : firstOpen;
    const key = `pulse:quiet:${state.today}:${since.toISOString()}`;
    holds.add(key);
    const hour = Math.floor(state.minute / 60) % 24, usual = today.learned ? today.salesByHour[hour] ?? 0 : 0;
    const wait = usual > 0 ? Math.min(QUIET_MAX_MINUTES, Math.max(GRACE_MINUTES, Math.ceil(60 * QUIET_SALES / usual))) : Infinity;
    if (usual >= QUIET_MIN_HOURLY && state.quietAlertsToday < QUIET_PER_DAY && minutesSince(since) >= wait) raise.push({ key, kind: 'PULSE_QUIET', severity: 'medium', href: PULSE_HREF,
      sentence: `${afterSale ? `No sale since ${clock(since)}.` : `No sale since the drawer opened at ${clock(since)}.`} ${dayName} ${hourRangeText(hour)} usually has about ${Math.round(usual)} sales.` });
  }

  // A register not heard from while its person's drawer is open.
  if (state.switches.register) for (const register of state.registers) {
    if (!register.userId || !register.sessionLive || minutesSince(register.lastSeenAt) < REGISTER_SILENT_MINUTES) continue;
    const drawer = state.openDrawers.find(open => open.userId === register.userId && open.openedAt <= register.lastSeenAt);
    const elsewhere = state.registers.some(other => other.id !== register.id && other.userId === register.userId && minutesSince(other.lastSeenAt) < REGISTER_SILENT_MINUTES);
    if (!drawer || elsewhere) continue;
    const key = `pulse:register:${register.id}:${register.lastSeenAt.toISOString()}`;
    holds.add(key);
    raise.push({ key, kind: 'PULSE_REGISTER', severity: 'high', href: PULSE_HREF,
      sentence: `${register.name} has not been heard from since ${clock(register.lastSeenAt)} and ${possessive(drawer.name)} drawer is still open. If only its connection is down, it can keep taking cash sales.` });
  }

  // A drawer left open after the store usually closes.
  if (state.switches.leftOpen) for (const drawer of state.openDrawers) {
    const key = `pulse:left-open:${drawer.shiftId}`;
    holds.add(key);
    const pattern = patterns[drawer.weekday];
    if (!pattern.learned || pattern.closesAt === null || drawer.minutesIntoDay < pattern.closesAt + LEFT_OPEN_AFTER_MINUTES
      || minutesSince(state.lastSaleAt) < LEFT_OPEN_QUIET_MINUTES) continue;
    const lastSale = state.lastSaleAt && state.lastSaleAt >= drawer.openedAt ? `the last sale was at ${clock(state.lastSaleAt)}` : `there has been no sale since it opened at ${clock(drawer.openedAt)}`;
    raise.push({ key, kind: 'PULSE_LEFT_OPEN', severity: 'medium', href: PULSE_HREF,
      sentence: `${possessive(drawer.name)} drawer is still open at ${minuteText(state.minute)}. On ${WEEKDAYS[drawer.weekday]}s the store usually closes by ${usualText(pattern.closesAt)}; ${lastSale}.` });
  }
  return { raise, holds };
}
