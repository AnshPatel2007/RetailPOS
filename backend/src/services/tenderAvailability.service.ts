import { AppError } from '../utils/errorHandler';

export const EBT_UNAVAILABLE = 'EBT/SNAP checkout is unavailable until tax allocation and original-tender refunds are validated.';

export function assertCheckoutTendersAvailable(intent: { paymentMethod?: string; payments?: { paymentMethod: string }[] }) {
  if (intent.paymentMethod === 'EBT' || intent.payments?.some(payment => payment.paymentMethod === 'EBT')) {
    throw new AppError(EBT_UNAVAILABLE, 409);
  }
}

/** Existing stores without a saved tender policy keep their prior behavior. */
export function assertConfiguredTenders(intent: { paymentMethod?: string; payments?: { paymentMethod: string; amount: number }[] }, settings: unknown, total: number) {
  if (total <= 0) return; // Zero-cash settlement of a points-only purchase.
  const saved = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings as Record<string, unknown> : {};
  const methods = saved.paymentMethods && typeof saved.paymentMethods === 'object' ? saved.paymentMethods as Record<string, unknown> : {};
  const keys: Record<string, string> = { CASH: 'cash', CARD: 'card', GIFT_CARD: 'giftCard', STORE_CREDIT: 'storeCredit' };
  const selected = intent.payments?.length ? intent.payments.filter(payment => payment.amount > 0).map(payment => payment.paymentMethod) : [intent.paymentMethod || 'CASH'];
  for (const method of selected) if (keys[method] && methods[keys[method]] === false) {
    throw new AppError(`${method.replace('_', ' ')} is disabled in this store. Choose an enabled payment method.`, 409);
  }
}

export function assertReversalTendersAvailable(sale: { paymentMethod: string; payments: { paymentMethod: string; amount: unknown }[] }) {
  if (sale.paymentMethod === 'EBT' || sale.payments.some(payment => payment.paymentMethod === 'EBT' && Number(payment.amount) > 0)) {
    throw new AppError('This sale includes EBT/SNAP. Its original-tender reversal requires reconciliation; the POS cannot record this refund or void yet.', 409);
  }
}
