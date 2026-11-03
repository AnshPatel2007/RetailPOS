import { Response } from 'express';
import { z } from 'zod';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import { asyncHandler, AppError } from '../utils/errorHandler';
import { resolveWriteLocation } from '../utils/locationFilter.util';
import { lockInventory, moveInventory } from '../services/inventory.service';
import { costKindForReason } from '../services/stockReasons';

/** Every manual stock change records why it happened. OTHER requires a note. */
export const ADJUSTMENT_REASONS = ['MANUAL_COUNT', 'MISCOUNT', 'WRONG_SKU_SOLD', 'MISSING_RECEIPT', 'TRANSFER_NOT_RECORDED', 'SOLD_WITHOUT_SCANNING', 'RECEIVED', 'RETURNED',
  'DAMAGED', 'LOST', 'THEFT', 'EXPIRED', 'WASTE', 'CORRECTION', 'OTHER'] as const;
const reason = z.enum(ADJUSTMENT_REASONS, { errorMap: () => ({ message: 'Select a reason for this stock change' }) });
const idempotencyKey = z.string().trim().min(8).max(100).optional();
const adjustment = z.object({
  quantity: z.number().int().min(-2147483647).max(2147483647),
  type: reason,
  notes: z.string().max(2000).optional(),
  expectedVersion: z.number().int().min(0).optional(),
  idempotencyKey,
}).refine(body => body.type !== 'OTHER' || !!body.notes?.trim(), { message: 'Describe the reason when choosing Other', path: ['notes'] });

const sourceKey = (key: string, productId: string) => `adjustment:${key}:${productId}`;

export const adjustInventory = asyncHandler(async (req: AuthRequest, res: Response) => {
  const body = adjustment.parse(req.body);
  const locationId = resolveWriteLocation(req);
  const product = await prisma.$transaction(async tx => {
    if (body.idempotencyKey) {
      await lockInventory(tx, [req.params.id]);
      // A retried request returns the recorded result instead of adjusting twice.
      const recorded = await tx.inventoryValueEntry.findUnique({ where: { sourceKey: sourceKey(body.idempotencyKey, req.params.id) } });
      if (recorded) {
        if (recorded.productId !== req.params.id || recorded.locationId !== locationId) throw new AppError('This retry key belongs to another adjustment', 409);
        return { ...(await tx.product.findUniqueOrThrow({ where: { id: req.params.id } })), replayed: true };
      }
    }
    return moveInventory(tx, {
      productId: req.params.id, locationId, userId: req.user!.id,
      type: body.type, costKind: costKindForReason(body.type, body.quantity, 'ADJUSTMENT'),
      quantity: body.quantity, notes: body.notes, expectedVersion: body.expectedVersion,
      ...(body.idempotencyKey ? { sourceId: body.idempotencyKey, sourceKey: sourceKey(body.idempotencyKey, req.params.id) } : {}),
    });
  });
  res.json({ success: true, data: product, message: 'Inventory adjusted successfully' });
});

const bulkBody = z.object({
  updates: z.array(z.object({
    productId: z.string().min(1),
    quantity: z.number().int().min(-2147483647).max(2147483647),
    // 'set' replaces the quantity; anything else adds the delta (legacy field name).
    type: z.string().max(50).optional(),
    notes: z.string().max(2000).optional(),
    expectedVersion: z.number().int().min(0).optional(),
  })).min(1).max(1000),
  reason,
  notes: z.string().max(2000).optional(),
}).refine(body => body.reason !== 'OTHER' || !!body.notes?.trim(), { message: 'Describe the reason when choosing Other', path: ['notes'] });

export const bulkUpdateStock = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { updates, reason: bulkReason, notes } = bulkBody.parse(req.body);
  if (new Set(updates.map(i => i.productId)).size !== updates.length) throw new AppError('Duplicate product in stock update', 400);
  const locationId = resolveWriteLocation(req);
  const products = await prisma.$transaction(async tx => {
    await lockInventory(tx, updates.map(i => i.productId));
    const result = [];
    for (const item of [...updates].sort((a, b) => a.productId.localeCompare(b.productId))) {
      if (item.type === 'set' && item.expectedVersion === undefined) throw new AppError('Refresh product stock before setting an absolute quantity', 409);
      const current = await tx.product.findUnique({ where: { id: item.productId }, select: { stockQuantity: true } });
      const change = item.type === 'set' ? item.quantity - (current?.stockQuantity ?? 0) : item.quantity;
      result.push(await moveInventory(tx, { productId: item.productId, locationId, userId: req.user!.id, type: bulkReason, costKind: costKindForReason(bulkReason, change, 'ADJUSTMENT'),
        quantity: item.type === 'set' ? undefined : item.quantity, setQuantity: item.type === 'set' ? item.quantity : undefined,
        expectedVersion: item.type === 'set' ? item.expectedVersion : undefined, notes: item.notes || notes || 'Bulk stock adjustment' }));
    }
    return result;
  });
  res.json({ success: true, data: { updatedCount: products.length, products }, message: products.length + ' products updated' });
});
