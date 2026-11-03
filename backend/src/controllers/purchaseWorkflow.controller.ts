import { Response } from 'express';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import { asyncHandler, AppError } from '../utils/errorHandler';
import { lockPurchaseOrder, receiveOrder } from '../services/purchaseReceiving.service';
import { updatePurchaseOrderSchema } from '../validators/supplier.validator';

export const receivePurchaseOrder = asyncHandler(async (req: AuthRequest, res: Response) => {
  const data = await prisma.$transaction(tx => receiveOrder(tx, req), { timeout: 30_000 });
  res.json({ success: true, data, message: data.replayed ? 'Receipt already recorded' : data.status === 'RECEIVED' ? 'Delivery recorded and order closed' : 'Partial delivery recorded; order remains open' });
});

export const updatePurchaseOrder = asyncHandler(async (req: AuthRequest, res: Response) => {
  const body = updatePurchaseOrderSchema.parse({ body: req.body }).body;
  const order = await prisma.$transaction(async tx => {
    const existing = await lockPurchaseOrder(tx, req);
    if (existing.status !== 'PENDING') throw new AppError('Can only update pending orders', 400);
    const patch: { notes?: string | null; expectedAt?: Date | null; totalAmount?: number } = {};
    if (body.notes !== undefined) patch.notes = body.notes;
    if (body.expectedAt !== undefined) {
      patch.expectedAt = body.expectedAt ? new Date(body.expectedAt) : null;
      if (patch.expectedAt && isNaN(patch.expectedAt.getTime())) throw new AppError('Invalid expected delivery date', 400);
    }
    if (body.items) {
      if (!body.items.length) throw new AppError('An order must contain at least one item', 400);
      const ids = body.items.map(i => i.productId);
      if (new Set(ids).size !== ids.length) throw new AppError('Combine duplicate products into one order line', 400);
      const products = await tx.product.findMany({ where: { id: { in: ids }, locationId: existing.locationId, isActive: true, sku: { not: 'MISC-001' } } });
      const productMap = new Map(products.map(p => [p.id, p]));
      if (ids.some(id => !productMap.has(id))) throw new AppError('An ordered product is unavailable at this store', 404);
      const items = body.items.map(item => ({ purchaseOrderId: existing.id, productId: item.productId,
        sku: productMap.get(item.productId)!.sku, productName: productMap.get(item.productId)!.name,
        quantity: item.quantity, cost: item.cost, total: Math.round(item.cost * item.quantity * 100) / 100 }));
      // Validation, replacement and totals all commit together.
      await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: existing.id } });
      await tx.purchaseOrderItem.createMany({ data: items });
      patch.totalAmount = Math.round(items.reduce((sum, item) => sum + item.total, 0) * 100) / 100;
    }
    return tx.purchaseOrder.update({ where: { id: existing.id }, data: patch, include: { supplier: true, items: true } });
  });
  res.json({ success: true, data: order, message: 'Purchase order updated successfully' });
});

export const updateStatus = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { status } = req.body;
  if (!['PENDING', 'ORDERED', 'CANCELLED'].includes(status)) {
    throw new AppError(status === 'RECEIVED' ? 'Record received quantities through Receive Delivery before closing an order' : 'Invalid status', 400);
  }
  const order = await prisma.$transaction(async tx => {
    const existing = await lockPurchaseOrder(tx, req);
    if (status === existing.status) return existing;
    const allowed = existing.status === 'PENDING' ? ['ORDERED', 'CANCELLED'] : existing.status === 'ORDERED' ? ['CANCELLED'] : [];
    if (!allowed.includes(status)) throw new AppError('This order cannot make that status transition', 409);
    return tx.purchaseOrder.update({ where: { id: existing.id }, data: { status, ...(status === 'ORDERED' ? { orderedAt: new Date() } : {}) }, include: { supplier: true } });
  });
  res.json({ success: true, data: order, message: 'Purchase order status updated' });
});

export const cancelPurchaseOrder = asyncHandler(async (req: AuthRequest, res: Response) => {
  const order = await prisma.$transaction(async tx => {
    const existing = await lockPurchaseOrder(tx, req);
    if (existing.status === 'RECEIVED') throw new AppError('Cannot cancel a received order', 400);
    if (existing.status === 'CANCELLED') throw new AppError('Order is already cancelled', 400);
    if (existing.status === 'PARTIALLY_RECEIVED') throw new AppError('Record a final delivery with a reason to close the remaining quantity', 409);
    if (!['PENDING', 'ORDERED'].includes(existing.status)) throw new AppError('Order cannot be cancelled', 409);
    const reason = typeof req.body.reason === 'string' ? req.body.reason.trim().slice(0, 2000) : '';
    return tx.purchaseOrder.update({ where: { id: existing.id }, data: { status: 'CANCELLED', notes: reason ? (existing.notes || '') + '\nCancelled: ' + reason : existing.notes } });
  });
  res.json({ success: true, data: order, message: 'Purchase order cancelled' });
});

export const deletePurchaseOrder = asyncHandler(async (req: AuthRequest, res: Response) => {
  await prisma.$transaction(async tx => {
    const existing = await lockPurchaseOrder(tx, req);
    if (existing.status === 'RECEIVED') throw new AppError('Cannot delete a received order', 400);
    if (!['PENDING', 'CANCELLED'].includes(existing.status) || await tx.purchaseReceipt.count({ where: { purchaseOrderId: existing.id } })) throw new AppError('Order history cannot be deleted after ordering or receiving', 409);
    await tx.purchaseOrder.delete({ where: { id: existing.id } });
  });
  res.json({ success: true, message: 'Purchase order deleted' });
});
