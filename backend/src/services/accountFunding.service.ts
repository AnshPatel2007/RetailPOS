import { randomBytes } from 'crypto';
import { AccountOperation, Prisma } from '@prisma/client';
import { z } from 'zod';
import { AuthRequest } from '../types';
import { AppError } from '../utils/errorHandler';
import { assertOwnsRecord } from '../utils/locationFilter.util';
import { can } from '../policies/capabilities';
import { requestHash } from './managerApproval.service';
import { reportCalendar } from './reportDates.service';
import { cashAmount, cents, dollars, lockCurrentDrawer, postDrawerEntry } from './drawer.service';

const common = { amount: z.number().finite().positive(), idempotencyKey: z.string().uuid(), reference: z.string().trim().max(120).optional(), notes: z.string().trim().max(500).optional() };
const giftSchema = z.object({ ...common, paymentMethod: z.enum(['CASH', 'CARD', 'PROMOTIONAL']), customerId: z.string().min(1).optional(), expiresAt: z.string().optional() }).strict();
const paymentSchema = z.object({ ...common, paymentMethod: z.enum(['CASH', 'CARD']) }).strict();
const creditSchema = z.object({ amount: common.amount, idempotencyKey: common.idempotencyKey, source: z.enum(['GOODWILL', 'CORRECTION']), notes: z.string().trim().min(3, 'A reason is required for store credit').max(500) }).strict();

export const operationReceipt = (row: AccountOperation) => ({
  id: row.id, kind: row.kind, amount: Number(row.amount), paymentMethod: row.paymentMethod,
  balanceBefore: Number(row.balanceBefore), balanceAfter: Number(row.balanceAfter), reference: row.reference,
  reason: row.reason, userId: row.userId, locationId: row.locationId, shiftId: row.shiftId, createdAt: row.createdAt,
});

export async function lockAccountCustomer(tx: Prisma.TransactionClient, req: AuthRequest, id: string, active = true) {
  await tx.$queryRaw`SELECT id FROM customers WHERE id = ${id} FOR UPDATE`;
  const customer = await tx.customer.findUnique({ where: { id } });
  if (!customer) throw new AppError('Customer not found', 404);
  assertOwnsRecord(req, customer.locationId);
  if (active && !customer.isActive) throw new AppError('Customer is inactive', 400);
  return customer;
}

