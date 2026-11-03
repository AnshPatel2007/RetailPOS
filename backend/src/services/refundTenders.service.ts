import { Prisma } from '@prisma/client';
import { AuthRequest } from '../types';
import { AppError } from '../utils/errorHandler';
import { assertOwnsRecord, assertCanReadRecord } from '../utils/locationFilter.util';
import { cashAmount, cents, dollars } from './drawer.service';

export type RefundTender = { sourcePaymentId: string; originalMethod: string; originalReference?: string; method: string; amount: number; reference?: string };
export type RefundTenderInput = { sourcePaymentId: string; method: string; amount: number; reference?: string };
type Money = number | Prisma.Decimal;
type OriginalSale = { total: Money; changeDue?: Money; paymentMethod: string; customerId?: string | null;
  payments: { id?: string; paymentMethod: string; amount: Money; reference?: string | null }[];
  refunds: { amount: Money; method?: string | null; reference?: string | null; tenders?: unknown }[] };
export type RefundTenderOption = { sourcePaymentId: string; method: string; reference?: string; originalAmount: number; remainingAmount: number };
const supported = new Set(['CASH', 'CARD', 'GIFT_CARD', 'STORE_CREDIT', 'HOUSE_ACCOUNT']);

/** Source capacity is net of cash change, never the amount handed to the cashier. */
function sources(sale: OriginalSale): RefundTenderOption[] {
  let change = cents(sale.changeDue || 0);
  const rows = sale.payments.length ? [...sale.payments].sort((a, b) => (a.id || '').localeCompare(b.id || '')).map((payment, index) => {
    let amount = cents(payment.amount);
    if (payment.paymentMethod === 'CASH') { const returned = Math.min(amount, change); amount -= returned; change -= returned; }
    return { sourcePaymentId: payment.id || `legacy-payment:${index}`, method: payment.paymentMethod, reference: payment.reference || undefined,
      originalAmount: dollars(amount), remainingAmount: dollars(amount) };
  }) : [{ sourcePaymentId: `legacy:${sale.paymentMethod}`, method: sale.paymentMethod, originalAmount: Number(sale.total), remainingAmount: Number(sale.total) }];
  if ((change > 0 && sale.payments.length > 0) || rows.some(row => row.originalAmount < 0)
    || rows.reduce((sum, row) => sum + cents(row.originalAmount), 0) !== cents(sale.total)) {
    throw new AppError('Original payment amounts do not reconcile to this sale. Review its tender history before refunding.', 409);
  }
  return rows.filter(row => row.originalAmount > 0);
}

/** Historic singleton payouts are attributed only when their source is unambiguous.
 * Missing split history cannot be reconstructed by distributing it arbitrarily. */
export function getRefundTenderOptions(sale: OriginalSale) {
  const options = sources(sale);
  for (const refund of sale.refunds) {
    if (cents(refund.amount) === 0) continue;
    if (Array.isArray(refund.tenders)) {
      let allocated = 0;
      for (const part of refund.tenders as RefundTender[]) {
        if (!part || typeof part !== 'object') throw new AppError('Recorded refund allocations require reconciliation.', 409);
        const source = options.find(row => row.sourcePaymentId === part.sourcePaymentId);
        if (!source || typeof part.amount !== 'number' || !Number.isFinite(part.amount) || part.amount <= 0
          || Math.abs(part.amount * 100 - Math.round(part.amount * 100)) > 0.00001
          || part.originalMethod !== source.method || part.originalReference !== source.reference) throw new AppError('Recorded refund allocations require reconciliation.', 409);
        source.remainingAmount = dollars(cents(source.remainingAmount) - cents(part.amount));
        allocated += cents(part.amount);
      }
      if (allocated !== cents(refund.amount)) throw new AppError('Recorded refund allocations do not match its amount.', 409);
    } else {
      const candidates = options.filter(row => (refund.method ? row.method === refund.method : options.length === 1)
        && (refund.method !== 'GIFT_CARD' || !refund.reference || refund.reference === row.reference));
      const source = candidates.length === 1 ? candidates[0] : refund.method === 'STORE_CREDIT' && options.length === 1 ? options[0] : undefined;
      if (!source) throw new AppError('An earlier refund has no complete original-tender allocation. Reconcile its payment history before another refund.', 409);
      source.remainingAmount = dollars(cents(source.remainingAmount) - cents(refund.amount));
    }
  }
  if (options.some(row => row.remainingAmount < 0)) throw new AppError('Earlier payouts exceed their original tender. Reconcile this sale before another refund.', 409);
  return options;
}

