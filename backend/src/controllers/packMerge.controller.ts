import { Response } from 'express';
import { z } from 'zod';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import { asyncHandler } from '../utils/errorHandler';
import { resolveWriteLocation } from '../utils/locationFilter.util';
import { mergeIntoPack, previewPackMerge } from '../services/packMerge.service';

/** Merge a standalone product (e.g. a carton sold as its own item) into a pack of another product. */
const mergeBody = z.object({
  baseProductId: z.string().uuid(),
  unitsPerPackage: z.number().int().min(2).max(100000),
  name: z.string().trim().min(1).max(60).optional(),
  price: z.number().gt(0).max(1_000_000).optional(),
  barcode: z.string().trim().min(3).max(100).optional(),
});

export const previewMerge = asyncHandler(async (req: AuthRequest, res: Response) => {
  const body = mergeBody.parse(req.body);
  const locationId = resolveWriteLocation(req);
  res.json({ success: true, data: await previewPackMerge(prisma, { ...body, locationId, sourceProductId: req.params.id }) });
});

export const merge = asyncHandler(async (req: AuthRequest, res: Response) => {
  const body = mergeBody.extend({ idempotencyKey: z.string().trim().min(8).max(100) }).parse(req.body);
  const locationId = resolveWriteLocation(req);
  const result = await prisma.$transaction(tx => mergeIntoPack(tx, { ...body, locationId, sourceProductId: req.params.id, userId: req.user!.id }));
  res.status(result.replayed ? 200 : 201).json({ success: true, data: result });
});
