import { Prisma } from '@prisma/client';

export type Numeric<T> = T extends Prisma.Decimal ? number : T extends Date ? Date : T extends readonly (infer U)[] ? Numeric<U>[] : T extends object ? { [K in keyof T]: Numeric<T[K]> } : T;

/** Explicit compatibility boundary for existing numeric contracts. Storage and
 * atomic database balance operations retain Decimal precision. */
export function numeric<T>(value: T): Numeric<T> {
  if (Prisma.Decimal.isDecimal(value)) return value.toNumber() as Numeric<T>;
  if (value === null || typeof value !== 'object' || value instanceof Date) return value as Numeric<T>;
  if (Array.isArray(value)) return value.map(numeric) as Numeric<T>;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, numeric(item)])) as Numeric<T>;
}

/** Express calls toJSON before its replacer. Inspect the original property so
 * decimal database fields keep the established numeric JSON API contract. */
export function moneyJson(this: Record<string, unknown>, key: string, value: unknown) {
  const original = this[key];
  return Prisma.Decimal.isDecimal(original) ? original.toNumber() : value;
}

export const moneyCents = (amount: number | Prisma.Decimal) => new Prisma.Decimal(amount).mul(100).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toNumber();
export const bookedMoney = (amount: number | Prisma.Decimal) => new Prisma.Decimal(amount).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
