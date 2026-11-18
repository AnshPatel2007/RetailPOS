import { checkPulse, clockText, hourRangeText, learnPatterns, median, minuteText, OpenDrawer, PastDay, PulseState, usualText } from '../services/storePulse';

// A store in Chicago (CST, UTC-6 in November). "Today" is Tuesday, November 10, 2026.
const zone = 'America/Chicago';
const at = (local: string) => new Date(local + ':00-06:00');
const weekdayOf = (date: string) => new Date(date + 'T12:00:00Z').getUTCDay();
const dayBefore = (date: string, back: number) => new Date(Date.parse(date + 'T12:00:00Z') - back * 86400000).toISOString().slice(0, 10);

/** Six weeks: open about 6:00 AM, closed by 11:00 PM, closed on Sundays; 6 sales an hour, 14 between 5 and 6 PM, 2 between 6 and 7 AM. */
const history = (): PastDay[] => {
  const openings = [355, 360, 365, 358, 362, 360];
  const days: PastDay[] = [];
  for (let back = 1; back <= 42; back++) {
    const date = dayBefore('2026-11-10', back), weekday = weekdayOf(date);
    if (weekday === 0) continue;
    const salesByHour = Array.from({ length: 24 }, (_, hour) => hour === 6 ? 2 : hour === 17 ? 14 : hour > 6 && hour < 23 ? 6 : 0);
    days.push({ date, weekday, opened: openings[Math.floor((back - 1) / 7)], closed: 1380, salesByHour });
  }
  return days;
};
const patterns = learnPatterns(history());
/** The store's clock at a local time. */
const when = (local: string) => ({ now: at(local), today: local.slice(0, 10), weekday: weekdayOf(local.slice(0, 10)),
  minute: Number(local.slice(11, 13)) * 60 + Number(local.slice(14, 16)) });
const drawer = (opened: string, now: string, name = 'Maria'): OpenDrawer => ({ shiftId: 'shift-' + name, userId: 'user-' + name, name, openedAt: at(opened),
  weekday: weekdayOf(opened.slice(0, 10)), minutesIntoDay: Math.floor((at(now).getTime() - at(opened.slice(0, 10) + 'T00:00').getTime()) / 60000) });
const state = (local: string, change: Partial<PulseState> = {}): PulseState => ({
  timezone: zone, ...when(local), closedToday: false, switches: { notOpen: true, quiet: true, register: true, leftOpen: true },
  openDrawers: [], lastClosed: null, lastSaleAt: at('2026-11-09T22:41'), registers: [], quietAlertsToday: 0, ...change,
});
const sentences = (input: PulseState) => checkPulse(input, patterns).raise.map(alert => alert.sentence);

describe('Store Pulse: the store\'s own pattern', () => {
  it('learns each weekday from its last six open days, as medians', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
    const tuesday = patterns[2];
    expect(tuesday).toMatchObject({ weekday: 2, days: 6, learned: true, opensAt: 360, closesAt: 1380 });
    expect(tuesday.salesByHour.slice(5, 8)).toEqual([0, 2, 6]);
    expect(tuesday.salesByHour[17]).toBe(14);
    // Closed on Sundays: never learned, so never an alert on a Sunday.
    expect(patterns[0]).toMatchObject({ days: 0, learned: false, opensAt: null });
  });

  it('needs three open days of a weekday, and only the latest six count', () => {
    const two = history().filter(day => day.weekday !== 2 || day.date >= '2026-10-27');
    expect(learnPatterns(two)[2]).toMatchObject({ days: 2, learned: false });
    const old = [...history(), { date: '2026-09-22', weekday: 2, opened: 600, closed: 700, salesByHour: new Array(24).fill(50) }];
    expect(learnPatterns(old)[2]).toMatchObject({ days: 6, opensAt: 360, closesAt: 1380 });
    // A day whose drawers never closed still counts for the opening, not the closing.
    const unclosed = history().map(day => day.date === '2026-11-03' ? { ...day, closed: null } : day);
    expect(learnPatterns(unclosed)[2]).toMatchObject({ days: 6, closesAt: 1380 });
  });

  it('says times the way a store does', () => {
    expect([minuteText(360), minuteText(0), minuteText(1380), minuteText(1530), minuteText(725)]).toEqual(['6:00 AM', '12:00 AM', '11:00 PM', '1:30 AM', '12:05 PM']);
    expect(usualText(357)).toBe('5:55 AM');
    expect([hourRangeText(17), hourRangeText(11), hourRangeText(23), hourRangeText(12)])
      .toEqual(['between 5 and 6 PM', 'between 11 AM and 12 PM', 'between 11 PM and 12 AM', 'between 12 and 1 PM']);
    expect(clockText(at('2026-11-10T06:25'), zone)).toBe('6:25 AM');
    expect(clockText(at('2026-11-10T00:07'), zone)).toBe('12:07 AM');
  });
});

