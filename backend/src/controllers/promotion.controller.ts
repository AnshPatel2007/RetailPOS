import { Response } from 'express';
import { asyncHandler, AppError } from '../utils/errorHandler';
import { AuthRequest } from '../types';
import prisma from '../config/database';
import { logger } from '../utils/logger';
import { isPromotionActiveNow } from '../utils/promotionEngine';
import { assertOwnsRecord, assertCanReadRecord, isSuperAdmin } from '../utils/locationFilter.util';

const promotionData = (body: any, locationId: string | null) => ({
  name: body.name,
  description: body.description ?? null,
  type: body.type,
  isActive: body.isActive ?? true,
  buyQuantity: body.buyQuantity ?? null,
  getQuantity: body.getQuantity ?? null,
  bundlePrice: body.bundlePrice ?? null,
  percentOff: body.percentOff ?? null,
  amountOff: body.amountOff ?? null,
  productIds: body.productIds ?? [],
  categoryIds: body.categoryIds ?? [],
  startsAt: body.startsAt ? new Date(body.startsAt) : null,
  endsAt: body.endsAt ? new Date(body.endsAt) : null,
  daysOfWeek: body.daysOfWeek ?? [],
  startTime: body.startTime ?? null,
  endTime: body.endTime ?? null,
  locationId,
  priority: body.priority ?? 0,
});

/** Non-SUPER_ADMIN is always forced to their own store; SUPER_ADMIN may set any value (including null for chain-wide) */
const resolveLocationId = (req: AuthRequest, body: any): string | null =>
  isSuperAdmin(req) ? (body.locationId ?? null) : (req.user!.locationId ?? null);

/**
 * List promotions (back office)
 * GET /api/promotions
 */
export const getPromotions = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { page = 1, limit = 20, search, isActive } = req.query;

  const pageNum = parseInt(page as string);
  const limitNum = parseInt(limit as string);

  const where: any = {};
  if (search) {
    where.name = { contains: search as string, mode: 'insensitive' };
  }
  if (isActive === 'true') where.isActive = true;
  if (isActive === 'false') where.isActive = false;
  // Managers scoped to a location see global promos plus their own location's
  if (req.user?.locationId) {
    where.OR = [{ locationId: null }, { locationId: req.user.locationId }];
  }

  const [promotions, total] = await Promise.all([
    prisma.promotion.findMany({
      where,
      orderBy: [{ isActive: 'desc' }, { priority: 'desc' }, { createdAt: 'desc' }],
      skip: (pageNum - 1) * limitNum,
      take: limitNum,
    }),
    prisma.promotion.count({ where }),
  ]);

  res.json({
    success: true,
    data: promotions,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
    },
  });
});

/**
 * Promotions currently in effect, for the POS cart preview
 * GET /api/promotions/active
 */
export const getActivePromotions = asyncHandler(async (req: AuthRequest, res: Response) => {
  const promotions = await prisma.promotion.findMany({
    where: {
      isActive: true,
      OR: [{ locationId: null }, { locationId: req.user?.locationId ?? null }],
    },
    orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
  });

  // Date-window filtering happens server-side; day/time windows are re-checked by
  // the POS clock so an open register picks up happy-hour starts without a refetch.
  const now = new Date();
  const active = promotions.filter((p) =>
    isPromotionActiveNow({ isActive: p.isActive, startsAt: p.startsAt, endsAt: p.endsAt }, now)
  );

  res.json({ success: true, data: active });
});

/**
 * Get single promotion
 * GET /api/promotions/:id
 */
export const getPromotion = asyncHandler(async (req: AuthRequest, res: Response) => {
  const promotion = await prisma.promotion.findUnique({ where: { id: req.params.id } });
  if (!promotion) {
    throw new AppError('Promotion not found', 404);
  }
  assertCanReadRecord(req, promotion.locationId, 'Promotion not found');
  res.json({ success: true, data: promotion });
});

/**
 * Create promotion
 * POST /api/promotions
 */
export const createPromotion = asyncHandler(async (req: AuthRequest, res: Response) => {
  const promotion = await prisma.promotion.create({
    data: promotionData(req.body, resolveLocationId(req, req.body)),
  });

  await prisma.activityLog.create({
    data: {
      userId: req.user!.id,
      action: 'CREATE',
      entity: 'PROMOTION',
      entityId: promotion.id,
      details: { name: promotion.name, type: promotion.type },
      locationId: promotion.locationId,
    },
  });

  logger.info(`Promotion created: ${promotion.name} (${promotion.type})`);
  res.status(201).json({ success: true, data: promotion, message: 'Promotion created' });
});

/**
 * Update promotion
 * PUT /api/promotions/:id
 */
export const updatePromotion = asyncHandler(async (req: AuthRequest, res: Response) => {
  const existing = await prisma.promotion.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    throw new AppError('Promotion not found', 404);
  }
  assertOwnsRecord(req, existing.locationId);

  const promotion = await prisma.promotion.update({
    where: { id: req.params.id },
    data: promotionData(req.body, resolveLocationId(req, req.body)),
  });

  await prisma.activityLog.create({
    data: {
      userId: req.user!.id,
      action: 'UPDATE',
      entity: 'PROMOTION',
      entityId: promotion.id,
      details: { name: promotion.name, type: promotion.type },
      locationId: promotion.locationId,
    },
  });

  res.json({ success: true, data: promotion, message: 'Promotion updated' });
});

/**
 * Toggle active state
 * POST /api/promotions/:id/toggle
 */
export const togglePromotion = asyncHandler(async (req: AuthRequest, res: Response) => {
  const existing = await prisma.promotion.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    throw new AppError('Promotion not found', 404);
  }
  assertOwnsRecord(req, existing.locationId);

  const promotion = await prisma.promotion.update({
    where: { id: req.params.id },
    data: { isActive: !existing.isActive },
  });

  res.json({
    success: true,
    data: promotion,
    message: promotion.isActive ? 'Promotion activated' : 'Promotion deactivated',
  });
});

/**
 * Delete promotion (sale items keep their denormalized promo name)
 * DELETE /api/promotions/:id
 */
export const deletePromotion = asyncHandler(async (req: AuthRequest, res: Response) => {
  const existing = await prisma.promotion.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    throw new AppError('Promotion not found', 404);
  }
  assertOwnsRecord(req, existing.locationId);

  await prisma.promotion.delete({ where: { id: req.params.id } });

  await prisma.activityLog.create({
    data: {
      userId: req.user!.id,
      action: 'DELETE',
      entity: 'PROMOTION',
      entityId: req.params.id,
      details: { name: existing.name },
      locationId: existing.locationId,
    },
  });

  res.json({ success: true, message: 'Promotion deleted' });
});
