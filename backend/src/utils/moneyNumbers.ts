// Shared with the register. Decimal input digits, integer arithmetic and one
// half-away-from-zero rounding rule avoid binary half-cent inconsistencies.
function parts(value: number) {
  if (!Number.isFinite(value)) throw new RangeError('Money must be finite');
  const [mantissa, exponent = '0'] = value.toString().split('e');
  const places = (mantissa.split('.')[1] || '').length - Number(exponent);
  const digits = BigInt(mantissa.replace('.', ''));
  return places < 0 ? { digits: digits * 10n ** BigInt(-places), scale: 0 } : { digits, scale: places };
}

function roundedRatio(numerator: bigint, denominator: bigint) {
  const sign = numerator < 0n ? -1n : 1n, absolute = numerator * sign;
  const result = sign * (absolute / denominator + (absolute % denominator * 2n >= denominator ? 1n : 0n));
  const number = Number(result);
  if (!Number.isSafeInteger(number)) throw new RangeError('Money exceeds safe precision');
  return number;
}

export function toCents(value: number) {
  const p = parts(value);
  return roundedRatio(p.digits * 100n, 10n ** BigInt(p.scale));
}
export const roundMoney = (value: number) => toCents(value) / 100;
export function lineMoney(price: number, quantity: number) {
  if (!Number.isSafeInteger(quantity)) throw new RangeError('Quantity must be a safe integer');
  const p = parts(price);
  return roundedRatio(p.digits * BigInt(quantity) * 100n, 10n ** BigInt(p.scale)) / 100;
}
export function taxMoney(base: number, percentage: number) {
  const amount = parts(base), rate = parts(percentage);
  return roundedRatio(amount.digits * rate.digits, 10n ** BigInt(amount.scale + rate.scale)) / 100;
}

export const formatUnitPrice = (price: number) => price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4, useGrouping: false });