describe('Store Pulse: nobody on the register', () => {
  it('speaks 20 minutes after the usual opening, once nobody has clocked in', () => {
    expect(sentences(state('2026-11-10T06:19'))).toEqual([]);
    const late = checkPulse(state('2026-11-10T06:20'), patterns);
    expect(late.raise).toEqual([{ key: 'pulse:not-open:2026-11-10', kind: 'PULSE_NOT_OPEN', severity: 'high', href: '/team-time/shifts',
      sentence: 'Nobody had clocked in by 6:20 AM. On Tuesdays the store usually opens by 6:00 AM.' }]);
    // Before the time it already holds, so an alert raised by another server is not closed early.
    expect(checkPulse(state('2026-11-10T06:19'), patterns).holds.has('pulse:not-open:2026-11-10')).toBe(true);
  });

  it('stays silent when a drawer is open, the store is closed today, the switch is off, or the weekday is still being learned', () => {
    const open = checkPulse(state('2026-11-10T06:40', { openDrawers: [drawer('2026-11-10T06:30', '2026-11-10T06:40')], lastSaleAt: at('2026-11-10T06:35') }), patterns);
    expect(open.raise.filter(alert => alert.kind === 'PULSE_NOT_OPEN')).toEqual([]);
    expect(open.holds.has('pulse:not-open:2026-11-10')).toBe(false);
    for (const quiet of [{ closedToday: true }, { switches: { notOpen: false, quiet: true, register: true, leftOpen: true } }]) {
      const result = checkPulse(state('2026-11-10T07:00', quiet), patterns);
      expect(result.raise).toEqual([]);
      expect(result.holds.size).toBe(0);
    }
    expect(sentences(state('2026-11-08T07:00'))).toEqual([]); // a Sunday
  });

  it('later in the day names the drawer that closed, and stops near the usual closing', () => {
    const closed = { at: at('2026-11-10T14:02'), name: 'Sam' };
    expect(sentences(state('2026-11-10T14:21', { lastClosed: closed, lastSaleAt: at('2026-11-10T13:58') }))).toEqual([]);
    expect(checkPulse(state('2026-11-10T14:22', { lastClosed: closed, lastSaleAt: at('2026-11-10T13:58') }), patterns).raise).toEqual([{
      key: 'pulse:nobody:2026-11-10:' + closed.at.toISOString(), kind: 'PULSE_NOT_OPEN', severity: 'medium', href: '/team-time/shifts',
      sentence: 'Nobody has been on the register since 2:02 PM, when Sam\'s drawer closed. On Tuesdays the store is usually open until 11:00 PM.' }]);
    expect(sentences(state('2026-11-10T22:45', { lastClosed: { at: at('2026-11-10T21:00'), name: 'Sam' }, lastSaleAt: at('2026-11-10T20:58') }))).toEqual([]);
  });
});

describe('Store Pulse: a quiet register', () => {
  const open = (local: string, change: Partial<PulseState> = {}) => state(local, { openDrawers: [drawer('2026-11-10T06:00', local)], ...change });

  it('speaks after as long as five of this hour\'s usual sales take', () => {
    // 14 sales between 5 and 6 PM: five take about 22 minutes.
    expect(sentences(open('2026-11-10T17:21', { lastSaleAt: at('2026-11-10T17:00') }))).toEqual([]);
    expect(checkPulse(open('2026-11-10T17:22', { lastSaleAt: at('2026-11-10T17:00') }), patterns).raise).toEqual([{
      key: 'pulse:quiet:2026-11-10:' + at('2026-11-10T17:00').toISOString(), kind: 'PULSE_QUIET', severity: 'medium', href: '/team-time/shifts',
      sentence: 'No sale since 5:00 PM. Tuesday between 5 and 6 PM usually has about 14 sales.' }]);
    // 6 an hour: 50 minutes.
    expect(sentences(open('2026-11-10T10:49', { lastSaleAt: at('2026-11-10T10:00') }))).toEqual([]);
    expect(sentences(open('2026-11-10T10:50', { lastSaleAt: at('2026-11-10T10:00') }))).toHaveLength(1);
  });

  it('keeps between 20 and 90 minutes, never in an hour that usually has under 3 sales, and 3 a day at most', () => {
    const busy = learnPatterns(history().map(day => ({ ...day, salesByHour: day.salesByHour.map((count, hour) => hour === 12 ? 40 : count) })));
    expect(checkPulse(open('2026-11-10T12:19', { lastSaleAt: at('2026-11-10T12:00') }), busy).raise).toEqual([]);
    expect(checkPulse(open('2026-11-10T12:20', { lastSaleAt: at('2026-11-10T12:00') }), busy).raise).toHaveLength(1);
    const slow = learnPatterns(history().map(day => ({ ...day, salesByHour: day.salesByHour.map((count, hour) => hour === 9 ? 3 : count) })));
    expect(checkPulse(open('2026-11-10T09:59', { lastSaleAt: at('2026-11-10T08:30') }), slow).raise).toEqual([]);
    expect(checkPulse(open('2026-11-10T09:59', { lastSaleAt: at('2026-11-10T08:29') }), slow).raise).toHaveLength(1);
    // 2 sales between 6 and 7 AM: a quiet first hour is normal.
    expect(sentences(open('2026-11-10T06:59', { lastSaleAt: at('2026-11-09T22:41') }))).toEqual([]);
    const third = checkPulse(open('2026-11-10T17:40', { lastSaleAt: at('2026-11-10T17:00'), quietAlertsToday: 3 }), patterns);
    expect(third.raise).toEqual([]);
    expect(third.holds.has('pulse:quiet:2026-11-10:' + at('2026-11-10T17:00').toISOString())).toBe(true);
  });

  it('counts from the drawer opening when nothing has sold since, and is silenced by closed today', () => {
    const fresh = state('2026-11-10T17:25', { openDrawers: [drawer('2026-11-10T17:00', '2026-11-10T17:25')] });
    expect(sentences(fresh)).toEqual(['No sale since the drawer opened at 5:00 PM. Tuesday between 5 and 6 PM usually has about 14 sales.']);
    expect(checkPulse({ ...fresh, closedToday: true }, patterns).raise).toEqual([]);
  });
});

