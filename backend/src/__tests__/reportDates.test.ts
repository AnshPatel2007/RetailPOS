import { reportCalendar } from '../services/reportDates.service';

test('report days follow the store calendar instead of the server or UTC date', () => {
  const day = reportCalendar('America/Chicago', new Date('2026-10-16T02:00:00Z'));
  expect(day.day().toISOString()).toBe('2026-10-15T05:00:00.000Z');
  expect(day.monthStart().toISOString()).toBe('2026-10-01T05:00:00.000Z');
  expect(day.yearStart().toISOString()).toBe('2026-01-01T06:00:00.000Z');
});

test('spring and fall report days contain 23 and 25 hours', () => {
  const spring = reportCalendar('America/Chicago', new Date('2026-03-08T18:00:00Z'));
  const fall = reportCalendar('America/Chicago', new Date('2026-11-01T18:00:00Z'));
  expect((spring.day(1).getTime() - spring.day().getTime()) / 3600000).toBe(23);
  expect((fall.day(1).getTime() - fall.day().getTime()) / 3600000).toBe(25);
});

test('invalid store zones are explicit configuration errors', () => {
  expect(() => reportCalendar('Invalid/Zone')).toThrow('store timezone');
});
