import { Response } from 'express';
import { asyncHandler, AppError } from '../utils/errorHandler';
import { AuthRequest } from '../types';
import prisma from '../config/database';
import { logger } from '../utils/logger';

/**
 * Get all cycle counts
 * GET /api/cycle-counts
 */
export const getCycleCounts = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { page = '1', limit = '20', status, locationId } = req.query;
  const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

  const where: any = {};
  if (status) where.status = status;
  if (locationId) where.locationId = locationId;

  const [counts, total] = await Promise.all([
    prisma.cycleCount.findMany({
      where,
      include: { items: { include: {} } },
      orderBy: { createdAt: 'desc' },
      skip,
      take: parseInt(limit as string),
    }),
    prisma.cycleCount.count({ where }),
  ]);

  res.json({ success: true, data: counts, total });
});

/**
 * Get cycle count by ID
 * GET /api/cycle-counts/:id
 */
export const getCycleCount = asyncHandler(async (req: AuthRequest, res: Response) => {
  const count = await prisma.cycleCount.findUnique({
    where: { id: req.params.id },
    include: { items: true },
  });
  if (!count) throw new AppError('Cycle count not found', 404);
  res.json({ success: true, data: count });
});

/**
 * Start a new cycle count
 * POST /api/cycle-counts
 */
export const createCycleCount = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { locationId, type = 'FULL', categoryId, notes } = req.body;

  if (!locationId) throw new AppError('Location is required', 400);

  const countNumber = `CC-${Date.now()}`;

  // Build product filter based on count type
  const productWhere: any = { locationId, isActive: true };
  if (type === 'CATEGORY' && categoryId) {
    productWhere.categoryId = categoryId;
  }

  const products = await prisma.product.findMany({
    where: productWhere,
    select: { id: true, stockQuantity: true },
  });

  if (products.length === 0) {
    throw new AppError('No products found for this location/category', 400);
  }

  const cycleCount = await prisma.cycleCount.create({
    data: {
      countNumber,
      locationId,
      type,
      categoryId,
      notes,
      createdBy: req.user!.id,
      items: {
        create: products.map((p) => ({
          productId: p.id,
          expectedQty: p.stockQuantity,
        })),
      },
    },
    include: { items: true },
  });

  logger.info(`Cycle count started: ${countNumber} (${type}, ${products.length} items)`);
  res.status(201).json({ success: true, data: cycleCount, message: 'Cycle count started' });
});

/**
 * Update counted quantities
 * PUT /api/cycle-counts/:id/items
 */
export const updateCountItems = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { items } = req.body; // [{id, countedQty, notes?}]

  const count = await prisma.cycleCount.findUnique({ where: { id } });
  if (!count) throw new AppError('Cycle count not found', 404);
  if (count.status !== 'IN_PROGRESS') throw new AppError('Cycle count is not in progress', 400);

  if (!items?.length) throw new AppError('Items are required', 400);

  await prisma.$transaction(
    items.map((item: { id: string; countedQty: number; notes?: string }) =>
      prisma.cycleCountItem.update({
        where: { id: item.id },
        data: {
          countedQty: item.countedQty,
          discrepancy: item.countedQty - (prisma.cycleCountItem.fields ? 0 : 0), // computed below
          notes: item.notes,
        },
      })
    )
  );

  // Compute discrepancies from expectedQty
  const updatedItems = await prisma.cycleCountItem.findMany({
    where: { cycleCountId: id },
  });

  await prisma.$transaction(
    updatedItems
      .filter((item) => item.countedQty !== null)
      .map((item) =>
        prisma.cycleCountItem.update({
          where: { id: item.id },
          data: { discrepancy: (item.countedQty ?? 0) - item.expectedQty },
        })
      )
  );

  res.json({ success: true, message: 'Count items updated' });
});

/**
 * Submit cycle count for review
 * POST /api/cycle-counts/:id/submit
 */
export const submitForReview = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  const count = await prisma.cycleCount.findUnique({
    where: { id },
    include: { items: true },
  });
  if (!count) throw new AppError('Cycle count not found', 404);
  if (count.status !== 'IN_PROGRESS') throw new AppError('Cycle count is not in progress', 400);

  // Check all items have been counted
  const uncounted = count.items.filter((item) => item.countedQty === null);
  if (uncounted.length > 0) {
    throw new AppError(`${uncounted.length} items have not been counted yet`, 400);
  }

  await prisma.cycleCount.update({
    where: { id },
    data: { status: 'REVIEW' },
  });

  logger.info(`Cycle count submitted for review: ${count.countNumber}`);
  res.json({ success: true, message: 'Submitted for review' });
});

/**
 * Approve cycle count and adjust inventory
 * POST /api/cycle-counts/:id/approve
 */
export const approveCycleCount = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  const count = await prisma.cycleCount.findUnique({
    where: { id },
    include: { items: true },
  });
  if (!count) throw new AppError('Cycle count not found', 404);
  if (count.status !== 'REVIEW') throw new AppError('Cycle count is not in review status', 400);

  await prisma.$transaction(async (tx) => {
    // Adjust inventory for items with discrepancies
    for (const item of count.items) {
      if (item.discrepancy && item.discrepancy !== 0 && item.countedQty !== null) {
        await tx.product.updateMany({
          where: { id: item.productId, locationId: count.locationId },
          data: { stockQuantity: item.countedQty },
        });
      }
    }

    await tx.cycleCount.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedBy: req.user!.id,
        completedAt: new Date(),
      },
    });
  });

  logger.info(`Cycle count approved: ${count.countNumber}`);
  res.json({ success: true, message: 'Cycle count approved, inventory adjusted' });
});

/**
 * Cancel a cycle count
 * POST /api/cycle-counts/:id/cancel
 */
export const cancelCycleCount = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  const count = await prisma.cycleCount.findUnique({ where: { id } });
  if (!count) throw new AppError('Cycle count not found', 404);
  if (count.status === 'APPROVED') throw new AppError('Cannot cancel an approved cycle count', 400);

  await prisma.cycleCount.update({
    where: { id },
    data: { status: 'CANCELLED' },
  });

  logger.info(`Cycle count cancelled: ${count.countNumber}`);
  res.json({ success: true, message: 'Cycle count cancelled' });
});
