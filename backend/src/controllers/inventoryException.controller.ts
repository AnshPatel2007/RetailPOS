import { Response } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import { asyncHandler, AppError } from '../utils/errorHandler';
import { assertOwnsRecord, resolveWriteLocation } from '../utils/locationFilter.util';
import { lockInventory, moveInventory } from '../services/inventory.service';
import { exceptionDetail, RESOLUTION_REASONS, resolveException } from '../services/inventoryException.service';

/** Store scope for reads: a store user sees their store; a platform admin may pick one. */
function readLocation(req: AuthRequest): string | null {
  if (req.user!.role === 'SUPER_ADMIN') return typeof req.query.locationId === 'string' && req.query.locationId ? req.query.locationId : null;
  return req.user!.locationId!;
}

const listQuery = z.object({
  status: z.enum(['open', 'resolved', 'all']).default('open'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const listExceptions = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { status, page, limit } = listQuery.parse(req.query);
  const locationId = readLocation(req);
  const where = {
    ...(locationId ? { locationId } : {}),
    ...(status === 'open' ? { status: { in: ['OPEN', 'RECOUNT_REQUESTED'] } } : status === 'resolved' ? { status: 'RESOLVED' } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.inventoryException.count({ where }),
    prisma.inventoryException.findMany({ where, orderBy: [{ status: 'asc' }, { lastNegativeAt: 'desc' }], skip: (page - 1) * limit, take: limit,
      include: { product: { select: { id: true, name: true, sku: true, barcode: true, stockQuantity: true, brand: true, variant: true, size: true } } } }),
  ]);
  res.json({ success: true, data: rows.map(row => ({ ...row, currentQuantity: row.product.stockQuantity })),
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } });
});

export const exceptionSummary = asyncHandler(async (req: AuthRequest, res: Response) => {
  const locationId = readLocation(req);
  const scope = locationId ? { locationId } : {};
  const [open, recountRequested] = await Promise.all([
    prisma.inventoryException.count({ where: { ...scope, status: 'OPEN' } }),
    prisma.inventoryException.count({ where: { ...scope, status: 'RECOUNT_REQUESTED' } }),
  ]);
  res.json({ success: true, data: { open, recountRequested, unresolved: open + recountRequested } });
});

export const getException = asyncHandler(async (req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await exceptionDetail(prisma, req.params.id, readLocation(req)) });
});

export const requestRecount = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { assignedToId } = z.object({ assignedToId: z.string().uuid().optional().nullable() }).parse(req.body ?? {});
  const locationId = resolveWriteLocation(req);
  const exception = await prisma.inventoryException.findUnique({ where: { id: req.params.id } });
  if (!exception || exception.locationId !== locationId) throw new AppError('Inventory exception not found', 404);
  if (exception.status === 'RESOLVED') throw new AppError('This exception is already resolved', 409);
  if (assignedToId && !await prisma.user.findFirst({ where: { id: assignedToId, locationId, isActive: true } })) throw new AppError('Assign the recount to an active employee at this store', 400);
  const updated = await prisma.inventoryException.update({ where: { id: exception.id }, data: {
    status: 'RECOUNT_REQUESTED', recountRequestedAt: new Date(), recountRequestedById: req.user!.id, assignedToId: assignedToId ?? null } });
  res.json({ success: true, data: updated, message: 'Recount requested' });
});

const countBody = z.object({
  countedQuantity: z.number().int().min(0).max(2147483647),
  resolution: z.enum(RESOLUTION_REASONS),
  notes: z.string().trim().max(2000).optional(),
  expectedVersion: z.number().int().min(0),
  idempotencyKey: z.string().trim().min(8).max(100),
}).refine(body => body.resolution !== 'OTHER' || !!body.notes, { message: 'Describe the resolution when choosing Other', path: ['notes'] });

/** Record a physical count: posts the adjustment (with its reason) and resolves the exception atomically. */
export const recordCount = asyncHandler(async (req: AuthRequest, res: Response) => {
  const body = countBody.parse(req.body);
  const locationId = resolveWriteLocation(req);
  const result = await prisma.$transaction(async tx => {
    const exception = await tx.inventoryException.findUnique({ where: { id: req.params.id } });
    if (!exception || exception.locationId !== locationId) throw new AppError('Inventory exception not found', 404);
    await lockInventory(tx, [exception.productId]);
    const key = `exception-count:${body.idempotencyKey}:${exception.productId}`;
    const recorded = await tx.inventoryValueEntry.findUnique({ where: { sourceKey: key } });
    if (recorded) return { exception: await tx.inventoryException.findUniqueOrThrow({ where: { id: exception.id } }), replayed: true };
    if (exception.status === 'RESOLVED') throw new AppError('This exception is already resolved', 409);
    const product = await tx.product.findUniqueOrThrow({ where: { id: exception.productId } });
    let adjustmentEntryId: string | null = null;
    if (product.stockQuantity !== body.countedQuantity) {
      const moved = await moveInventory(tx, { productId: product.id, locationId, userId: req.user!.id, type: 'EXCEPTION_COUNT', costKind: 'COUNT',
        sourceId: exception.id, sourceKey: key, setQuantity: body.countedQuantity, expectedVersion: body.expectedVersion,
        notes: `Exception count (${body.resolution})${body.notes ? ': ' + body.notes : ''}` });
      adjustmentEntryId = moved.inventoryEntry.id;
    } else if (product.stockVersion !== body.expectedVersion) {
      throw new AppError(`Stock changed for ${product.name}. Refresh and recount this item.`, 409);
    }
    const resolved = await resolveException(tx, { id: exception.id, locationId, userId: req.user!.id, resolution: body.resolution,
      notes: body.notes, countedQuantity: body.countedQuantity, adjustmentEntryId });
    return { exception: resolved, replayed: false };
  });
  res.json({ success: true, data: result.exception, replayed: result.replayed, message: 'Count recorded and exception resolved' });
});

