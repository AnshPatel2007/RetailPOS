import { Response } from 'express';
import { z } from 'zod';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import { asyncHandler, AppError } from '../utils/errorHandler';
import { assertOwnsRecord, resolveWriteLocation } from '../utils/locationFilter.util';
import { lockInventory, moveInventory } from '../services/inventory.service';
import { exceptionDetail, RESOLUTION_REASONS, resolveException } from '../services/inventoryException.service';
import { costKindForReason } from '../services/stockReasons';
import { correctSaleLine, listCorrections, listUnmatched, matchUnmatchedCost, previewResolution, reclassStock, RECLASS_REASONS } from '../services/stockCorrection.service';

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
      // Why it was short decides the cost treatment (acquisition, unrecorded sale, loss or count).
      const costKind = costKindForReason(body.resolution, body.countedQuantity - product.stockQuantity, 'COUNT');
      const moved = await moveInventory(tx, { productId: product.id, locationId, userId: req.user!.id, type: 'EXCEPTION_COUNT', costKind,
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

/** Wrong product on a known sale line (see correctSaleLine). The receipt is unchanged. */
export const correctSaleItemProduct = asyncHandler(async (req: AuthRequest, res: Response) => {
  const body = correctionBody.parse(req.body);
  const locationId = resolveWriteLocation(req);
  const sale = await prisma.sale.findUnique({ where: { id: req.params.id }, select: { locationId: true } });
  if (!sale) throw new AppError('Sale not found', 404);
  assertOwnsRecord(req, sale.locationId);
  const { correction } = await prisma.$transaction(tx => correctSaleLine(tx, { locationId, userId: req.user!.id, saleId: req.params.id,
    saleItemId: req.params.itemId, actualProductId: body.toProductId, quantity: body.quantity, reason: body.reason, idempotencyKey: body.idempotencyKey }));
  res.json({ success: true, data: correction, message: 'Sale line product corrected; the receipt is unchanged' });
});

const reclassBody = z.object({
  fromProductId: z.string().uuid(),
  quantity: z.number().int().min(1).max(100000),
  reason: z.enum(RECLASS_REASONS),
  saleItemId: z.string().uuid().optional(),
  notes: z.string().trim().max(2000).optional(),
  idempotencyKey: z.string().trim().min(8).max(100),
});

/**
 * Another product left (or arrived) instead of the exception's product. Moves the
 * units from that product to this one; with a sale line, it is attributed to it.
 */
export const reclass = asyncHandler(async (req: AuthRequest, res: Response) => {
  const body = reclassBody.parse(req.body);
  const locationId = resolveWriteLocation(req);
  const result = await prisma.$transaction(async tx => {
    const exception = await tx.inventoryException.findUnique({ where: { id: req.params.id } });
    if (!exception || exception.locationId !== locationId) throw new AppError('Inventory exception not found', 404);
    if (body.saleItemId) {
      if (body.reason !== 'SOLD_AS_OTHER') throw new AppError('Only a sold item can be attributed to a sale line', 400);
      const line = await tx.saleItem.findUnique({ where: { id: body.saleItemId } });
      if (!line || line.productId !== exception.productId) throw new AppError('Choose a sale line for this product', 400);
      return correctSaleLine(tx, { locationId, userId: req.user!.id, saleId: line.saleId, saleItemId: line.id, actualProductId: body.fromProductId,
        quantity: body.quantity, reason: body.notes || 'Corrected from inventory exception', idempotencyKey: body.idempotencyKey, exceptionId: exception.id });
    }
    return reclassStock(tx, { locationId, userId: req.user!.id, fromProductId: body.fromProductId, toProductId: exception.productId,
      quantity: body.quantity, reason: body.reason, exceptionId: exception.id, notes: body.notes, idempotencyKey: body.idempotencyKey });
  });
  res.json({ success: true, data: result, message: 'Stock moved between products; sale amounts are unchanged' });
});

const previewBody = z.discriminatedUnion('action', [
  z.object({ action: z.literal('count'), countedQuantity: z.number().int().min(0).max(2147483647), resolution: z.enum(RESOLUTION_REASONS) }),
  z.object({ action: z.literal('reclass'), fromProductId: z.string().uuid(), quantity: z.number().int().min(1).max(100000) }),
]);

/** Shows the stock and cost-of-goods effect of a resolution before it is saved. */
export const preview = asyncHandler(async (req: AuthRequest, res: Response) => {
  const body = previewBody.parse(req.body);
  const locationId = resolveWriteLocation(req);
  const exception = await prisma.inventoryException.findUnique({ where: { id: req.params.id } });
  if (!exception || exception.locationId !== locationId) throw new AppError('Inventory exception not found', 404);
  const data = await prisma.$transaction(tx => previewResolution(tx, { ...body, productId: exception.productId, locationId, userId: req.user!.id }),
    { isolationLevel: 'RepeatableRead' });
  res.json({ success: true, data });
});

export const listUnmatchedAdditions = asyncHandler(async (req: AuthRequest, res: Response) => {
  const status = z.enum(['open', 'matched', 'all']).default('open').parse(req.query.status);
  res.json({ success: true, data: await listUnmatched(prisma, readLocation(req), status) });
});

const matchBody = z.object({ actualUnitCost: z.number().min(0).max(1_000_000), notes: z.string().trim().max(2000).optional() });
export const matchUnmatchedAddition = asyncHandler(async (req: AuthRequest, res: Response) => {
  const body = matchBody.parse(req.body);
  const locationId = resolveWriteLocation(req);
  const result = await prisma.$transaction(tx => matchUnmatchedCost(tx, { entryId: req.params.entryId, locationId, userId: req.user!.id,
    actualUnitCost: body.actualUnitCost, notes: body.notes }));
  res.json({ success: true, data: result.match, replayed: result.replayed, message: 'Supplier cost recorded' });
});

export const listStockCorrections = asyncHandler(async (req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await listCorrections(prisma, readLocation(req)) });
});
