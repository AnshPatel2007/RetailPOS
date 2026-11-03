import type { PriceRounding } from '@/services/api';

/**
 * Mirrors the server's pricing rules for instant feedback while typing.
 *   margin = (price - cost) / price      markup = (price - cost) / cost
 * A price from a target margin is rounded UP to the store's ending, so
 * rounding never takes an item below its target.
 */
export const ROUNDING_LABELS: Record<PriceRounding, string> = {
  CENT: 'Next cent ($2.15)',
  NICKEL: 'Next 5 cents ($2.15, $2.20)',
  NINE: 'Ends in 9 ($2.19)',
  NINETY_NINE: 'Ends in .99 ($2.99)',
};

export function roundUpPrice(raw: number, rounding: PriceRounding = 'CENT') {
  // The small epsilon keeps 2.10 (stored as 2.1000000000000001) from becoming 2.11.
  const cents = Math.ceil(raw * 100 - 1e-7);
  const ending = rounding === 'NICKEL' ? Math.ceil(cents / 5) * 5
    : rounding === 'NINE' ? cents + ((9 - (cents % 10)) + 10) % 10
    : rounding === 'NINETY_NINE' ? cents + ((99 - (cents % 100)) + 100) % 100
    : cents;
  return ending / 100;
}

export function priceForMargin(cost: number, margin: number, rounding: PriceRounding = 'CENT') {
  if (!(cost > 0) || !(margin >= 0) || margin >= 1) return null;
  return roundUpPrice(cost / (1 - margin), rounding);
}

export function priceMetrics(price: number, cost: number) {
  if (!(price > 0) || !(cost >= 0)) return null;
  return { margin: (price - cost) / price, markup: cost > 0 ? (price - cost) / cost : null, grossProfit: price - cost };
}

export const formatPercent = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? '—' : `${(Math.round(value * 1000) / 10).toFixed(1)}%`;
