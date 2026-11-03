import { Response } from 'express';
import { nextDocumentNumber } from '../services/documentNumber.service';
import { z } from 'zod';
import { asyncHandler, AppError } from '../utils/errorHandler';
import { AuthRequest } from '../types';
import prisma from '../config/database';
import { assertOwnsOneOfLocations, isSuperAdmin } from '../utils/locationFilter.util';

const include = { items: { include: { product: { select: { id: true, name: true, sku: true } }, destinationProduct: { select: { id: true, name: true, sku: true } } } } };
const ownStore = (req: AuthRequest) => {
  const id = isSuperAdmin(req) ? (req.query.locationId as string || req.user?.locationId) : req.user?.locationId;
  if (!id) throw new AppError('Select a store or sign in with a store account', 400);
  return id;
};
const connectionKey = (a: string, b: string) => { const [locationAId, locationBId] = [a, b].sort(); return { locationAId, locationBId }; };
const requireConnection = async (db: any, a: string, b: string) => {
  const connected = await db.storeConnection.findUnique({ where: { locationAId_locationBId: connectionKey(a,b) } });
  if (!connected) throw new AppError('These stores are not connected for inventory transfers. Ask a super-admin to link them.', 403);
};
const attachNames = async (transfers: any[]) => {
  const ids = [...new Set(transfers.flatMap(t => [t.fromLocationId, t.toLocationId]))];
  const locations = await prisma.location.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  return transfers.map(t => ({ ...t, fromLocation: locations.find(l => l.id === t.fromLocationId), toLocation: locations.find(l => l.id === t.toLocationId) }));
};

export const getTransferOptions = asyncHandler(async (req: AuthRequest, res: Response) => {
  const id = ownStore(req);
  const connections = await prisma.storeConnection.findMany({ where: { OR: [{ locationAId: id }, { locationBId: id }] } });
  const ids = connections.map(c => c.locationAId === id ? c.locationBId : c.locationAId);
  const locations = await prisma.location.findMany({ where: { id: { in: [id,...ids] }, isActive: true }, select: { id: true, name: true } });
  res.json({ success: true, data: { source: locations.find(l => l.id === id), destinations: locations.filter(l => l.id !== id) } });
});

export const getConnections = asyncHandler(async (_req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await prisma.storeConnection.findMany({ include: { locationA: { select: { id: true, name: true } }, locationB: { select: { id: true, name: true } } } }) });
});
export const createConnection = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { fromLocationId, toLocationId } = z.object({ fromLocationId: z.string().min(1), toLocationId: z.string().min(1) }).parse(req.body);
  if (fromLocationId === toLocationId) throw new AppError('Select two different stores', 400);
  const count = await prisma.location.count({ where: { id: { in: [fromLocationId,toLocationId] }, isActive: true } });
  if (count !== 2) throw new AppError('Both stores must be active', 400);
  const key = connectionKey(fromLocationId,toLocationId);
  const connection = await prisma.storeConnection.upsert({ where: { locationAId_locationBId: key }, create: { ...key, createdBy: req.user!.id }, update: {} });
  res.status(201).json({ success: true, data: connection });
});
export const deleteConnection = asyncHandler(async (req: AuthRequest, res: Response) => {
  await prisma.storeConnection.deleteMany({ where: { id: req.params.id } });
  res.json({ success: true });
});

export const getTransfers = asyncHandler(async (req: AuthRequest, res: Response) => {
  const page = Math.max(1, parseInt(String(req.query.page)) || 1), limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit)) || 20));
  const scope = isSuperAdmin(req) ? req.query.locationId as string : ownStore(req);
  const where = { ...(req.query.status ? { status: String(req.query.status) } : {}), ...(scope ? { OR: [{ fromLocationId: scope }, { toLocationId: scope }] } : {}) };
  const [transfers, total] = await Promise.all([prisma.inventoryTransfer.findMany({ where, include, orderBy: { createdAt: 'desc' }, skip: (page-1)*limit, take: limit }), prisma.inventoryTransfer.count({ where })]);
  res.json({ success: true, data: await attachNames(transfers), total });
});
export const getTransfer = asyncHandler(async (req: AuthRequest, res: Response) => {
  const transfer = await prisma.inventoryTransfer.findUnique({ where: { id: req.params.id }, include });
  if (!transfer) throw new AppError('Transfer not found', 404);
  assertOwnsOneOfLocations(req,[transfer.fromLocationId, transfer.toLocationId]);
  res.json({ success: true, data: (await attachNames([transfer]))[0] });
});
export const createTransfer = asyncHandler(async (req: AuthRequest, res: Response) => {
  const body = z.object({ fromLocationId: z.string().min(1).optional(), toLocationId: z.string().min(1), notes: z.string().max(2000).optional(), items: z.array(z.object({ productId: z.string().min(1), quantity: z.number().int().positive() })).min(1).max(100) }).parse(req.body);
  const fromLocationId = isSuperAdmin(req) ? body.fromLocationId : ownStore(req);
  if (!fromLocationId || (body.fromLocationId && body.fromLocationId !== fromLocationId)) throw new AppError('Transfers must start from your current store', 403);
  if (fromLocationId === body.toLocationId) throw new AppError('Source and destination must differ', 400);
  const ids = body.items.map(i => i.productId);
  if (new Set(ids).size !== ids.length) throw new AppError('Add each product only once', 400);
  await requireConnection(prisma, fromLocationId, body.toLocationId);
  const locations = await prisma.location.count({ where: { id: { in: [fromLocationId,body.toLocationId] }, isActive: true } });
  if (locations !== 2) throw new AppError('Both stores must be active',400);
  const products = await prisma.product.findMany({ where: { id: { in: ids }, locationId: fromLocationId, isActive: true, trackInventory: true, sku: { not: 'MISC-001' } } });
  for (const item of body.items) {
    const product = products.find(p => p.id === item.productId);
    if (!product || item.quantity > product.stockQuantity) throw new AppError('Insufficient source stock for ' + (product?.name || item.productId),400);
  }
  const transfer = await prisma.inventoryTransfer.create({ data: { fromLocationId, toLocationId: body.toLocationId, transferNumber: await nextDocumentNumber('TRF'), createdBy: req.user!.id, notes: body.notes, items: { create: body.items } }, include });
  res.status(201).json({ success: true, data: transfer });
});
export { shipTransfer, receiveTransfer, cancelTransfer, receiveTransferReturn, requestTransferReturn, getTransferMappingOptions, getTransferReceipts } from './transferWorkflow.controller';
