import { Response } from 'express';
import { asyncHandler, AppError } from '../utils/errorHandler';
import { AuthRequest } from '../types';
import prisma from '../config/database';
import { logger } from '../utils/logger';
import crypto from 'crypto';

/**
 * Generate unique gift card code
 */
const generateCode = (): string => {
  return crypto.randomBytes(8).toString('hex').toUpperCase().match(/.{1,4}/g)!.join('-');
};

/**
 * Get all gift cards
 * GET /api/gift-cards
 */
export const getGiftCards = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { search, isActive, page = '1', limit = '20' } = req.query;
  const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

  const where: any = {};
  if (isActive !== undefined) where.isActive = isActive === 'true';
  if (search) {
    where.OR = [
      { code: { contains: search as string, mode: 'insensitive' } },
    ];
  }

  const [cards, total] = await Promise.all([
    prisma.giftCard.findMany({
      where,
      include: { customer: { select: { firstName: true, lastName: true, phone: true } } },
      orderBy: { createdAt: 'desc' },
      skip,
      take: parseInt(limit as string),
    }),
    prisma.giftCard.count({ where }),
  ]);

  res.json({ success: true, data: cards, total, page: parseInt(page as string), limit: parseInt(limit as string) });
});

/**
 * Get gift card by ID or code
 * GET /api/gift-cards/:idOrCode
 */
export const getGiftCard = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { idOrCode } = req.params;

  const card = await prisma.giftCard.findFirst({
    where: { OR: [{ id: idOrCode }, { code: idOrCode }] },
    include: {
      customer: { select: { firstName: true, lastName: true, phone: true } },
      transactions: { orderBy: { createdAt: 'desc' }, take: 20 },
    },
  });

  if (!card) throw new AppError('Gift card not found', 404);
  res.json({ success: true, data: card });
});

/**
 * Issue (create) a new gift card
 * POST /api/gift-cards
 */
export const issueGiftCard = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { amount, customerId, expiresAt } = req.body;

  if (!amount || amount <= 0) throw new AppError('Amount must be positive', 400);

  const code = generateCode();

  const card = await prisma.giftCard.create({
    data: {
      code,
      initialBalance: amount,
      currentBalance: amount,
      customerId: customerId || null,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      transactions: {
        create: {
          type: 'ISSUE',
          amount,
          balanceBefore: 0,
          balanceAfter: amount,
        },
      },
    },
    include: { customer: { select: { firstName: true, lastName: true } } },
  });

  logger.info(`Gift card issued: ${code} for $${amount}`);
  res.status(201).json({ success: true, data: card, message: 'Gift card issued' });
});

/**
 * Reload a gift card
 * POST /api/gift-cards/:id/reload
 */
export const reloadGiftCard = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { amount } = req.body;

  if (!amount || amount <= 0) throw new AppError('Amount must be positive', 400);

  const card = await prisma.giftCard.findUnique({ where: { id } });
  if (!card) throw new AppError('Gift card not found', 404);
  if (!card.isActive) throw new AppError('Gift card is deactivated', 400);

  const updated = await prisma.giftCard.update({
    where: { id },
    data: {
      currentBalance: { increment: amount },
      transactions: {
        create: {
          type: 'RELOAD',
          amount,
          balanceBefore: card.currentBalance,
          balanceAfter: card.currentBalance + amount,
        },
      },
    },
  });

  logger.info(`Gift card reloaded: ${card.code} +$${amount}`);
  res.json({ success: true, data: updated, message: 'Gift card reloaded' });
});

/**
 * Redeem from gift card (called during sale)
 * POST /api/gift-cards/:idOrCode/redeem
 */
export const redeemGiftCard = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { idOrCode } = req.params;
  const { amount, saleId } = req.body;

  if (!amount || amount <= 0) throw new AppError('Amount must be positive', 400);

  const card = await prisma.giftCard.findFirst({
    where: { OR: [{ id: idOrCode }, { code: idOrCode }] },
  });

  if (!card) throw new AppError('Gift card not found', 404);
  if (!card.isActive) throw new AppError('Gift card is deactivated', 400);
  if (card.expiresAt && card.expiresAt < new Date()) throw new AppError('Gift card has expired', 400);
  if (card.currentBalance < amount) throw new AppError(`Insufficient balance. Available: $${card.currentBalance.toFixed(2)}`, 400);

  const updated = await prisma.giftCard.update({
    where: { id: card.id },
    data: {
      currentBalance: { decrement: amount },
      transactions: {
        create: {
          type: 'REDEEM',
          amount: -amount,
          balanceBefore: card.currentBalance,
          balanceAfter: card.currentBalance - amount,
          saleId,
        },
      },
    },
  });

  logger.info(`Gift card redeemed: ${card.code} -$${amount}`);
  res.json({ success: true, data: updated, message: 'Gift card redeemed' });
});

/**
 * Deactivate a gift card
 * POST /api/gift-cards/:id/deactivate
 */
export const deactivateGiftCard = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  const card = await prisma.giftCard.update({
    where: { id },
    data: { isActive: false },
  });

  logger.info(`Gift card deactivated: ${card.code}`);
  res.json({ success: true, data: card, message: 'Gift card deactivated' });
});

/**
 * Check gift card balance by code
 * GET /api/gift-cards/balance/:code
 */
export const checkBalance = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { code } = req.params;

  const card = await prisma.giftCard.findUnique({ where: { code } });
  if (!card) throw new AppError('Gift card not found', 404);

  res.json({
    success: true,
    data: {
      code: card.code,
      currentBalance: card.currentBalance,
      isActive: card.isActive,
      expiresAt: card.expiresAt,
    },
  });
});
