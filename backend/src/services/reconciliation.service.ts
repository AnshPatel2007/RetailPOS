import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import { AppError } from '../utils/errorHandler';
import { assertOwnsRecord } from '../utils/locationFilter.util';
import { recordOperation } from './operationReceipt.service';
import { cashAmount, cents, dollars, drawerInclude, lockCurrentDrawer, postDrawerEntry, summarizeDrawer } from './drawer.service';
import { lockSale } from './saleReversal.service';
import { requestHash } from './managerApproval.service';

const targetInput = z.object({ kind: z.enum(['DRAWER', 'GIFT_CARD', 'STORE_CREDIT', 'HOUSE_ACCOUNT']), target: z.string().trim().max(150).default('') });
const correctionInput = targetInput.extend({ idempotencyKey: z.string().uuid(), amount: z.number().finite(), expectedBalance: z.number().finite(),
  reason: z.string().trim().min(1).max(500), reference: z.string().trim().min(1).max(150) }).strict();
function owner(req: AuthRequest) {
  if (req.user?.role !== 'ADMIN' || !req.user.locationId) throw new AppError('Reconciliation requires the assigned store owner', 403);
}
async function accountTarget(tx: Prisma.TransactionClient, req: AuthRequest, input: z.infer<typeof targetInput>, lock: boolean) {
  if (input.kind === 'GIFT_CARD') {
    const cards = await tx.giftCard.findMany({ where: { locationId: req.user!.locationId, OR: [{ id: input.target }, { code: input.target }] }, take: 2 });
    if (cards.length !== 1) throw new AppError('Gift card not found at this store', 404);
    if (lock) await tx.$queryRaw`SELECT id FROM gift_cards WHERE id = ${cards[0].id} FOR UPDATE`;
    const card = await tx.giftCard.findUniqueOrThrow({ where: { id: cards[0].id } });
    return { id: card.id, label: card.code, balance: Number(card.currentBalance), card };
  }
  const customers = await tx.customer.findMany({ where: { locationId: req.user!.locationId, OR: [{ id: input.target }, { phone: input.target }, { email: input.target }] }, take: 2 });
  if (customers.length !== 1) throw new AppError('Use a unique customer ID, phone or email at this store', 404);
  const customer = customers[0];
  if (lock) await tx.$queryRaw`SELECT id FROM customers WHERE id = ${customer.id} FOR UPDATE`;
  const label = customer.firstName + ' ' + customer.lastName;
  if (input.kind === 'STORE_CREDIT') {
    if (lock) await tx.$queryRaw`SELECT id FROM store_credit_accounts WHERE "customerId" = ${customer.id} FOR UPDATE`;
    const account = await tx.storeCreditAccount.findUnique({ where: { customerId: customer.id } });
    if (!account) throw new AppError('Customer has no store-credit account', 404); assertOwnsRecord(req, account.locationId);
    return { id: account.id, label, balance: Number(account.balance), account };
  }
  if (lock) await tx.$queryRaw`SELECT id FROM house_accounts WHERE "customerId" = ${customer.id} FOR UPDATE`;
  const account = await tx.houseAccount.findUnique({ where: { customerId: customer.id } });
  if (!account) throw new AppError('Customer has no house account', 404); assertOwnsRecord(req, account.locationId);
  return { id: account.id, label, balance: Number(account.balance), account };
}

export async function previewCorrection(req: AuthRequest) {
  owner(req); const input = targetInput.strict().parse(req.body);
  return prisma.$transaction(async tx => {
    if (input.kind === 'DRAWER') {
      const shift = await lockCurrentDrawer(tx, req);
      const drawer = await tx.shift.findUniqueOrThrow({ where: { id: shift!.id }, include: drawerInclude });
      return { id: drawer.id, label: 'Your open drawer', balance: summarizeDrawer(drawer).calculatedExpected };
    }
    const target = await accountTarget(tx, req, input, false);
    return { id: target.id, label: target.label, balance: target.balance };
  });
}

