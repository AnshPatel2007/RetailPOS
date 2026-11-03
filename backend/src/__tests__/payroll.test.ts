jest.mock('../config/database', () => ({ __esModule: true, default: {} }));
import { payrollPeriod, shiftWageSegments } from '../services/payroll.service';

test('weekly boundaries use store midnight, including the spring DST change', () => {
  const period = payrollPeriod(new Date('2026-03-08T18:00:00Z'),'WEEKLY','America/Chicago');
  expect(period.start.toISOString()).toBe('2026-03-02T06:00:00.000Z');
  expect(period.end.toISOString()).toBe('2026-03-09T05:00:00.000Z');
});
test('month boundaries use the local calendar, not UTC date', () => {
  const period = payrollPeriod(new Date('2026-02-01T03:00:00Z'),'MONTHLY','America/Chicago');
  expect(period.start.toISOString()).toBe('2026-01-01T06:00:00.000Z');
  expect(period.end.toISOString()).toBe('2026-02-01T06:00:00.000Z');
});
test('an overnight shift crossing a weekly boundary splits hours and pay', () => {
  const rows = shiftWageSegments({ clockInAt: new Date('2026-01-26T04:00:00Z'), clockOutAt: new Date('2026-01-26T08:00:00Z'), hourlyRate: 20, payrollFrequency: 'WEEKLY', payrollTimezone: 'America/Chicago' });
  expect(rows).toHaveLength(2);
  expect(rows.map(r => r.seconds)).toEqual([7200,7200]);
  expect(rows.map(r => r.grossPay)).toEqual([40,40]);
});
test('actual elapsed hours remain correct when the clock repeats in fall', () => {
  const rows = shiftWageSegments({ clockInAt: new Date('2026-11-01T05:00:00Z'), clockOutAt: new Date('2026-11-01T09:00:00Z'), hourlyRate: 15, payrollFrequency: 'MONTHLY', payrollTimezone: 'America/Chicago' });
  expect(rows.reduce((s,r) => s+r.seconds,0)).toBe(14400);
  expect(rows.reduce((s,r) => s+r.grossPay,0)).toBe(60);
});
test('missing rates and open shifts never invent payroll', () => {
  expect(shiftWageSegments({ clockInAt: new Date(), clockOutAt: null, hourlyRate: 20, payrollFrequency: 'WEEKLY', payrollTimezone: 'UTC' })).toEqual([]);
  expect(shiftWageSegments({ clockInAt: new Date(0), clockOutAt: new Date(), hourlyRate: null, payrollFrequency: 'WEEKLY', payrollTimezone: 'UTC' })).toEqual([]);
});
