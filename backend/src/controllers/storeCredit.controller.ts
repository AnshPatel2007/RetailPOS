import { Response } from 'express';
import { asyncHandler, AppError } from '../utils/errorHandler';
import { AuthRequest } from '../types';
import prisma from '../config/database';
import { logger } from '../utils/logger';

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

  res.json({ success: true, data: account });
});

/**
 * Add credit to a customer's account
 * POST /api/store-credit/:customerId/credit
 */
export const addCredit = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { customerId } = req.params;
  const { amount, notes, saleId } = req.body;

  if (!amount || amount <= 0) throw new AppError('Amount must be positive', 400);

  // Ensure customer exists
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw new AppError('Customer not found', 404);

  const result = await prisma.$transaction(async (tx) => {
    // Get or create account
    let account = await tx.storeCreditAccount.findUnique({ where: { customerId } });

    if (!account) {
      account = await tx.storeCreditAccount.create({
        data: { customerId, balance: 0 },
      });
    }

    // Add credit
    const updated = await tx.storeCreditAccount.update({
      where: { id: account.id },
      data: {
        balance: { increment: amount },
        transactions: {
          create: {
            type: 'CREDIT',
            amount,
            balanceBefore: account.balance,
            balanceAfter: account.balance + amount,
            saleId,
            notes,
          },
        },
      },
    });

    return updated;
  });

  logger.info(`Store credit added: $${amount} for customer ${customerId}`);
  res.json({ success: true, data: result, message: 'Store credit added' });
});

/**
 * Debit from a customer's store credit (used during sale)
 * POST /api/store-credit/:customerId/debit
 */
export const debitCredit = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { customerId } = req.params;
  const { amount, saleId } = req.body;

  if (!amount || amount <= 0) throw new AppError('Amount must be positive', 400);

  const account = await prisma.storeCreditAccount.findUnique({ where: { customerId } });
  if (!account) throw new AppError('No store credit account found', 404);
  if (account.balance < amount) throw new AppError(`Insufficient store credit. Available: $${account.balance.toFixed(2)}`, 400);

  const updated = await prisma.storeCreditAccount.update({
    where: { id: account.id },
    data: {
      balance: { decrement: amount },
      transactions: {
        create: {
          type: 'DEBIT',
          amount: -amount,
          balanceBefore: account.balance,
          balanceAfter: account.balance - amount,
          saleId,
        },
      },
    },
  });

  logger.info(`Store credit debited: $${amount} from customer ${customerId}`);
  res.json({ success: true, data: updated, message: 'Store credit applied' });
});
