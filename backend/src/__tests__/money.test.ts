import { Prisma } from '@prisma/client';
import { numeric, moneyJson, moneyCents } from '../utils/money';
import { toCents, roundMoney, lineMoney, taxMoney } from '../utils/moneyNumbers';

describe('One decimal rounding policy for server and register', () => {
  it.each([[1.005, 101], [2.675, 268], [-1.005, -101], [0.005, 1], [0.0049, 0], [1e-7, 0], [89.98, 8998]])('books %s as %s cents', (input, expected) => {
    expect(toCents(input)).toBe(expected); expect(moneyCents(input)).toBe(expected); expect(roundMoney(input)).toBe(expected / 100);
  });
  it('rounds after multiplying the unit price and rounds tax once per line', () => {
    expect(lineMoney(1.005, 3)).toBe(3.02); expect(lineMoney(0.3333, 3)).toBe(1);
    expect(taxMoney(89.98, 8.875)).toBe(7.99); expect(taxMoney(1, 0.5)).toBe(0.01);
    expect(taxMoney(-1, 0.5)).toBe(-0.01);
  });
  it('rejects nonfinite money and quantities beyond exact integer precision', () => {
    expect(() => toCents(NaN)).toThrow(); expect(() => toCents(Infinity)).toThrow();
    expect(() => lineMoney(1, 1.5)).toThrow(); expect(() => toCents(Number.MAX_SAFE_INTEGER)).toThrow();
  });
  it('converts Decimal values at numeric boundaries while preserving strings, null and dates', () => {
    const at = new Date('2026-01-01T00:00:00Z');
    const data = { amount: new Prisma.Decimal('12.34'), unknown: null, code: '00012', at, items: [{ cost: new Prisma.Decimal('0.1234') }] };
    expect(numeric(data)).toEqual({ amount: 12.34, unknown: null, code: '00012', at, items: [{ cost: 0.1234 }] });
    expect(JSON.parse(JSON.stringify(data, moneyJson))).toEqual({ amount: 12.34, unknown: null, code: '00012', at: at.toISOString(), items: [{ cost: 0.1234 }] });
  });
});