export function planRefundTenders(sale: OriginalSale, amount: number, intent: { refundTenders?: RefundTenderInput[]; refundMethod?: string; reference?: string }) {
  const options = getRefundTenderOptions(sale);
  if (cents(amount) === 0) {
    if (intent.refundTenders?.some(part => part.amount !== 0)) throw new AppError('A points-only return cannot have a monetary payout.', 400);
    return [] as RefundTender[];
  }
  let input = intent.refundTenders;
  if (input && (intent.refundMethod || intent.reference)) throw new AppError('Use either individual refund tenders or one refund method.', 400);
  if (!input) {
    const eligible = options.filter(option => option.remainingAmount > 0 && (!intent.refundMethod || intent.refundMethod === 'STORE_CREDIT' || option.method === intent.refundMethod)
      && (intent.refundMethod !== 'GIFT_CARD' || !intent.reference || intent.reference === option.reference));
    let needed = cents(amount);
    input = [];
    for (const option of eligible) {
      const allocated = Math.min(needed, cents(option.remainingAmount));
      if (allocated > 0) input.push({ sourcePaymentId: option.sourcePaymentId, method: intent.refundMethod || option.method, amount: dollars(allocated),
        ...(intent.reference ? { reference: intent.reference } : {}) });
      needed -= allocated;
      if (!needed) break;
    }
    if (needed > 0) throw new AppError('Refund exceeds the remaining amount paid with this original tender. Use the original mixed tenders or explicit customer store credit.', 400);
  }
  if (!input.length || input.length > 20) throw new AppError('Review the refund payment allocations.', 400);
  const used = new Set<string>();
  const cardReferences = new Set<string>();
  const result = input.map(part => {
    cashAmount(part.amount, 'Refund tender amount');
    if (part.amount <= 0 || used.has(part.sourcePaymentId)) throw new AppError('Use one positive refund allocation for each original payment.', 400);
    used.add(part.sourcePaymentId);
    const source = options.find(option => option.sourcePaymentId === part.sourcePaymentId);
    if (!source || cents(part.amount) > cents(source.remainingAmount)) throw new AppError('Refund exceeds the remaining balance of an original payment. Reload its payment history.', 409);
    if (!supported.has(part.method) || !supported.has(source.method)) throw new AppError('This tender requires a reviewed external reversal; the POS cannot record its refund.', 409);
    if (part.method !== source.method && part.method !== 'STORE_CREDIT') throw new AppError('Refunds must return to their original tender or explicit customer store credit.', 400);
    if (part.method === 'STORE_CREDIT' && !sale.customerId) throw new AppError('Store credit refunds require the original linked customer.', 400);
    const reference = part.reference?.trim();
    if (part.method === 'CARD' && !reference) throw new AppError('Complete the refund on the original external card terminal and record its refund reference.', 400);
    if (part.method === 'CARD') {
      const priorReference = sale.refunds.some(refund => Array.isArray(refund.tenders)
        ? (refund.tenders as RefundTender[]).some(prior => prior.method === 'CARD' && prior.reference === reference)
        : refund.method === 'CARD' && refund.reference === reference);
      if (cardReferences.has(reference!) || priorReference) throw new AppError('This terminal refund reference was already recorded on this sale. Retry the saved original request instead.', 409);
      cardReferences.add(reference!);
    }
    if (part.method === 'GIFT_CARD' && (!source.reference || reference && reference !== source.reference)) throw new AppError('Gift card refunds must credit the original gift card.', 400);
    return { sourcePaymentId: source.sourcePaymentId, originalMethod: source.method, ...(source.reference ? { originalReference: source.reference } : {}),
      method: part.method, amount: part.amount, ...(part.method === 'GIFT_CARD' ? { reference: source.reference! } : reference ? { reference } : {}) };
  });
  if (result.reduce((sum, part) => sum + cents(part.amount), 0) !== cents(amount)) throw new AppError('Refund payment allocations must equal the reviewed refund total.', 400);
  return result.sort((left, right) => left.sourcePaymentId.localeCompare(right.sourcePaymentId));
}

