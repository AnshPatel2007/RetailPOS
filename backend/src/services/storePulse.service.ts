/**
 * Store Pulse: loads each store's pattern and what is happening now, raises the
 * alerts storePulse.ts finds (once per stretch, to owners and managers) and closes
 * the ones that cleared. The scheduler checks every active store once a minute
 * (off with STORE_PULSE_DISABLED=true, and never in tests); registers report in
 * once a minute while someone is signed in on them.
 */
import prisma from '../config/database';
import { logger } from '../utils/logger';
import { reportCalendar } from './reportDates.service';
import { storeDay } from './reorder.service';
import { raiseStoreAlert, resolveStoreAlert } from './storeAlert.service';
import { checkPulse, LEARN_WEEKS, learnPatterns, PastDay, PULSE_KINDS, PulseKind, PulseState, usualText, WeekdayPattern, WEEKDAYS } from './storePulse';

/** Sales that happened at the register (a sale voided later still did). */
const RUNG_UP = ['COMPLETED', 'REFUNDED', 'VOIDED'] as const;
const weekdayOf = (date: string) => { const [year, month, day] = date.split('-').map(Number); return new Date(Date.UTC(year, month - 1, day)).getUTCDay(); };

/** Each weekday's pattern from the six weeks before today; worked out once per store day (every time in tests). */
const patternCache = new Map<string, { day: string; patterns: WeekdayPattern[] }>();
export async function storePatterns(locationId: string, timezone: string, now = new Date()) {
  const today = storeDay(timezone, now).date, cached = patternCache.get(locationId);
  if (cached?.day === today && process.env.NODE_ENV !== 'test') return cached.patterns;
  const calendar = reportCalendar(timezone, now);
  const from = calendar.day(-LEARN_WEEKS * 7), to = calendar.day();
  const [shifts, hours] = await Promise.all([
    prisma.shift.findMany({ where: { locationId, clockInAt: { gte: from, lt: to } }, select: { clockInAt: true, clockOutAt: true } }),
    // Stored times are UTC: read them as UTC, then on the store's clock.
    prisma.$queryRaw<{ day: string; hour: number; sales: number }[]>`
      SELECT to_char((s."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timezone}, 'YYYY-MM-DD') AS day,
        EXTRACT(HOUR FROM (s."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timezone})::int AS hour, COUNT(*)::int AS sales
      FROM sales s WHERE s."locationId" = ${locationId} AND s.status IN ('COMPLETED', 'REFUNDED', 'VOIDED')
        AND s."createdAt" >= ${from} AND s."createdAt" < ${to}
      GROUP BY 1, 2`,
  ]);
  const days = new Map<string, PastDay>();
  for (const shift of shifts) {
    const date = storeDay(timezone, shift.clockInAt).date, [year, month, day] = date.split('-').map(Number);
    const midnight = calendar.midnight(year, month, day).getTime();
    const opened = (shift.clockInAt.getTime() - midnight) / 60000, closed = shift.clockOutAt ? (shift.clockOutAt.getTime() - midnight) / 60000 : null;
    const known = days.get(date) ?? { date, weekday: weekdayOf(date), opened, closed: null, salesByHour: new Array(24).fill(0) };
    known.opened = Math.min(known.opened, opened);
    if (closed !== null) known.closed = Math.max(known.closed ?? closed, closed);
    days.set(date, known);
  }
  for (const row of hours) { const known = days.get(row.day); if (known) known.salesByHour[row.hour] += row.sales; }
  const patterns = learnPatterns([...days.values()]);
  patternCache.set(locationId, { day: today, patterns });
  return patterns;
}