export async function fundAccount(req: AuthRequest, tx: Prisma.TransactionClient, kind: 'GIFT_ISSUE' | 'GIFT_RELOAD' | 'STORE_CREDIT' | 'HOUSE_PAYMENT') {
  if (!req.user?.locationId || !can(req.user.role, 'account.manage')) throw new AppError('Account management requires a manager or owner at this store', 403);
  const schema = kind === 'STORE_CREDIT' ? creditSchema : kind === 'HOUSE_PAYMENT' ? paymentSchema : giftSchema;
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw new AppError(parsed.error.issues[0].message, 400);
  const body = parsed.data;
  const amount = cashAmount(body.amount, 'Amount');
  if (amount <= 0) throw new AppError('Amount must be positive', 400);
  const method = 'source' in body ? body.source : body.paymentMethod;
  if ((method === 'PROMOTIONAL' || method === 'CORRECTION') && !can(req.user.role, 'account.grant')) throw new AppError('Only the store owner can authorize promotional grants or balance corrections', 403);
  if (method === 'CARD' && (!('reference' in body) || !body.reference)) throw new AppError('Enter the approved external terminal reference before recording payment', 400);
  if (method === 'PROMOTIONAL' && (!body.notes || body.notes.length < 3)) throw new AppError('A reason is required for a promotional grant', 400);
  if ('reference' in body && body.reference && method !== 'CARD') throw new AppError('A terminal reference is only valid for a card payment', 400);
  if (kind === 'GIFT_RELOAD' && ('customerId' in body || 'expiresAt' in body)) throw new AppError('Reload cannot change a card owner or expiry', 400);
  const target = kind === 'GIFT_ISSUE' ? 'new' : kind === 'STORE_CREDIT' ? req.params.customerId : req.params.id;
  const hash = requestHash('POST', kind + ':' + target, { ...body, userId: req.user.id, locationId: req.user.locationId });
  // Take the retry lock before any drawer/customer/account lock, including creation.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'account:' + body.idempotencyKey}, 0))::text`;
  const previous = await tx.accountOperation.findUnique({ where: { idempotencyKey: body.idempotencyKey } });
  if (previous) {
    if (previous.requestHash !== hash || previous.userId !== req.user.id || previous.locationId !== req.user.locationId) throw new AppError('This payment retry key belongs to a different request', 409);
    const data = previous.giftCardId ? await tx.giftCard.findUniqueOrThrow({ where: { id: previous.giftCardId } })
      : previous.houseAccountId ? await tx.houseAccount.findUniqueOrThrow({ where: { id: previous.houseAccountId }, include: { customer: { select: { firstName: true, lastName: true } } } })
      : await tx.storeCreditAccount.findUniqueOrThrow({ where: { id: previous.storeCreditAccountId! } });
    return { data, receipt: operationReceipt(previous), replayed: true };
  }
  const drawer = method === 'CASH' ? await lockCurrentDrawer(tx, req) : null;
  let giftCardId: string | undefined, houseAccountId: string | undefined, storeCreditAccountId: string | undefined;
  let balanceBefore = 0, balanceAfter = 0;
  let data;
  if (kind === 'GIFT_ISSUE') {
    const input = giftSchema.parse(body);
    if (input.customerId) await lockAccountCustomer(tx, req, input.customerId);
    // A date-only expiry is good through the end of that day in the store's time zone.
    let expiry: Date | null = null;
    if (input.expiresAt && /^\d{4}-\d{2}-\d{2}$/.test(input.expiresAt)) {
      const store = await tx.location.findUnique({ where: { id: req.user.locationId! }, select: { timezone: true } });
      const [year, month, day] = input.expiresAt.split('-').map(Number);
      expiry = new Date(reportCalendar(store?.timezone || 'UTC').midnight(year, month, day + 1).getTime() - 1);
    } else if (input.expiresAt) expiry = new Date(input.expiresAt);
    if (expiry && (!Number.isFinite(expiry.getTime()) || expiry <= new Date())) throw new AppError('Expiry must be a valid future date', 400);
    const card = await tx.giftCard.create({ data: {
      code: randomBytes(8).toString('hex').toUpperCase().match(/.{1,4}/g)!.join('-'),
      initialBalance: amount, currentBalance: amount, locationId: req.user.locationId,
      customerId: input.customerId || null, expiresAt: expiry,
    } });
    giftCardId = card.id; balanceAfter = amount; data = card;
  } else if (kind === 'GIFT_RELOAD') {
    await tx.$queryRaw`SELECT id FROM gift_cards WHERE id = ${target} FOR UPDATE`;
    const card = await tx.giftCard.findUnique({ where: { id: target } });
    if (!card) throw new AppError('Gift card not found', 404);
    assertOwnsRecord(req, card.locationId);
    if (!card.isActive || (card.expiresAt && card.expiresAt <= new Date())) throw new AppError('Cannot reload an inactive or expired gift card', 400);
    balanceBefore = Number(card.currentBalance); balanceAfter = cashAmount(dollars(cents(balanceBefore) + cents(amount)), 'New balance'); giftCardId = card.id;
    data = await tx.giftCard.update({ where: { id: card.id }, data: { currentBalance: balanceAfter } });
  } else if (kind === 'STORE_CREDIT') {
    await lockAccountCustomer(tx, req, target);
    await tx.$queryRaw`SELECT id FROM store_credit_accounts WHERE "customerId" = ${target} FOR UPDATE`;
    let account = await tx.storeCreditAccount.findUnique({ where: { customerId: target } });
    if (account) assertOwnsRecord(req, account.locationId);
    else account = await tx.storeCreditAccount.create({ data: { customerId: target, locationId: req.user.locationId } });
    storeCreditAccountId = account.id; balanceBefore = Number(account.balance); balanceAfter = cashAmount(dollars(cents(balanceBefore) + cents(amount)), 'New balance');
    data = await tx.storeCreditAccount.update({ where: { id: account.id }, data: { balance: balanceAfter } });
  } else {
    const existing = await tx.houseAccount.findUnique({ where: { id: target } });
    if (!existing) throw new AppError('House account not found', 404);
    assertOwnsRecord(req, existing.locationId);
    // Match checkout's drawer -> customer -> account order. Frozen accounts may
    // repay an existing debt; they still cannot receive new checkout charges.
    await lockAccountCustomer(tx, req, existing.customerId, false);
    await tx.$queryRaw`SELECT id FROM house_accounts WHERE id = ${target} FOR UPDATE`;
    const account = await tx.houseAccount.findUniqueOrThrow({ where: { id: target } });
    assertOwnsRecord(req, account.locationId);
    if (cents(amount) > cents(Number(account.balance))) throw new AppError('Payment exceeds the current balance due. Accept only $' + dollars(Math.max(0, cents(Number(account.balance)))).toFixed(2), 400);
    houseAccountId = account.id; balanceBefore = Number(account.balance); balanceAfter = dollars(cents(balanceBefore) - cents(amount));
    data = await tx.houseAccount.update({ where: { id: target }, data: { balance: balanceAfter }, include: { customer: { select: { firstName: true, lastName: true } } } });
  }
  const operation = await tx.accountOperation.create({ data: {
    idempotencyKey: body.idempotencyKey, requestHash: hash, kind, paymentMethod: method,
    amount, balanceBefore, balanceAfter, userId: req.user.id, locationId: req.user.locationId,
    shiftId: drawer?.id, giftCardId, storeCreditAccountId, houseAccountId,
    reference: 'reference' in body ? body.reference || null : null, reason: body.notes || null,
  } });
  const entry = { amount, balanceBefore, balanceAfter, notes: body.notes || null, operationId: operation.id };
  if (giftCardId) await tx.giftCardTransaction.create({ data: { ...entry, giftCardId, type: kind === 'GIFT_ISSUE' ? 'ISSUE' : 'RELOAD' } });
  if (storeCreditAccountId) await tx.storeCreditTransaction.create({ data: { ...entry, accountId: storeCreditAccountId, type: 'CREDIT' } });
  if (houseAccountId) await tx.houseAccountTransaction.create({ data: { ...entry, accountId: houseAccountId, type: 'PAYMENT', userId: req.user.id } });
  if (drawer) await postDrawerEntry(tx, { sourceKey: 'account:' + operation.id, shiftId: drawer.id, locationId: req.user.locationId, userId: req.user.id, accountOperationId: operation.id, type: houseAccountId ? 'HOUSE_PAYMENT' : 'GIFT_FUNDING', amount });
  await tx.activityLog.create({ data: { userId: req.user.id, locationId: req.user.locationId, action: kind, entity: 'ACCOUNT_OPERATION', entityId: operation.id, details: { amount, paymentMethod: method, giftCardId, storeCreditAccountId, houseAccountId, reason: body.notes || null } } });
  return { data, receipt: operationReceipt(operation), replayed: false };
}
