import { Response } from 'express';
import { Prisma } from '@prisma/client';
import { nextDocumentNumber } from '../services/documentNumber.service';
import { z } from 'zod';
import { asyncHandler, AppError } from '../utils/errorHandler';
import { AuthRequest } from '../types';
import prisma from '../config/database';
import { assertOwnsRecord, getLocationFilter, resolveWriteLocation } from '../utils/locationFilter.util';
import { lockInventory, moveInventory } from '../services/inventory.service';

const itemInclude = { product: { select: { id: true, name: true, sku: true, stockVersion: true, stockQuantity: true } } } as const;
async function lockedCount(tx: Prisma.TransactionClient, req: AuthRequest) {
  await tx.$queryRaw`SELECT id FROM cycle_counts WHERE id = ${req.params.id} FOR UPDATE`;
  const count = await tx.cycleCount.findUnique({ where: { id: req.params.id }, include: { items: true } });
  if (!count) throw new AppError('Cycle count not found', 404);
  assertOwnsRecord(req, count.locationId);
  return count;
}

export const getCycleCounts = asyncHandler(async (req: AuthRequest, res: Response) => {
  const query = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20), status: z.enum(['IN_PROGRESS', 'REVIEW', 'APPROVED', 'CANCELLED']).optional() }).parse(req.query);
  const where = { ...getLocationFilter(req, req.query.locationId as string), status: query.status };
  const [counts, total] = await Promise.all([
    prisma.cycleCount.findMany({ where, include: { items: { include: itemInclude } }, orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * query.limit, take: query.limit }),
    prisma.cycleCount.count({ where }),
  ]);
  res.json({ success: true, data: counts, total });
});

export const getCycleCount = asyncHandler(async (req: AuthRequest, res: Response) => {
  const count = await prisma.cycleCount.findUnique({ where: { id: req.params.id }, include: { items: { include: itemInclude } } });
  if (!count) throw new AppError('Cycle count not found', 404);
  assertOwnsRecord(req, count.locationId);
  res.json({ success: true, data: count });
});

export const createCycleCount = asyncHandler(async (req: AuthRequest, res: Response) => {
  const body = z.object({ type: z.enum(['FULL', 'CATEGORY', 'PARTIAL']).default('FULL'), categoryId: z.string().min(1).optional(), productIds: z.array(z.string().min(1)).min(1).max(1000).optional(), notes: z.string().max(2000).optional(), locationId: z.string().optional() }).parse(req.body);
  const locationId = resolveWriteLocation(req, body.locationId);
  if (body.type === 'CATEGORY' && !body.categoryId) throw new AppError('Select a category', 400);
  if (body.type === 'PARTIAL' && !body.productIds?.length) throw new AppError('Select products for a partial count', 400);
  const products = await prisma.product.findMany({ where: {
    locationId, isActive: true, trackInventory: true, sku: { notIn: ['MISC', 'MISC-001'] },
    ...(body.type === 'CATEGORY' ? { categoryId: body.categoryId } : {}),
    ...(body.type === 'PARTIAL' ? { id: { in: body.productIds } } : {}),
  }, select: { id: true, stockQuantity: true, stockVersion: true } });
  if (!products.length) throw new AppError('No tracked products found for this selection', 400);
  if (body.type === 'PARTIAL' && products.length !== new Set(body.productIds).size) throw new AppError('Some selected products are unavailable at this store', 400);
  const count = await prisma.cycleCount.create({ data: {
    countNumber: await nextDocumentNumber('CC'), locationId, type: body.type, categoryId: body.type === 'CATEGORY' ? body.categoryId : null,
    notes: body.notes, createdBy: req.user!.id,
    items: { create: products.map(p => ({ productId: p.id, expectedQty: p.stockQuantity, stockVersion: p.stockVersion })) },
  }, include: { items: true } });
  res.status(201).json({ success: true, data: count, message: 'Cycle count started' });
});

export const updateCountItems = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { items } = z.object({ items: z.array(z.object({ id: z.string().min(1), countedQty: z.number().int().min(0).max(2147483647), notes: z.string().max(2000).optional() })).min(1).max(1000) }).parse(req.body);
  if (new Set(items.map(i => i.id)).size !== items.length) throw new AppError('Duplicate count item', 400);
  await prisma.$transaction(async tx => {
    const count = await lockedCount(tx, req);
    if (count.status !== 'IN_PROGRESS') throw new AppError('Cycle count is not in progress', 409);
    const ownItems = new Map(count.items.map(i => [i.id, i]));
    if (items.some(i => !ownItems.has(i.id))) throw new AppError('An item does not belong to this count', 400);
    for (const item of items) await tx.cycleCountItem.update({ where: { id: item.id }, data: { countedQty: item.countedQty, notes: item.notes, discrepancy: item.countedQty - ownItems.get(item.id)!.expectedQty } });
  });
  res.json({ success: true, message: 'Count items updated' });
});