export async function correctBalance(req: AuthRequest) {
  owner(req); const input = correctionInput.parse(req.body);
  const magnitude = cashAmount(Math.abs(input.amount), 'Correction amount');
  if (magnitude === 0) throw new AppError('Enter a nonzero correction', 400);
  const amount = input.amount < 0 ? -magnitude : magnitude;
  cashAmount(Math.abs(input.expectedBalance), 'Reviewed balance');
  return recordOperation(req, 'BALANCE_CORRECTION', input.kind + ':' + input.target, input.idempotencyKey, input, async tx => {
    if (input.kind === 'DRAWER') {
      const shift = await lockCurrentDrawer(tx, req);
      const drawer = await tx.shift.findUniqueOrThrow({ where: { id: shift!.id }, include: drawerInclude });
      const before = summarizeDrawer(drawer).calculatedExpected;
      if (cents(before) !== cents(input.expectedBalance)) throw new AppError('Drawer changed. Review its current balance.', 409);
      if (cents(before) + cents(amount) < 0) throw new AppError('A correction cannot make expected drawer cash negative', 409);
      await postDrawerEntry(tx, { sourceKey: 'correction:' + input.idempotencyKey, shiftId: drawer.id, locationId: req.user!.locationId!, userId: req.user!.id, type: 'CORRECTION', amount });
      return { kind: input.kind, targetId: drawer.id, label: 'Your open drawer', amount, balanceBefore: before, balanceAfter: dollars(cents(before) + cents(amount)), reason: input.reason, reference: input.reference };
    }
    const target = await accountTarget(tx, req, input, true);
    if (cents(target.balance) !== cents(input.expectedBalance)) throw new AppError('Account changed. Review the current balance.', 409);
    const after = dollars(cents(target.balance) + cents(amount));
    if (after < 0) throw new AppError('A correction cannot make an account balance negative', 409);
    const notes = `Reconciliation ${input.idempotencyKey}: ${input.reason} (${input.reference})`;
    if (input.kind === 'GIFT_CARD') {
      const card = target.card!;
      if (amount > 0 && (!card.isActive || (card.expiresAt && card.expiresAt <= new Date()))) throw new AppError('Inactive or expired gift cards cannot receive funds', 409);
      await tx.giftCard.update({ where: { id: target.id }, data: { currentBalance: after,
        transactions: { create: { type: 'ADJUSTMENT', amount, balanceBefore: target.balance, balanceAfter: after, notes } } } });
    } else if (input.kind === 'STORE_CREDIT') {
      await tx.storeCreditAccount.update({ where: { id: target.id }, data: { balance: after,
        transactions: { create: { type: 'ADJUSTMENT', amount, balanceBefore: target.balance, balanceAfter: after, notes } } } });
    } else {
      await tx.houseAccount.update({ where: { id: target.id }, data: { balance: after,
        transactions: { create: { type: 'ADJUSTMENT', amount, balanceBefore: target.balance, balanceAfter: after, notes } } } });
    }
    return { kind: input.kind, targetId: target.id, label: target.label, amount, balanceBefore: target.balance, balanceAfter: after, reason: input.reason, reference: input.reference };
  });
}

export async function reconcileLegacyVoid(req: AuthRequest) {
  owner(req);
  const input = z.object({ idempotencyKey: z.string().uuid(), saleId: z.string().uuid(), expectedAmount: z.number().finite().nonnegative(),
    reversedAt: z.string().datetime(), reason: z.string().trim().min(1).max(500), reference: z.string().trim().min(1).max(150),
    confirmedPreviouslyReversed: z.literal(true), tenders: z.record(z.enum(['CASH', 'CARD', 'GIFT_CARD', 'STORE_CREDIT', 'HOUSE_ACCOUNT', 'EBT', 'OTHER']), z.number().finite().nonnegative()),
  }).strict().parse(req.body);
  Object.values(input.tenders).forEach(amount => cashAmount(amount, 'Reversed tender'));
  if (Object.values(input.tenders).reduce((sum, amount) => sum + cents(amount), 0) !== cents(input.expectedAmount)) throw new AppError('Verified reversed tenders must equal the original total', 400);
  return recordOperation(req, 'LEGACY_VOID_RECONCILED', input.saleId, input.idempotencyKey, input, async tx => {
    await lockSale(tx, input.saleId);
    const sale = await tx.sale.findUnique({ where: { id: input.saleId }, include: { items: true, voidEvent: true } });
    if (!sale) throw new AppError('Sale not found', 404); assertOwnsRecord(req, sale.locationId);
    if (sale.status !== 'VOIDED' || sale.voidEvent) throw new AppError('Only a legacy void without an event can be reconciled', 409);
    const reversedAt = new Date(input.reversedAt);
    if (reversedAt < sale.createdAt || reversedAt > new Date()) throw new AppError('Reversal must be between the original sale and now', 400);
    if (cents(Number(sale.total)) !== cents(input.expectedAmount)) throw new AppError('Sale amount changed. Review the original record.', 409);
    const items = sale.items.map(item => ({ saleItemId: item.id, productId: item.productId, productName: item.productName, sku: item.sku,
      quantity: item.quantity, amount: Number(item.total), taxAmount: Number(item.tax), unitCost: item.unitCost === null ? null : Number(item.unitCost),
      costReversed: item.unitCost === null ? null : new Prisma.Decimal(item.unitCost).mul(item.quantity).toNumber() }));
    const cost = items.length && items.every(item => item.costReversed !== null) ? items.reduce((sum, item) => sum.plus(item.costReversed!), new Prisma.Decimal(0)) : null;
    const event = await tx.saleVoid.create({ data: { saleId: sale.id, locationId: sale.locationId!, userId: req.user!.id,
      reason: 'Reconciled legacy void: ' + input.reason, amount: sale.total, taxAmount: sale.tax, discount: sale.discount, costReversed: cost,
      pointsRestored: sale.pointsRedeemed, pointsReversed: sale.pointsEarned, items, tenders: input.tenders, createdAt: reversedAt,
      idempotencyKey: input.idempotencyKey, requestHash: requestHash('LEGACY_VOID', sale.id, input) } });
    // These effects happened previously. No stock, account, points or drawer
    // movement is repeated, and no paying drawer is inferred from old history.
    return { saleId: sale.id, saleNumber: sale.saleNumber, voidId: event.id, amount: Number(sale.total), reversedAt,
      reason: input.reason, reference: input.reference, tenders: input.tenders, recordedAt: new Date(), payingDrawerKnown: false };
  });
}
