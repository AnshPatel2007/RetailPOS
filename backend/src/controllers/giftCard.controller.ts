import { Response } from 'express';
import { asyncHandler, AppError } from '../utils/errorHandler';
import { AuthRequest } from '../types';
import prisma from '../config/database';
import { fundAccount, operationReceipt } from '../services/accountFunding.service';
import { assertOwnsRecord, getSharedOrOwnFilter, isSuperAdmin } from '../utils/locationFilter.util';


/**
 * Get all gift cards
 * GET /api/gift-cards
 */
export const getGiftCards = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { search, isActive, page = '1', limit = '20' } = req.query;
  const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

  const where: any = { ...getSharedOrOwnFilter(req, req.query.locationId as string) };
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
      transactions: { orderBy: { createdAt: 'desc' }, take: 100, include: { operation: true } },
    },
  });

  if (!card) throw new AppError('Gift card not found', 404);
  if (!isSuperAdmin(req) && card.locationId !== req.user!.locationId) {
    throw new AppError('Gift card not found', 404);
  }
  res.json({ success: true, data: { ...card, transactions: card.transactions.map(t => ({ ...t, operation: t.operation ? operationReceipt(t.operation) : null })) } });
});

/**
 * Aggregate gift card stats for the dashboard cards
 * GET /api/gift-cards/stats
 */
export const getGiftCardStats = asyncHandler(async (req: AuthRequest, res: Response) => {
  const scope = getSharedOrOwnFilter(req, req.query.locationId as string);
  const [activeStats, totalCount, allStats] = await Promise.all([
    prisma.giftCard.aggregate({
      where: {
        ...scope,
        isActive: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      _sum: { currentBalance: true },
      _count: true,
    }),
    prisma.giftCard.count({ where: scope }),
    // Balances left on expired or deactivated cards are still shown, apart from usable ones.
    prisma.giftCard.aggregate({ where: scope, _sum: { currentBalance: true } }),
  ]);
  const outstandingBalance = Math.round(Number((activeStats._sum.currentBalance || 0)) * 100) / 100;
  const allBalances = Math.round(Number((allStats._sum.currentBalance || 0)) * 100) / 100;

  res.json({
    success: true,
    data: {
      totalCards: totalCount,
      activeCards: activeStats._count,
      outstandingBalance,
      inactiveBalance: Math.round((allBalances - outstandingBalance) * 100) / 100,
    },
  });
});

/**
 * Issue (create) a new gift card
 * POST /api/gift-cards
 */
export const issueGiftCard = asyncHandler(async (req: AuthRequest, res: Response) => {
  const result = await prisma.$transaction(tx => fundAccount(req, tx, 'GIFT_ISSUE'));
  res.status(result.replayed ? 200 : 201).json({ success: true, ...result, message: result.replayed ? 'Saved gift card confirmed' : 'Gift card issued' });
});

/**
 * Reload a gift card
 * POST /api/gift-cards/:id/reload
 */
export const reloadGiftCard = asyncHandler(async (req: AuthRequest, res: Response) => {
  const result = await prisma.$transaction(tx => fundAccount(req, tx, 'GIFT_RELOAD'));
  res.json({ success: true, ...result, message: result.replayed ? 'Saved reload confirmed' : 'Gift card reloaded' });
});

/**
 * Redeem from gift card (called during sale)
 * POST /api/gift-cards/:idOrCode/redeem
 */
export const redeemGiftCard = asyncHandler(async (_req: AuthRequest, _res: Response) => {
  throw new AppError('Redeem gift cards through checkout so the payment, sale and balance are recorded together.', 409);
});

/**
 * Deactivate a gift card
 * POST /api/gift-cards/:id/deactivate
 */
export const deactivateGiftCard = asyncHandler(async (req: AuthRequest, res: Response) => {
  const card = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM gift_cards WHERE id = ${req.params.id} FOR UPDATE`;
    const existing = await tx.giftCard.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError('Gift card not found', 404);
    assertOwnsRecord(req, existing.locationId);
    const updated = await tx.giftCard.update({ where: { id: existing.id }, data: { isActive: false } });
    await tx.activityLog.create({ data: { userId: req.user!.id, locationId: existing.locationId, action: 'DEACTIVATE', entity: 'GIFT_CARD', entityId: existing.id } });
    return updated;
  });
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
  if (!isSuperAdmin(req) && card.locationId !== req.user!.locationId) {
    throw new AppError('This gift card is not valid at this location', 400);
  }

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
