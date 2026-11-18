/**
 * How a manual stock change is costed depends on why it happened.
 *
 * - Goods that arrived without being entered (a delivery or transfer) are an
 *   acquisition, never a gain: UNMATCHED_RECEIPT, listed for invoice matching.
 * - Units sold without being scanned (misc key) are cost of sales, not shrink.
 * - Damage, theft, expiry and similar losses are shrink.
 * - Anything else is a count or adjustment. A count that brings a negative
 *   balance back up still never cancels the cost of the sales behind it
 *   (enforced in valueMovement).
 */
export const LOSS_REASONS = ['DAMAGED', 'LOST', 'THEFT', 'EXPIRED', 'WASTE', 'OTHER'];
export const ACQUIRED_REASONS = ['MISSING_RECEIPT', 'TRANSFER_NOT_RECORDED', 'RECEIVED'];
export const UNRECORDED_SALE_REASON = 'SOLD_WITHOUT_SCANNING';

export function costKindForReason(reason: string, change: number, base: 'COUNT' | 'ADJUSTMENT'): string {
  if (change > 0 && ACQUIRED_REASONS.includes(reason)) return 'UNMATCHED_RECEIPT';
  if (change < 0 && reason === UNRECORDED_SALE_REASON) return 'UNRECORDED_SALE';
  if (change < 0 && LOSS_REASONS.includes(reason)) return 'STOCK_LOSS';
  return base;
}
