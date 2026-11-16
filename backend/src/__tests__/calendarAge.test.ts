import { ageOn, parseCalendarDate } from '../utils/calendarAge';

describe('age from calendar dates', () => {
  it('reads a written date of birth as that calendar date', () => {
    expect(parseCalendarDate('2005-11-15')).toEqual({ year: 2005, month: 11, day: 15 });
    expect(parseCalendarDate(' 2005-11-15T00:00:00-06:00 ')).toEqual({ year: 2005, month: 11, day: 15 });
    // Another form is read as a timestamp; its UTC date is used.
    expect(parseCalendarDate('2005-11-15T06:00:00.000Z')).toEqual({ year: 2005, month: 11, day: 15 });
  });
  it('refuses what is not a real date', () => {
    for (const value of ['2005-02-30', '2005-13-01', 'yesterday', '', undefined, 20051115]) expect(parseCalendarDate(value)).toBeNull();
  });
  it('counts a year only from the birthday itself', () => {
    const birth = { year: 2005, month: 11, day: 15 };
    expect(ageOn(birth, { year: 2026, month: 11, day: 14 })).toBe(20);
    expect(ageOn(birth, { year: 2026, month: 11, day: 15 })).toBe(21);
    expect(ageOn(birth, { year: 2026, month: 12, day: 1 })).toBe(21);
    expect(ageOn(birth, { year: 2026, month: 10, day: 31 })).toBe(20);
    // Born on Feb 29: the birthday falls on Mar 1 in a year without one.
    expect(ageOn({ year: 2004, month: 2, day: 29 }, { year: 2025, month: 2, day: 28 })).toBe(20);
    expect(ageOn({ year: 2004, month: 2, day: 29 }, { year: 2025, month: 3, day: 1 })).toBe(21);
  });
});
