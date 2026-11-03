import { Response } from 'express';
import { z } from 'zod';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import { asyncHandler, AppError } from '../utils/errorHandler';
import { resolveWriteLocation } from '../utils/locationFilter.util';
import { lockInventory, moveInventory } from '../services/inventory.service';

const adjustment = z.object({ quantity: z.number().int().min(-2147483647).max(2147483647), type: z.string().max(50).optional(), notes: z.string().max(2000).optional(), expectedVersion: z.number().int().min(0).optional() });

export const adjustInventory = asyncHandler(async (req: AuthRequest, res: Response) => {
  const body = adjustment.parse(req.body);
  const product = await prisma.$transaction(tx => moveInventory(tx, {
    productId: req.params.id, locationId: resolveWriteLocation(req), userId: req.user!.id,
    type: body.type || 'ADJUSTMENT', costKind: body.quantity < 0 && ['DAMAGED','LOST','THEFT','EXPIRED','WASTE','OTHER'].includes(body.type || '') ? 'STOCK_LOSS' : 'ADJUSTMENT',
    quantity: body.quantity, notes: body.notes, expectedVersion: body.expectedVersion,
  }));
  res.json({ success: true, data: product, message: 'Inventory adjusted successfully' });
});

export const bulkUpdateStock = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { updates } = z.object({ updates: z.array(adjustment.extend({ productId: z.string().min(1) })).min(1).max(1000) }).parse(req.body);
  if (new Set(updates.map(i => i.productId)).size !== updates.length) throw new AppError('Duplicate product in stock update', 400);
  const locationId = resolveWriteLocation(req);
  const products = await prisma.$transaction(async tx => {
    await lockInventory(tx, updates.map(i => i.productId));
    const result = [];
    for (const item of [...updates].sort((a, b) => a.productId.localeCompare(b.productId))) {
      if (item.type === 'set' && item.expectedVersion === undefined) throw new AppError('Refresh product stock before setting an absolute quantity', 409);
      result.push(await moveInventory(tx, { productId: item.productId, locationId, userId: req.user!.id, type: 'ADJUSTMENT',
        quantity: item.type === 'set' ? undefined : item.quantity, setQuantity: item.type === 'set' ? item.quantity : undefined,
        expectedVersion: item.type === 'set' ? item.expectedVersion : undefined, notes: item.notes || 'Bulk stock adjustment' }));
    }
    return result;
  });
  res.json({ success: true, data: { updatedCount: products.length, products }, message: products.length + ' products updated' });
});
