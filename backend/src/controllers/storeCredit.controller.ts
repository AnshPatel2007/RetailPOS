import { Response } from 'express';
import { asyncHandler, AppError } from '../utils/errorHandler';
import { AuthRequest } from '../types';
import prisma from '../config/database';
import { fundAccount, operationReceipt } from '../services/accountFunding.service';
import { assertCanReadRecord, getSharedOrOwnFilter } from '../utils/locationFilter.util';

/**
 * List all store credit accounts with balances
 * GET /api/store-credit
 */
export const listAccounts = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { page = '1', limit = '25', search } = req.query as Record<string, string>;
  const pageNum = parseInt(page) || 1;
  const limitNum = Math.min(parseInt(limit) || 25, 100);
  const skip = (pageNum - 1) * limitNum;

  const where: any = { ...getSharedOrOwnFilter(req, req.query.locationId as string) };
  if (search) {
    where.customer = {
      OR: [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ],
    };
  }

  const [accounts, total] = await Promise.all([
    prisma.storeCreditAccount.findMany({
      where,
      include: {
        customer: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
      },
      orderBy: { updatedAt: 'desc' },
      skip,
      take: limitNum,
    }),
    prisma.storeCreditAccount.count({ where }),
  ]);

  res.json({
    success: true,
    data: accounts,
    pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
  });
});

/**
 * Get transaction history for a store credit account
 * GET /api/store-credit/:customerId/transactions
 */
export const getTransactions = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { customerId } = req.params;
  const { page = '1', limit = '50' } = req.query as Record<string, string>;
  const pageNum = parseInt(page) || 1;
  const limitNum = Math.min(parseInt(limit) || 50, 200);
  const skip = (pageNum - 1) * limitNum;

  const account = await prisma.storeCreditAccount.findUnique({ where: { customerId } });
  if (!account) {
    res.json({ success: true, data: [], pagination: { page: 1, limit: limitNum, total: 0, totalPages: 0 } });
    return;
  }
  assertCanReadRecord(req, account.locationId, 'Store credit account not found');

  const [transactions, total] = await Promise.all([
    prisma.storeCreditTransaction.findMany({
      where: { accountId: account.id },
      include: { operation: true },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limitNum,
    }),
    prisma.storeCreditTransaction.count({ where: { accountId: account.id } }),
  ]);

  res.json({
    success: true,
    data: transactions.map(t => ({ ...t, operation: t.operation ? operationReceipt(t.operation) : null })),
    pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
  });
});

/**
 * Get store credit balance for a customer
 * GET /api/store-credit/:customerId
 */
export const getBalance = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { customerId } = req.params;

  let account = await prisma.storeCreditAccount.findUnique({
    where: { customerId },
    include: {
      customer: { select: { firstName: true, lastName: true, phone: true } },
      transactions: { orderBy: { createdAt: 'desc' }, take: 20 },
    },
  });

  if (!account) {
    // Return zero balance if no account exists
    res.json({ success: true, data: { customerId, balance: 0, transactions: [] } });
    return;
  }
  assertCanReadRecord(req, account.locationId, 'Store credit account not found');

  res.json({ success: true, data: account });
});

/**
 * Add credit to a customer's account
 * POST /api/store-credit/:customerId/credit
 */
export const addCredit = asyncHandler(async (req: AuthRequest, res: Response) => {
  const result = await prisma.$transaction(tx => fundAccount(req, tx, 'STORE_CREDIT'));
  res.json({ success: true, ...result, message: result.replayed ? 'Saved credit confirmed' : 'Store credit added' });
});

/**
 * Debit from a customer's store credit (used during sale)
 * POST /api/store-credit/:customerId/debit
 */
export const debitCredit = asyncHandler(async (_req: AuthRequest, _res: Response) => {
  throw new AppError('Apply store credit through checkout so the payment, sale and balance are recorded together.', 409);
});