describe('Store Pulse: a register not heard from', () => {
  const maria = drawer('2026-11-10T06:00', '2026-11-10T14:19');
  const register = (change = {}) => ({ id: 'reg-1', name: 'Register 1', lastSeenAt: at('2026-11-10T14:14'), userId: 'user-Maria', sessionLive: true, ...change });
  const check = (local: string, change: Partial<PulseState> = {}) =>
    checkPulse(state(local, { openDrawers: [maria], lastSaleAt: at('2026-11-10T14:13'), registers: [register()], switches: { notOpen: true, quiet: false, register: true, leftOpen: true }, ...change }), patterns);

  it('speaks after 5 minutes while the person on it has a drawer open', () => {
    expect(check('2026-11-10T14:18').raise).toEqual([]);
    expect(check('2026-11-10T14:19').raise).toEqual([{ key: 'pulse:register:reg-1:' + at('2026-11-10T14:14').toISOString(), kind: 'PULSE_REGISTER', severity: 'high',
      href: '/team-time/shifts', sentence: 'Register 1 has not been heard from since 2:14 PM and Maria\'s drawer is still open. If only its connection is down, it can keep taking cash sales.' }]);
  });

  it('stays silent when the person signed out, works on another register, opened the drawer later, or the switch is off', () => {
    expect(check('2026-11-10T14:30', { registers: [register({ sessionLive: false })] }).raise).toEqual([]);
    expect(check('2026-11-10T14:30', { registers: [register(), register({ id: 'reg-2', name: 'Register 2', lastSeenAt: at('2026-11-10T14:28') })] }).raise).toEqual([]);
    expect(check('2026-11-10T14:40', { openDrawers: [drawer('2026-11-10T14:30', '2026-11-10T14:40')] }).raise).toEqual([]);
    expect(check('2026-11-10T14:30', { openDrawers: [] }).raise.filter(alert => alert.kind === 'PULSE_REGISTER')).toEqual([]);
    expect(check('2026-11-10T14:30', { switches: { notOpen: true, quiet: false, register: false, leftOpen: true } }).raise).toEqual([]);
  });
});

describe('Store Pulse: a drawer left open', () => {
  it('speaks an hour after its day\'s usual closing with no sale for 30 minutes, and holds until it closes', () => {
    const tuesdayDrawer = (now: string) => drawer('2026-11-10T16:00', now);
    const lateNight = (now: string, lastSale = '2026-11-10T22:41') =>
      checkPulse(state(now, { openDrawers: [tuesdayDrawer(now)], lastSaleAt: at(lastSale), switches: { notOpen: false, quiet: false, register: true, leftOpen: true } }), patterns);
    expect(lateNight('2026-11-10T23:59').raise).toEqual([]);
    expect(lateNight('2026-11-10T23:59').holds.has('pulse:left-open:shift-Maria')).toBe(true);
    expect(lateNight('2026-11-11T00:00').raise).toEqual([{ key: 'pulse:left-open:shift-Maria', kind: 'PULSE_LEFT_OPEN', severity: 'medium', href: '/team-time/shifts',
      sentence: 'Maria\'s drawer is still open at 12:00 AM. On Tuesdays the store usually closes by 11:00 PM; the last sale was at 10:41 PM.' }]);
    expect(lateNight('2026-11-11T00:10', '2026-11-10T23:50').raise).toEqual([]);
    expect(lateNight('2026-11-11T00:30', '2026-11-09T22:00').raise.map(alert => alert.sentence))
      .toEqual(['Maria\'s drawer is still open at 12:30 AM. On Tuesdays the store usually closes by 11:00 PM; there has been no sale since it opened at 4:00 PM.']);
  });
});