export const submitForReview = asyncHandler(async (req: AuthRequest, res: Response) => {
  await prisma.$transaction(async tx => {
    const count = await lockedCount(tx, req);
    if (count.status !== 'IN_PROGRESS') throw new AppError('Cycle count is not in progress', 409);
    if (count.items.some(i => i.countedQty === null)) throw new AppError('Count every item before submitting', 400);
    await tx.cycleCount.update({ where: { id: count.id }, data: { status: 'REVIEW' } });
  });
  res.json({ success: true, message: 'Submitted for review' });
});

export const approveCycleCount = asyncHandler(async (req: AuthRequest, res: Response) => {
  await prisma.$transaction(async tx => {
    const count = await lockedCount(tx, req);
    if (count.status !== 'REVIEW') throw new AppError('Cycle count is not in review status', 409);
    await lockInventory(tx, count.items.map(i => i.productId));
    const products = await tx.product.findMany({ where: { id: { in: count.items.map(i => i.productId) }, locationId: count.locationId } });
    const current = new Map(products.map(p => [p.id, p]));
    if (count.items.some(i => i.countedQty === null || i.stockVersion === null || current.get(i.productId)?.stockVersion !== i.stockVersion)) {
      throw new AppError('Stock changed after this count began. Refresh changed items and recount them before approval.', 409);
    }
    for (const item of [...count.items].sort((a, b) => a.productId.localeCompare(b.productId))) {
      if (item.countedQty !== item.expectedQty) await moveInventory(tx, { productId: item.productId, locationId: count.locationId, userId: req.user!.id, type: 'CYCLE_COUNT', sourceId: count.id, setQuantity: item.countedQty!, expectedVersion: item.stockVersion, notes: 'Approved count ' + count.countNumber });
    }
    await tx.cycleCount.update({ where: { id: count.id }, data: { status: 'APPROVED', approvedBy: req.user!.id, completedAt: new Date() } });
    await tx.activityLog.create({ data: { userId: req.user!.id, locationId: count.locationId, action: 'CYCLE_COUNT_APPROVED', entity: 'CycleCount', entityId: count.id } });
  });
  res.json({ success: true, message: 'Cycle count approved, inventory adjusted' });
});

/** Clear only stale observations; never silently carry old counts forward. */
export const refreshCountItems = asyncHandler(async (req: AuthRequest, res: Response) => {
  const refreshed = await prisma.$transaction(async tx => {
    const count = await lockedCount(tx, req);
    if (!['IN_PROGRESS', 'REVIEW'].includes(count.status)) throw new AppError('Only an open count can be refreshed', 409);
    await lockInventory(tx, count.items.map(i => i.productId));
    const products = await tx.product.findMany({ where: { id: { in: count.items.map(i => i.productId) }, locationId: count.locationId } });
    const current = new Map(products.map(p => [p.id, p]));
    const changed = count.items.filter(i => i.stockVersion !== current.get(i.productId)?.stockVersion);
    for (const item of changed) {
      const product = current.get(item.productId);
      if (!product) throw new AppError('A counted product is unavailable. Cancel this count and start a new one.', 409);
      await tx.cycleCountItem.update({ where: { id: item.id }, data: { expectedQty: product.stockQuantity, stockVersion: product.stockVersion, countedQty: null, discrepancy: null } });
    }
    if (changed.length) {
      await tx.cycleCount.update({ where: { id: count.id }, data: { status: 'IN_PROGRESS' } });
      await tx.activityLog.create({ data: { userId: req.user!.id, locationId: count.locationId, action: 'CYCLE_COUNT_REFRESHED', entity: 'CycleCount', entityId: count.id, details: { itemIds: changed.map(i => i.id) } } });
    }
    return changed.length;
  });
  res.json({ success: true, data: { refreshed }, message: refreshed + ' changed items require recounting' });
});

export const cancelCycleCount = asyncHandler(async (req: AuthRequest, res: Response) => {
  await prisma.$transaction(async tx => {
    const count = await lockedCount(tx, req);
    if (!['IN_PROGRESS', 'REVIEW'].includes(count.status)) throw new AppError('Only an open cycle count can be cancelled', 409);
    await tx.cycleCount.update({ where: { id: count.id }, data: { status: 'CANCELLED' } });
  });
  res.json({ success: true, message: 'Cycle count cancelled' });
});
