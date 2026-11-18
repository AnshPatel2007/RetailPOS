import { db } from './offlineDb';
import { toCents } from '@/lib/money';
import type { LinkedCustomer } from '@/components/pos/CustomerLinkSection';
import type { AgeVerificationResult } from '@/components/pos/AgeVerificationModal';

export type CheckoutPaymentMethod = 'CASH' | 'CARD' | 'GIFT_CARD' | 'STORE_CREDIT' | 'EBT' | 'HOUSE_ACCOUNT';
export interface CheckoutPayment { paymentMethod: CheckoutPaymentMethod; amount: number; reference?: string }
export interface PaymentSession {
  id: string; userId: string; locationId: string; shiftId: string; revision: number; createdAt: number;
  status: 'OPEN' | 'SUBMITTED' | 'FINAL' | 'CANCELLED';
  cartSnapshot: string; notes: string; customer: LinkedCustomer | null; ageVerification: AgeVerificationResult | null;
  payments: CheckoutPayment[]; pointsRedeemed: number; total: number;
  events: { at: number; action: string; payment?: CheckoutPayment; reference?: string }[];
  submission?: Record<string, any>; resultId?: string;
}

export const paymentTotal = (payments: CheckoutPayment[]) => payments.reduce((sum, payment) => sum + toCents(payment.amount), 0) / 100;

/** Solve the existing server surcharge rule in cents, including a card-paid fee. */
export function amountToComplete(base: number, rate: number, payments: CheckoutPayment[], method: CheckoutPaymentMethod): number {
  const baseCents = toCents(base), paid = toCents(paymentTotal(payments));
  const card = payments.filter(p => p.paymentMethod === 'CARD').reduce((sum, p) => sum + toCents(p.amount), 0);
  let due = Math.max(0, baseCents - paid);
  for (let iteration = 0; iteration < 100; iteration++) {
    const fee = Math.round(Math.min(baseCents, card + (method === 'CARD' ? due : 0)) * rate / 100);
    const next = Math.max(0, baseCents + fee - paid);
    if (next === due) return due / 100;
    due = next;
  }
  return due / 100;
}

export async function currentPaymentSession(userId: string, locationId: string) {
  const rows = await db.paymentSessions.where('[userId+locationId]').equals([userId, locationId])
    .filter(row => row.status === 'OPEN' || row.status === 'SUBMITTED').sortBy('createdAt');
  if (rows.length > 1) throw new Error('Multiple unfinished payments need review on this register.');
  return rows[0] || null;
}

/** Compare revisions inside one database transaction so a second tab cannot overwrite payments. */
export async function savePaymentSession(next: PaymentSession, expectedRevision: number | null) {
  return db.transaction('rw', db.paymentSessions, async () => {
    const current = await currentPaymentSession(next.userId, next.locationId);
    if ((current?.revision ?? null) !== expectedRevision || (current && current.id !== next.id)) {
      throw new Error('Payment changed in another window. Close and reopen Payment before continuing.');
    }
    if (next.payments.length > 20) throw new Error('A sale can contain at most 20 payments.');
    if (next.payments.some(p => !Number.isFinite(p.amount) || p.amount < 0 || Math.abs(p.amount * 100 - Math.round(p.amount * 100)) > 0.000001)) throw new Error('Use whole cents for payment amounts.');
    const saved = { ...next, revision: (expectedRevision ?? 0) + 1 };
    await db.paymentSessions.put(saved);
    return saved;
  });
}

export async function finishPaymentSession(id: string, resultId: string) {
  await db.paymentSessions.update(id, { status: 'FINAL', resultId });
}
