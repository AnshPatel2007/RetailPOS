/**
 * House accounts: charge-to-account for trusted customers and businesses.
 * Charges happen at the register (HOUSE_ACCOUNT tender in createSale); this
 * controller manages the accounts — limits, payments received, statements.
 */

import { Response } from 'express';
import { asyncHandler, AppError } from '../utils/errorHandler';
import { AuthRequest } from '../types';
import prisma from '../config/database';
import { logger } from '../utils/logger';
import { sendEmail } from '../utils/email';
import { config } from '../config';

const rc = (n: number) => Math.round(n * 100) / 100;

/**
 * List house accounts
 * GET /api/house-accounts
 */
export const getHouseAccounts = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { page = 1, limit = 25, search } = req.query;
  const pageNum = parseInt(page as string);
  const limitNum = parseInt(limit as string);

  const where: any = {};
  if (search) {
    where.customer = {
      OR: [
        { firstName: { contains: search as string, mode: 'insensitive' } },
        { lastName: { contains: search as string, mode: 'insensitive' } },
        { phone: { contains: search as string } },
        { email: { contains: search as string, mode: 'insensitive' } },
      ],
    };
  }

  const [accounts, total] = await Promise.all([
    prisma.houseAccount.findMany({
      where,
      include: {
        customer: {
          select: { id: true, firstName: true, lastName: true, phone: true, email: true },
        },
      },
      orderBy: { balance: 'desc' },
      skip: (pageNum - 1) * limitNum,
      take: limitNum,
    }),
    prisma.houseAccount.count({ where }),
  ]);

  res.json({
    success: true,
    data: accounts,
    pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
  });
});

/**
 * Open a house account for a customer
 * POST /api/house-accounts  { customerId, creditLimit }
 */
export const createHouseAccount = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { customerId, creditLimit } = req.body;

  const limit = rc(parseFloat(creditLimit));
  if (!customerId) throw new AppError('Customer is required', 400);
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new AppError('Credit limit must be greater than 0', 400);
  }

  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw new AppError('Customer not found', 404);

  const existing = await prisma.houseAccount.findUnique({ where: { customerId } });
  if (existing) throw new AppError('This customer already has a house account', 400);

  const account = await prisma.houseAccount.create({
    data: { customerId, creditLimit: limit },
    include: { customer: { select: { firstName: true, lastName: true } } },
  });

  await prisma.activityLog.create({
    data: {
      userId: req.user!.id,
      action: 'CREATE',
      entity: 'HOUSE_ACCOUNT',
      entityId: account.id,
      details: { customer: `${account.customer.firstName} ${account.customer.lastName}`, creditLimit: limit },
    },
  });

  logger.info(`House account opened for ${account.customer.firstName} ${account.customer.lastName} ($${limit} limit)`);
  res.status(201).json({ success: true, data: account, message: 'House account opened' });
});

/**
 * Update limit / active state
 * PUT /api/house-accounts/:id  { creditLimit?, isActive? }
 */
export const updateHouseAccount = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { creditLimit, isActive } = req.body;

  const existing = await prisma.houseAccount.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new AppError('House account not found', 404);

  const data: any = {};
  if (creditLimit !== undefined) {
    const limit = rc(parseFloat(creditLimit));
    if (!Number.isFinite(limit) || limit < 0) throw new AppError('Invalid credit limit', 400);
    data.creditLimit = limit;
  }
  if (isActive !== undefined) data.isActive = Boolean(isActive);

  const account = await prisma.houseAccount.update({
    where: { id: req.params.id },
    data,
    include: { customer: { select: { firstName: true, lastName: true } } },
  });

  res.json({ success: true, data: account, message: 'House account updated' });
});

/**
 * Record a payment received against the balance
 * POST /api/house-accounts/:id/payment  { amount, notes? }
 */
