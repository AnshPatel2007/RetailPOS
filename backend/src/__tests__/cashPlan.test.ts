import { addDays, aboutUsd, datesOnWeekdays, depositDay, exactUsd, median, netTermsDays, planCash, plannedItemDates, tightSentence, weekdayOf, weekdaySales, CashPlanInput } from '../services/cashPlan';
import { nextRecurringDate, recurringDatesBetween } from '../services/recurringDates';

// Monday, November 16, 2026.
const today = '2026-11-16';
/** Six weeks of history: the same takings on each weekday, and one unusual Friday. */
const history = () => {
  const usual = [1200, 1000, 800, 900, 1100, 1500, 2000]; // Sunday ... Saturday
  const sales: Record<string, number> = {};
  for (let back = 1; back <= 42; back++) { const day = addDays(today, -back); sales[day] = usual[weekdayOf(day)]; }
  sales['2026-11-06'] = 5000;
  return sales;
};
const input = (change: Partial<CashPlanInput> = {}): CashPlanInput => ({
  today, dailySales: history(), firstSaleDay: '2026-01-02', paymentMix: { cash: 40, card: 50, other: 10 },
  recentCardSales: { '2026-11-12': 500, '2026-11-13': 700, '2026-11-14': 1000, '2026-11-15': 600 },
  cardDepositDays: 2, cardFeePercent: 3, lottery: null, startingMoney: null, entries: [], ...change,
});
const thursdayBills = [
  { date: '2026-11-19', key: 'bill:rent', flow: 'OUT' as const, kind: 'BILL' as const, label: 'Rent', amount: 1950, estimate: false },
  { date: '2026-11-19', key: 'delivery:bud', flow: 'OUT' as const, kind: 'DELIVERY' as const, label: 'Budweiser delivery', amount: 2100, estimate: true },
  { date: '2026-11-19', key: 'payroll', flow: 'OUT' as const, kind: 'PAYROLL' as const, label: 'Payroll', amount: 1850, estimate: true },
];