/** Caller holds sale, inventory and customer locks in checkout order. */
export async function creditRefundTenders(req: AuthRequest, tx: Prisma.TransactionClient, sale: { id: string; locationId: string | null; customerId: string | null }, tenders: RefundTender[]) {
  const groups = new Map<string, { method: string; reference?: string; amount: number }>();
  for (const part of tenders) if (['GIFT_CARD', 'STORE_CREDIT', 'HOUSE_ACCOUNT'].includes(part.method)) {
    const key = `${part.method}:${part.method === 'GIFT_CARD' ? part.originalReference || '' : ''}`;
    const group = groups.get(key) || { method: part.method, reference: part.originalReference, amount: 0 };
    group.amount = dollars(cents(group.amount) + cents(part.amount)); groups.set(key, group);
  }
  for (const [, group] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const amount = group.amount;
    if (group.method === 'GIFT_CARD') {
      if (!group.reference) throw new AppError('Original gift card reference is missing.', 409);
      await tx.$queryRaw`SELECT id FROM gift_cards WHERE code = ${group.reference} OR id = ${group.reference} FOR UPDATE`;
      const card = await tx.giftCard.findFirst({ where: { OR: [{ code: group.reference }, { id: group.reference }] } });
      if (!card) throw new AppError('Original gift card is missing.', 409);
      assertCanReadRecord(req, card.locationId);
      if (!card.isActive || card.expiresAt && card.expiresAt <= new Date()) throw new AppError('Original gift card is inactive or expired. Review an explicit store-credit alternative.', 409);
      await tx.giftCard.update({ where: { id: card.id }, data: { currentBalance: { increment: amount }, transactions: { create: {
        type: 'REFUND', amount, balanceBefore: card.currentBalance, balanceAfter: dollars(cents(card.currentBalance) + cents(amount)), saleId: sale.id,
      } } } });
    } else {
      if (!sale.customerId) throw new AppError('The original linked customer is required for this refund.', 409);
      const customer = await tx.customer.findUnique({ where: { id: sale.customerId } });
      if (!customer || customer.locationId !== sale.locationId) throw new AppError('Customer not found at this store.', 404);
      if (group.method === 'STORE_CREDIT') {
        await tx.$queryRaw`SELECT id FROM store_credit_accounts WHERE "customerId" = ${sale.customerId} FOR UPDATE`;
        let account = await tx.storeCreditAccount.findUnique({ where: { customerId: sale.customerId } });
        if (!account) account = await tx.storeCreditAccount.create({ data: { customerId: sale.customerId, locationId: sale.locationId, balance: 0 } });
        assertOwnsRecord(req, account.locationId);
        await tx.storeCreditAccount.update({ where: { id: account.id }, data: { balance: { increment: amount }, transactions: { create: {
          type: 'REFUND', amount, balanceBefore: account.balance, balanceAfter: dollars(cents(account.balance) + cents(amount)), saleId: sale.id,
        } } } });
      } else {
        await tx.$queryRaw`SELECT id FROM house_accounts WHERE "customerId" = ${sale.customerId} FOR UPDATE`;
        const account = await tx.houseAccount.findUnique({ where: { customerId: sale.customerId } });
        if (!account) throw new AppError('Original house account is missing.', 409);
        assertOwnsRecord(req, account.locationId);
        if (cents(account.balance) < cents(amount)) throw new AppError('This house charge has already been paid down. Review an explicit customer store-credit alternative.', 409);
        await tx.houseAccount.update({ where: { id: account.id }, data: { balance: { decrement: amount }, transactions: { create: {
          type: 'ADJUSTMENT', amount: -amount, balanceBefore: account.balance, balanceAfter: dollars(cents(account.balance) - cents(amount)), saleId: sale.id,
          userId: req.user!.id, notes: 'Returned goods; original house-account tender',
        } } } });
      }
    }
  }
}