export const recordHousePayment = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { amount, notes } = req.body;
  const value = rc(parseFloat(amount));
  if (!Number.isFinite(value) || value <= 0) {
    throw new AppError('Payment amount must be greater than 0', 400);
  }

  // Fresh read + rounded write inside one transaction so a concurrent register
  // charge can't be clobbered and the balance never accumulates float drift
  const updated = await prisma.$transaction(async (tx) => {
    const account = await tx.houseAccount.findUnique({ where: { id: req.params.id } });
    if (!account) throw new AppError('House account not found', 404);

    return tx.houseAccount.update({
      where: { id: account.id },
      data: {
        balance: rc(account.balance - value),
        transactions: {
          create: {
            type: 'PAYMENT',
            amount: value,
            balanceBefore: account.balance,
            balanceAfter: rc(account.balance - value),
            notes: notes || null,
            userId: req.user!.id,
          },
        },
      },
      include: { customer: { select: { firstName: true, lastName: true } } },
    });
  });

  logger.info(`House account payment: $${value} from ${updated.customer.firstName} ${updated.customer.lastName}`);
  res.json({
    success: true,
    data: updated,
    message: `Payment of $${value.toFixed(2)} recorded — balance is now $${updated.balance.toFixed(2)}`,
  });
});

/**
 * Transaction history
 * GET /api/house-accounts/:id/transactions
 */
export const getHouseTransactions = asyncHandler(async (req: AuthRequest, res: Response) => {
  const account = await prisma.houseAccount.findUnique({ where: { id: req.params.id } });
  if (!account) throw new AppError('House account not found', 404);

  const transactions = await prisma.houseAccountTransaction.findMany({
    where: { accountId: account.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  res.json({ success: true, data: transactions });
});

/**
 * Email a statement to the account holder
 * POST /api/house-accounts/:id/statement
 */
export const emailHouseStatement = asyncHandler(async (req: AuthRequest, res: Response) => {
  const account = await prisma.houseAccount.findUnique({
    where: { id: req.params.id },
    include: { customer: true },
  });
  if (!account) throw new AppError('House account not found', 404);
  if (!account.customer.email) {
    throw new AppError('This customer has no email address on file', 400);
  }

  const since = new Date();
  since.setDate(since.getDate() - 30);
  const transactions = await prisma.houseAccountTransaction.findMany({
    where: { accountId: account.id, createdAt: { gte: since } },
    orderBy: { createdAt: 'asc' },
  });

  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const rows = transactions
    .map(
      (t) => `<tr>
        <td style="padding:4px 8px 4px 0;font-size:13px;">${new Date(t.createdAt).toLocaleDateString()}</td>
        <td style="padding:4px 8px;font-size:13px;">${t.type === 'CHARGE' ? 'Purchase' : t.type === 'PAYMENT' ? 'Payment — thank you' : 'Adjustment'}</td>
        <td style="padding:4px 0;font-size:13px;text-align:right;">${t.type === 'PAYMENT' ? '-' : ''}$${t.amount.toFixed(2)}</td>
      </tr>`
    )
    .join('');

  const storeName = config.app.name || 'Your local store';
  await sendEmail({
    to: account.customer.email,
    subject: `Your account statement — balance $${account.balance.toFixed(2)}`,
    html: `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#333;background:#f1f1f4;margin:0;padding:0;">
      <div style="max-width:520px;margin:0 auto;padding:24px 16px;">
        <div style="background:#fff;border-radius:12px;padding:28px;">
          <h2 style="margin:0 0 4px;color:#111;">Account Statement</h2>
          <p style="margin:0 0 16px;font-size:13px;color:#666;">${esc(storeName)} · ${new Date().toLocaleDateString()}</p>
          <p style="font-size:15px;">Hi ${esc(account.customer.firstName)}, here's your account activity for the last 30 days.</p>
          <table style="width:100%;border-collapse:collapse;margin:12px 0;">${rows || '<tr><td style="font-size:13px;color:#666;">No activity this period</td></tr>'}</table>
          <table style="width:100%;border-collapse:collapse;border-top:2px solid #111;">
            <tr>
              <td style="padding:8px 0;font-weight:bold;">Balance due</td>
              <td style="padding:8px 0;text-align:right;font-weight:bold;font-size:18px;">$${account.balance.toFixed(2)}</td>
            </tr>
            <tr>
              <td style="font-size:12px;color:#666;">Credit limit</td>
              <td style="font-size:12px;color:#666;text-align:right;">$${account.creditLimit.toFixed(2)}</td>
            </tr>
          </table>
          <p style="font-size:13px;color:#555;margin-top:16px;">Please stop by or call to settle your balance. Thank you for your business!</p>
        </div>
      </div>
    </body></html>`,
  });

  logger.info(`Statement emailed to ${account.customer.email}`);
  res.json({ success: true, message: `Statement emailed to ${account.customer.email}` });
});