describe('Money Ahead plan', () => {
  it('expects each weekday\'s usual sales: the median of the last six, from the first sale on', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    // The unusual Friday does not move Friday's median.
    expect(weekdaySales(today, history(), '2026-01-02')).toEqual([1200, 1000, 800, 900, 1100, 1500, 2000]);
    // A store open three weeks does not know its weekdays yet; days without sales count as none.
    expect(weekdaySales(today, {}, '2026-10-26').every(value => value === null)).toBe(true);
    expect(weekdaySales(today, {}, '2026-10-05')).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(weekdaySales(today, history(), null).every(value => value === null)).toBe(true);
  });

  it('puts card money on its business-day deposit date', () => {
    expect(depositDay('2026-11-12', 2)).toBe('2026-11-16'); // Thursday -> Monday
    expect(depositDay('2026-11-13', 2)).toBe('2026-11-17'); // Friday -> Tuesday
    expect(depositDay('2026-11-14', 2)).toBe('2026-11-17'); // Saturday -> Tuesday
    expect(depositDay('2026-11-14', 1)).toBe('2026-11-16'); // Saturday -> Monday
    expect(depositDay('2026-11-14', 0)).toBe('2026-11-14');
  });

  it('dates weekly, monthly and one-off items, and reads net payment terms', () => {
    expect(datesOnWeekdays([2, 5], '2026-11-16', '2026-11-22')).toEqual(['2026-11-17', '2026-11-20']);
    const item = { date: null, weekday: null, dayOfMonth: null, endsOn: null };
    expect(plannedItemDates({ ...item, repeat: 'ONCE', date: '2026-11-20' }, today, '2026-11-29')).toEqual(['2026-11-20']);
    expect(plannedItemDates({ ...item, repeat: 'ONCE', date: '2026-11-10' }, today, '2026-11-29')).toEqual([]);
    expect(plannedItemDates({ ...item, repeat: 'WEEKLY', weekday: 3, endsOn: '2026-11-24' }, today, '2026-11-29')).toEqual(['2026-11-18']);
    // The 31st falls on the last day of a shorter month.
    expect(plannedItemDates({ ...item, repeat: 'MONTHLY', dayOfMonth: 31 }, today, '2026-12-31')).toEqual(['2026-11-30', '2026-12-31']);
    expect([netTermsDays('Net 15'), netTermsDays('NET-30 days'), netTermsDays('COD'), netTermsDays(null)]).toEqual([15, 30, 0, 0]);
  });

  it('steps recurring expenses the way Generate Due Expenses does', () => {
    const monthly = { frequency: 'MONTHLY', dayOfMonth: 31, startDate: new Date('2026-01-31T00:00:00Z'), nextDueDate: new Date('2026-10-31T00:00:00Z'), endDate: null };
    expect(nextRecurringDate(new Date('2026-11-30T00:00:00Z'), monthly).toISOString().slice(0, 10)).toBe('2026-12-31');
    // Dates before the plan are skipped, not moved into it.
    expect(recurringDatesBetween(monthly, today, '2026-12-31')).toEqual(['2026-11-30', '2026-12-31']);
    const weekly = { frequency: 'WEEKLY', dayOfMonth: null, startDate: new Date('2026-11-02T00:00:00Z'), nextDueDate: new Date('2026-11-02T00:00:00Z'), endDate: new Date('2026-11-23T00:00:00Z') };
    expect(recurringDatesBetween(weekly, today, '2026-11-29')).toEqual(['2026-11-16', '2026-11-23']);
  });

  it('brings in cash the same day and card deposits later, less the card fee', () => {
    const plan = planCash(input());
    const day = (date: string) => plan.days.find(entry => entry.date === date)!;
    expect(plan.days).toHaveLength(14);
    expect(plan.learning).toBe(false);
    // Monday: today's cash, and Thursday's card sales.
    expect(day('2026-11-16').entries.map(entry => [entry.label, entry.amount])).toEqual([['Card deposit', 485], ['Cash sales', 400]]);
    // Tuesday: the weekend's card sales together.
    expect(day('2026-11-17').entries.find(entry => entry.kind === 'CARD_DEPOSIT')).toMatchObject({ amount: 2231, saleDays: ['2026-11-13', '2026-11-14', '2026-11-15'] });
    // Wednesday: Monday's expected card sales (half of $1,000, less 3%).
    expect(day('2026-11-18').in).toBe(845);
    expect(plan.startingMoney).toBeNull();
    expect(plan.totals.lowest).toBeNull();
    expect(plan.days.every(entry => entry.balance === null)).toBe(true);
  });

  it('says a day looks tight when far more goes out than comes in', () => {
    const plan = planCash(input({ entries: [...thursdayBills, { ...thursdayBills[0], date: '2026-12-15', key: 'later' }] }));
    expect(plan.days.find(day => day.date === '2026-11-19')).toMatchObject({ in: 828, out: 5900 });
    // An entry past the plan's last day is left out.
    expect(plan.totals.out).toBe(5900);
    expect(plan.tight).toMatchObject({ date: '2026-11-19', short: false });
    expect(tightSentence(plan.tight!, today)).toBe('Thursday looks tight: about $5,900 goes out (Budweiser delivery about $2,100, Rent $1,950 and Payroll about $1,850) and about $830 comes in.');
    // More than three payments: the three biggest are named as part of it.
    const more = planCash(input({ entries: [...thursdayBills, { ...thursdayBills[0], key: 'bill:power', label: 'Electric', amount: 412.5 }] }));
    expect(tightSentence(more.tight!, today)).toContain('goes out (including Budweiser delivery about $2,100, Rent $1,950 and Payroll about $1,850)');
  });

  it('with money today, shows what is left each day and the lowest point, and is tight only when it runs short', () => {
    const enough = planCash(input({ entries: thursdayBills, startingMoney: 3000 }));
    expect(enough.days.slice(0, 4).map(day => day.balance)).toEqual([3885, 6436, 7281, 2209]);
    expect(enough.tight).toBeNull();
    const short = planCash(input({ entries: thursdayBills, startingMoney: 100 }));
    expect(short.totals.lowest).toEqual({ date: '2026-11-19', balance: -691 });
    expect(tightSentence(short.tight!, today)).toBe('Thursday looks tight: about $5,900 goes out (Budweiser delivery about $2,100, Rent $1,950 and Payroll about $1,850) and about $830 comes in, so the business would be about $690 short.');
  });

  it('never calls a day tight while still learning the store\'s weekdays', () => {
    const plan = planCash(input({ firstSaleDay: '2026-10-26', entries: thursdayBills }));
    expect(plan.learning).toBe(true);
    expect(plan.tight).toBeNull();
    // Card sales already made still arrive.
    expect(plan.days[0].entries.map(entry => entry.kind)).toEqual(['CARD_DEPOSIT']);
  });

  it('brings in lottery sales each day and sweeps about a week of them on the sweep day', () => {
    const plan = planCash(input({ lottery: { sweepWeekday: 3, dailyAverage: 500, recent: { '2026-11-13': 450, '2026-11-14': 700 } } }));
    const wednesday = plan.days.find(day => day.date === '2026-11-18')!;
    // Recorded days where known (Friday $450, Saturday $700), the usual $500 for the other five.
    expect(wednesday.entries.find(entry => entry.kind === 'LOTTERY_SWEEP')).toMatchObject({ amount: 3650, estimate: true });
    expect(plan.days.every(day => day.entries.some(entry => entry.kind === 'LOTTERY_SALES' && entry.amount === 500))).toBe(true);
    expect(plan.days.filter(day => day.entries.some(entry => entry.kind === 'LOTTERY_SWEEP')).map(day => day.date)).toEqual(['2026-11-18', '2026-11-25']);
  });

  it('writes about-figures plainly', () => {
    expect([aboutUsd(828), aboutUsd(1847.33), aboutUsd(5912.4), aboutUsd(24863), aboutUsd(-691)]).toEqual(['$830', '$1,850', '$5,910', '$24,900', '$690']);
    expect([exactUsd(1950), exactUsd(1950.5)]).toEqual(['$1,950', '$1,950.50']);
  });
});
