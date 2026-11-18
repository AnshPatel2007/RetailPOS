/**
 * Cash rounding to 5 cents (the penny is going away; Settings > Taxes & Payments, off
 * unless the owner turns it on). Shared with the frontend: no imports.
 *
 * - Only cash is ever rounded, and only the cash that finishes a sale: cards and every
 *   other tender are charged exactly, and a customer who hands over the exact cents still
 *   due pays exactly.
 * - To the nearest 5 cents (1 or 2 cents down, 3 or 4 up), or always in the customer's
 *   favor (a sale down, a refund up).
 * - The sale's total, tax and lines stay exact. The difference is booked as the sale's
 *   cash rounding (negative when the store took less), and a cash refund's own rounding
 *   likewise, so the drawer expects exactly the cash that changed hands.
 */
export type CashRoundingMode = 'OFF' | 'NEAREST' | 'CUSTOMER';
export const CASH_ROUNDING_MODES: readonly CashRoundingMode[] = ['OFF', 'NEAREST', 'CUSTOMER'];
export const isCashRoundingMode = (value: unknown): value is CashRoundingMode => CASH_ROUNDING_MODES.includes(value as CashRoundingMode);

/** Cents to a multiple of 5: the nearest (42 → 40, 43 → 45), down or up. */
export function toNickel(cents: number, direction: 'NEAREST' | 'DOWN' | 'UP'): number {
  const remainder = ((cents % 5) + 5) % 5;
  if (!remainder) return cents;
  if (direction === 'DOWN') return cents - remainder;
  if (direction === 'UP') return cents + 5 - remainder;
  return remainder <= 2 ? cents - remainder : cents + 5 - remainder;
}

/** The cash due (in cents) when cash finishes a sale, and its rounding. */
export function roundedCashDue(dueCents: number, mode: CashRoundingMode) {
  const due = mode === 'OFF' || dueCents <= 0 ? dueCents : toNickel(dueCents, mode === 'CUSTOMER' ? 'DOWN' : 'NEAREST');
  return { cents: due, rounding: due - dueCents };
}

/**
 * A sale's cash rounding in cents. Tenders in the order they were taken, cash as handed
 * over (before change). Rounded only when the last tender is cash and it is not the exact
 * cents still due.
 */
export function saleCashRounding(totalCents: number, tenders: { method: string; cents: number }[], mode: CashRoundingMode): number {
  const last = tenders[tenders.length - 1];
  if (mode === 'OFF' || !last || last.method !== 'CASH') return 0;
  const due = totalCents - tenders.slice(0, -1).reduce((sum, tender) => sum + tender.cents, 0);
  if (due <= 0 || last.cents === due) return 0;
  return roundedCashDue(due, mode).rounding;
}

/** A cash refund's rounding in cents: its cash part to 5 cents (in the customer's favor: up). */
export function refundCashRounding(cashCents: number, mode: CashRoundingMode): number {
  if (mode === 'OFF' || cashCents <= 0) return 0;
  return toNickel(cashCents, mode === 'CUSTOMER' ? 'UP' : 'NEAREST') - cashCents;
}