/** The store's pattern, what is happening now, and its open pulse alerts. */
export async function loadPulse(locationId: string, timezone: string, now = new Date()) {
  const calendar = reportCalendar(timezone, now), { date: today, weekday } = storeDay(timezone, now);
  const todayStart = calendar.day();
  const [patterns, openShifts, lastClosed, lastSale, heartbeats, settings, quietAlertsToday, open] = await Promise.all([
    storePatterns(locationId, timezone, now),
    prisma.shift.findMany({ where: { locationId, isClosed: false, clockInAt: { lte: now } }, orderBy: [{ clockInAt: 'asc' }, { id: 'asc' }],
      select: { id: true, userId: true, clockInAt: true, user: { select: { firstName: true } } } }),
    prisma.shift.findFirst({ where: { locationId, isClosed: true, clockOutAt: { gte: todayStart, lte: now } }, orderBy: [{ clockOutAt: 'desc' }, { id: 'desc' }],
      select: { clockOutAt: true, user: { select: { firstName: true } } } }),
    prisma.sale.findFirst({ where: { locationId, status: { in: [...RUNG_UP] }, createdAt: { lte: now } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { createdAt: true } }),
    prisma.registerHeartbeat.findMany({ where: { registerDevice: { locationId, revokedAt: null } },
      select: { registerDeviceId: true, lastSeenAt: true, userId: true, sessionId: true, registerDevice: { select: { name: true } } } }),
    prisma.storeAlertSetting.findUnique({ where: { locationId } }),
    prisma.storeAlert.count({ where: { locationId, key: { startsWith: `pulse:quiet:${today}:` } } }),
    prisma.storeAlert.findMany({ where: { locationId, resolvedAt: null, kind: { in: PULSE_KINDS } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { key: true, kind: true, severity: true, sentence: true, href: true, createdAt: true } }),
  ]);
  const sessionIds = heartbeats.flatMap(beat => beat.sessionId ? [beat.sessionId] : []);
  const live = new Set(sessionIds.length ? (await prisma.refreshToken.findMany({ where: { id: { in: sessionIds }, isRevoked: false, expiresAt: { gt: now } }, select: { id: true } })).map(row => row.id) : []);
  const state: PulseState = {
    timezone, now, today, weekday, minute: Math.floor((now.getTime() - todayStart.getTime()) / 60000),
    closedToday: settings?.closedDay === today,
    switches: { notOpen: settings?.pulseNotOpen ?? true, quiet: settings?.pulseQuiet ?? true, register: settings?.pulseRegister ?? true, leftOpen: settings?.pulseLeftOpen ?? true },
    openDrawers: openShifts.map(shift => {
      const day = storeDay(timezone, shift.clockInAt), [year, month, date] = day.date.split('-').map(Number);
      return { shiftId: shift.id, userId: shift.userId, name: shift.user.firstName, openedAt: shift.clockInAt, weekday: day.weekday,
        minutesIntoDay: Math.floor((now.getTime() - calendar.midnight(year, month, date).getTime()) / 60000) };
    }),
    lastClosed: lastClosed?.clockOutAt ? { at: lastClosed.clockOutAt, name: lastClosed.user.firstName } : null,
    lastSaleAt: lastSale?.createdAt ?? null,
    registers: heartbeats.map(beat => ({ id: beat.registerDeviceId, name: beat.registerDevice.name, lastSeenAt: beat.lastSeenAt, userId: beat.userId,
      sessionLive: !!beat.sessionId && live.has(beat.sessionId) })),
    quietAlertsToday,
  };
  return { state, patterns, open };
}

/** One store: raise what is new (owners and managers hear it), close what has cleared. */
export async function pulseStore(locationId: string, timezone: string, now = new Date()) {
  const { state, patterns, open } = await loadPulse(locationId, timezone, now);
  const { raise, holds } = checkPulse(state, patterns);
  const openKeys = new Set(open.map(alert => alert.key));
  const raised: string[] = [], resolved: string[] = [];
  for (const alert of raise) if (!openKeys.has(alert.key) && await raiseStoreAlert(locationId, { ...alert, audience: 'LEADS' })) raised.push(alert.key);
  for (const key of openKeys) if (!holds.has(key)) { await resolveStoreAlert(locationId, key, now); resolved.push(key); }
  return { raised, resolved };
}

/** For the Shifts page and My Stores: open since, last sale, the usual hours and the open alerts. */
export async function pulseStatus(locationId: string, timezone: string, now = new Date()) {
  const { state, patterns, open } = await loadPulse(locationId, timezone, now);
  const today = patterns[state.weekday];
  return {
    today: state.today, closedToday: state.closedToday,
    openDrawers: state.openDrawers.length, openSince: state.openDrawers[0]?.openedAt ?? null, lastSaleAt: state.lastSaleAt,
    learning: !today.learned,
    usual: today.learned && today.opensAt !== null
      ? { weekday: WEEKDAYS[state.weekday], opensAt: usualText(today.opensAt), closesAt: today.closesAt === null ? null : usualText(today.closesAt) } : null,
    alerts: open.map(({ kind, severity, sentence, href, createdAt }) => ({ kind, severity, sentence, href, createdAt })),
  };
}

/** "The store is closed today" (or open after all): no opening or quiet alerts on this store day. */
export async function setClosedToday(locationId: string, userId: string, closed: boolean, now = new Date()) {
  const store = await prisma.location.findUnique({ where: { id: locationId }, select: { timezone: true } });
  const closedDay = closed ? storeDay(store?.timezone || 'UTC', now).date : null;
  await prisma.storeAlertSetting.upsert({ where: { locationId }, create: { locationId, closedDay, closedById: userId }, update: { closedDay, closedById: userId } });
  if (closed) await resolvePulseKinds(locationId, ['PULSE_NOT_OPEN', 'PULSE_QUIET'], now);
  return closedDay;
}

/** Closes every open alert of these kinds at once (closed today, or a switch turned off). */
export async function resolvePulseKinds(locationId: string, kinds: PulseKind[], now = new Date()) {
  if (kinds.length) await prisma.storeAlert.updateMany({ where: { locationId, resolvedAt: null, kind: { in: kinds } }, data: { resolvedAt: now } });
}

/**
 * A register reports in. At most one write a minute per register, unless a different
 * session is now signed in on it.
 */
export async function recordHeartbeat(registerDeviceId: string, userId: string, sessionId: string, now = new Date()) {
  const updated = await prisma.registerHeartbeat.updateMany({
    where: { registerDeviceId, OR: [{ lastSeenAt: { lt: new Date(now.getTime() - 50000) } }, { sessionId: null }, { sessionId: { not: sessionId } }] },
    data: { lastSeenAt: now, userId, sessionId },
  });
  if (updated.count) return true;
  return (await prisma.registerHeartbeat.createMany({ data: [{ registerDeviceId, lastSeenAt: now, userId, sessionId }], skipDuplicates: true })).count > 0;
}

/** The same failure is logged at most once an hour (a store database not yet migrated would otherwise log every minute). */
const lastWarned = new Map<string, number>();
function warnHourly(message: string) {
  const at = Date.now();
  if ((lastWarned.get(message) ?? 0) > at - 3600000) return;
  lastWarned.set(message, at);
  logger.warn(message);
}

/** Every active store, once. A store that fails is skipped, never the rest. */
export async function runStorePulse(now = new Date()) {
  const stores = await prisma.location.findMany({ where: { isActive: true }, select: { id: true, timezone: true } });
  for (const store of stores) {
    try { await pulseStore(store.id, store.timezone || 'UTC', now); }
    catch (error) { warnHourly('Store Pulse could not check a store: ' + (error instanceof Error ? error.message.trim().split('\n').pop() : 'unknown error')); }
  }
}

let running = false;
/** Checks every store once a minute. Disabled with STORE_PULSE_DISABLED=true. */
export function startStorePulseScheduler(): void {
  if (process.env.STORE_PULSE_DISABLED === 'true') { logger.info('Store Pulse disabled (STORE_PULSE_DISABLED=true)'); return; }
  setInterval(() => {
    if (running) return;
    running = true;
    void runStorePulse().catch(error => warnHourly('Store Pulse failed: ' + (error instanceof Error ? error.message.trim().split('\n').pop() : 'unknown error')))
      .finally(() => { running = false; });
  }, 60 * 1000);
  logger.info('Store Pulse started: every store is checked once a minute');
}
