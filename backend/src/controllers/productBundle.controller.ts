import { Response } from 'express';
import { z } from 'zod';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import { asyncHandler, AppError } from '../utils/errorHandler';
import { resolveWriteLocation } from '../utils/locationFilter.util';
import { getBundle, openBundle, setBundleContents } from '../services/productBundle.service';

/** Variety packs: what a pack contains, and opening packs into their contents. */
async function storeOf(req: AuthRequest) {
  const product = await prisma.product.findUnique({ where: { id: req.params.id }, select: { locationId: true } });
  if (!product || (req.user!.role !== 'SUPER_ADMIN' && product.locationId !== req.user!.locationId)) throw new AppError('Product not found', 404);
  return product.locationId!;
}

export const getBundleContents = asyncHandler(async (req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await getBundle(prisma, req.params.id, await storeOf(req)) });
});

const contentsBody = z.object({
  components: z.array(z.object({
    productId: z.string().min(1),
    quantity: z.number().int().min(1).max(100000),
    // A fraction (0-1] of the pack's cost; all or none.
    costShare: z.number().gt(0).max(1).nullable().optional(),
  })).max(100),
});

export const updateBundleContents = asyncHandler(async (req: AuthRequest, res: Response) => {
  const body = contentsBody.parse(req.body);
  const locationId = resolveWriteLocation(req);
  await prisma.$transaction(tx => setBundleContents(tx, { productId: req.params.id, locationId, components: body.components }));
  res.json({ success: true, data: await getBundle(prisma, req.params.id, locationId) });
});

const openBody = z.object({ quantity: z.number().int().min(1).max(100000), idempotencyKey: z.string().trim().min(8).max(100) });

export const openBundlePacks = asyncHandler(async (req: AuthRequest, res: Response) => {
  const body = openBody.parse(req.body);
  const locationId = resolveWriteLocation(req);
  const result = await prisma.$transaction(tx => openBundle(tx, { productId: req.params.id, locationId, userId: req.user!.id,
    quantity: body.quantity, idempotencyKey: body.idempotencyKey }));
  res.json({ success: true, data: { opening: result.opening, replayed: result.replayed, bundle: await getBundle(prisma, req.params.id, locationId) } });
});
