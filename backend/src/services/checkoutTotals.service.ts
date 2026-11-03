import { businessConfig } from '../config/business.config';
import { AppError } from '../utils/errorHandler';
import { roundMoney, taxMoney } from '../utils/moneyNumbers';
import { assertCheckoutTendersAvailable } from './tenderAvailability.service';

export interface CheckoutIntent {
  customerId?: string;
  pointsRedeemed?: number;
  paymentMethod?: string;
  payments?: { paymentMethod: string; amount: number }[];
}

/** The quote and locked sale commit use the same final settlement rules. */
export function checkoutTotals(
  pricing: { total: number; totalDiscount: number },
  intent: CheckoutIntent,
  availablePoints: number | null,
  surchargePercent: number,
) {
  assertCheckoutTendersAvailable(intent);
  const redeemedPoints = intent.pointsRedeemed || 0;
  const ratio = businessConfig.customer.pointsToDollarRatio;
  if (redeemedPoints > 0) {
    if (!intent.customerId) throw new AppError('A customer must be linked to redeem loyalty points', 400);
    if (availablePoints === null || redeemedPoints > availablePoints) {
      throw new AppError(`Insufficient loyalty points: requested ${redeemedPoints}, available ${availablePoints || 0}`, 400);
    }
    if (redeemedPoints > Math.floor(pricing.total * ratio + 0.000001)) {
      throw new AppError('Requested points exceed the sale amount. Reduce the redemption before charging.', 400);
    }
  }
  // Preserve the existing post-tax loyalty contract and original line allocation.
  const loyaltyDiscount = roundMoney(Math.min(redeemedPoints / ratio, pricing.total));
  const afterLoyalty = roundMoney(pricing.total - loyaltyDiscount);
  const cardIntent = intent.payments?.length
    ? roundMoney(intent.payments.filter(p => p.paymentMethod === 'CARD').reduce((sum, p) => sum + p.amount, 0))
    : intent.paymentMethod === 'CARD' ? afterLoyalty : 0;
  const surcharge = surchargePercent > 0 ? taxMoney(Math.min(cardIntent, afterLoyalty), surchargePercent) : 0;
  const total = roundMoney(afterLoyalty + surcharge);
  return {
    baseTotal: pricing.total,
    total,
    totalDiscount: roundMoney(pricing.totalDiscount + loyaltyDiscount),
    loyaltyDiscount,
    redeemedPoints,
    surcharge,
    earnedPoints: intent.customerId ? Math.floor(total) : 0,
    availablePoints,
    pointsPerDollar: ratio,
  };
}