const resolveBody = z.object({ resolution: z.enum(RESOLUTION_REASONS), notes: z.string().trim().max(2000).optional() });
export const resolve = asyncHandler(async (req: AuthRequest, res: Response) => {
  const body = resolveBody.parse(req.body);
  const locationId = resolveWriteLocation(req);
  const resolved = await prisma.$transaction(tx => resolveException(tx, { id: req.params.id, locationId, userId: req.user!.id, resolution: body.resolution, notes: body.notes }));
  res.json({ success: true, data: resolved, message: 'Exception resolved' });
});

const correctionBody = z.object({
  toProductId: z.string().uuid(),
  quantity: z.number().int().min(1),
  reason: z.string().trim().min(3).max(500),
  idempotencyKey: z.string().trim().min(8).max(100),
});

/**
 * Wrong-SKU correction: the cashier rang up product A but the customer bought B.
 * The sale, its receipt and revenue stay exactly as recorded. Stock and cost move:
 * A gets the units back at the original line's cost, B is depleted at its own
 * average (or provisional) cost. The COGS difference lands in the current period.
 */
export const correctSaleItemProduct = asyncHandler(async (req: AuthRequest, res: Response) => {
  const body = correctionBody.parse(req.body);
  const locationId = resolveWriteLocation(req);
  const correction = await prisma.$transaction(async tx => {
    const previous = await tx.saleItemCorrection.findUnique({ where: { idempotencyKey: body.idempotencyKey } });
    if (previous) {
      if (previous.saleItemId !== req.params.itemId || previous.toProductId !== body.toProductId || previous.quantity !== body.quantity) throw new AppError('This retry key belongs to a different correction', 409);
      return previous;
    }
    const sale = await tx.sale.findUnique({ where: { id: req.params.id }, include: { items: true, refunds: { include: { items: true } } } });
    if (!sale) throw new AppError('Sale not found', 404);
    assertOwnsRecord(req, sale.locationId);
    if (sale.locationId !== locationId) throw new AppError('Sale not found', 404);
    if (sale.status !== 'COMPLETED') throw new AppError('Only completed sales can be corrected', 400);
    const line = sale.items.find(item => item.id === req.params.itemId);
    if (!line) throw new AppError('Sale line not found', 404);
    if (line.sellingUnitId) throw new AppError('Package lines cannot be corrected here yet', 400);
    if (body.toProductId === line.productId) throw new AppError('Choose the product the customer actually bought', 400);
    const refunded = sale.refunds.flatMap(refund => refund.items).filter(item => item.saleItemId === line.id).reduce((sum, item) => sum + item.quantity, 0);
    const corrected = (await tx.saleItemCorrection.aggregate({ where: { saleItemId: line.id }, _sum: { quantity: true } }))._sum.quantity || 0;
    if (refunded) throw new AppError('This line has refunds; correct stock with a count instead', 409);
    if (body.quantity + corrected > line.quantity) throw new AppError(`Only ${line.quantity - corrected} unit(s) on this line can still be corrected`, 400);
    await lockInventory(tx, [line.productId, body.toProductId]);
    const [from, to] = await Promise.all([tx.product.findUnique({ where: { id: line.productId } }), tx.product.findUnique({ where: { id: body.toProductId } })]);
    if (!from || !to || to.locationId !== sale.locationId || from.locationId !== sale.locationId) throw new AppError('Both products must belong to this store', 400);
    if (!from.trackInventory || !to.trackInventory) throw new AppError('Both products must track inventory', 400);
    const id = randomUUID();
    const notes = `Sale ${sale.saleNumber}: ${from.name} corrected to ${to.name}. ${body.reason}`;
    const reverse = await moveInventory(tx, { productId: from.id, locationId: sale.locationId!, userId: req.user!.id, type: 'SKU_CORRECTION',
      sourceId: id, sourceKey: `sku-correction:${id}:from`, quantity: body.quantity,
      valueMode: line.inventoryEntryId ? 'REFERENCE' : 'FIXED', referenceEntryId: line.inventoryEntryId,
      referenceQuantity: body.quantity, referenceOffset: corrected,
      valueInput: line.inventoryEntryId ? undefined : line.unitCost === null ? null : line.unitCost.mul(body.quantity), notes });
    const apply = await moveInventory(tx, { productId: to.id, locationId: sale.locationId!, userId: req.user!.id, type: 'SKU_CORRECTION',
      sourceId: id, sourceKey: `sku-correction:${id}:to`, quantity: -body.quantity, notes, allowNegative: true });
    return tx.saleItemCorrection.create({ data: { id, saleId: sale.id, saleItemId: line.id, locationId: sale.locationId!, fromProductId: from.id,
      toProductId: to.id, quantity: body.quantity, reason: body.reason, userId: req.user!.id,
      reverseEntryId: reverse.inventoryEntry.id, applyEntryId: apply.inventoryEntry.id, idempotencyKey: body.idempotencyKey } });
  });
  res.json({ success: true, data: correction, message: 'Sale line product corrected; the receipt is unchanged' });
});
