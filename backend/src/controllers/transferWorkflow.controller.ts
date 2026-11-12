import { Response } from 'express';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import { asyncHandler, AppError } from '../utils/errorHandler';
import { assertOwnsOneOfLocations } from '../utils/locationFilter.util';
import { storesConnected } from '../services/organization.service';
import { lockInventory, moveInventory } from '../services/inventory.service';
import { exactProductMatch, lockTransfer, recordTransferReceipt, requireTransferStore, shipmentProduct, snapshotProduct, TransferReceiptKind } from '../services/transferWorkflow.service';

export const shipTransfer = asyncHandler(async (req: AuthRequest, res: Response) => {
  await prisma.$transaction(async tx => {
    const transfer = await lockTransfer(tx, req.params.id);
    requireTransferStore(req, transfer.fromLocationId, 'Only the source store can ship this transfer');
    if (transfer.status !== 'PENDING') throw new AppError('Only pending transfers can be shipped', 400);
    if (!await storesConnected(transfer.fromLocationId, transfer.toLocationId, tx)) throw new AppError('These stores are no longer connected for new shipments', 403);
    if (await tx.location.count({ where: { id: { in: [transfer.fromLocationId, transfer.toLocationId] }, isActive: true } }) !== 2) throw new AppError('Both stores must be active before shipping', 400);
    await lockInventory(tx, transfer.items.map(item => item.productId));
    for (const item of [...transfer.items].sort((a, b) => a.productId.localeCompare(b.productId))) {
      const product = await tx.product.findUnique({ where: { id: item.productId } });
      if (!product || product.locationId !== transfer.fromLocationId || !product.isActive || !product.trackInventory || product.sku === 'MISC-001') throw new AppError('A source product is unavailable for shipping', 409);
      const moved = await moveInventory(tx, { productId: product.id, locationId: transfer.fromLocationId, userId: req.user!.id, type: 'TRANSFER_OUT', sourceId: transfer.id,
        sourceKey: 'transfer-dispatch:' + item.id, quantity: -item.quantity, notes: transfer.transferNumber });
      await tx.transferItem.update({ where: { id: item.id }, data: { productSnapshot: snapshotProduct(product), inventoryEntryId: moved.inventoryEntry.id,
        dispatchedValue: moved.inventoryEntry.valueChange?.negated() ?? null } });
    }
    await tx.inventoryTransfer.update({ where: { id: transfer.id }, data: { status: 'IN_TRANSIT', shippedAt: new Date() } });
    await tx.activityLog.create({ data: { userId: req.user!.id, locationId: transfer.fromLocationId, action: 'TRANSFER_SHIPPED', entity: 'InventoryTransfer', entityId: transfer.id } });
  }, { timeout: 30_000 });
  res.json({ success: true, message: 'Transfer shipped' });
});

const receiptAction = (kind: TransferReceiptKind) => asyncHandler(async (req: AuthRequest, res: Response) => {
  const data = await prisma.$transaction(tx => recordTransferReceipt(tx, req, kind), { timeout: 30_000 });
  res.json({ success: true, data, message: data.replayed ? 'This transfer event was already recorded' : 'Transfer event recorded' });
});
export const receiveTransfer = receiptAction('RECEIVE');
export const receiveTransferReturn = receiptAction('SOURCE_RETURN');
export const requestTransferReturn = receiptAction('REQUEST_RETURN');

export const cancelTransfer = asyncHandler(async (req: AuthRequest, res: Response) => {
  await prisma.$transaction(async tx => {
    const transfer = await lockTransfer(tx, req.params.id);
    requireTransferStore(req, transfer.fromLocationId, 'Only the source store can cancel a draft');
    if (transfer.status !== 'PENDING' || transfer.shippedAt) throw new AppError('Shipped stock cannot be cancelled. Request a return, then record the goods when they physically arrive back.', 409);
    await tx.inventoryTransfer.update({ where: { id: transfer.id }, data: { status: 'CANCELLED' } });
    await tx.activityLog.create({ data: { userId: req.user!.id, locationId: transfer.fromLocationId, action: 'TRANSFER_CANCELLED', entity: 'InventoryTransfer', entityId: transfer.id } });
  });
  res.json({ success: true, message: 'Draft transfer cancelled' });
});

export const getTransferMappingOptions = asyncHandler(async (req: AuthRequest, res: Response) => {
  const transfer = await prisma.inventoryTransfer.findUnique({ where: { id: req.params.id }, include: { items: { include: { product: true } } } });
  if (!transfer) throw new AppError('Transfer not found', 404);
  requireTransferStore(req, transfer.toLocationId, 'Only the destination store can choose its products');
  const snapshots = transfer.items.map(shipmentProduct);
  const products = await prisma.product.findMany({ where: { locationId: transfer.toLocationId, OR: [
    { id: { in: transfer.items.flatMap(item => item.destinationProductId ? [item.destinationProductId] : []) } },
    { sku: { in: snapshots.map(p => p.sku) } },
    { barcode: { in: snapshots.flatMap(p => p.barcode ? [p.barcode] : []) } },
  ] } });
  res.json({ success: true, data: transfer.items.map(item => {
    const snapshot = shipmentProduct(item);
    const candidates = products.filter(p => p.id === item.destinationProductId || p.sku === snapshot.sku || (!!snapshot.barcode && p.barcode === snapshot.barcode));
    const exact = candidates.find(p => exactProductMatch(p, snapshot));
    return { transferItemId: item.id, automaticProductId: item.destinationProductId || (item.productSnapshot && exact ? exact.id : null),
      candidates: candidates.map(p => ({ id: p.id, name: p.name, sku: p.sku, barcode: p.barcode, usable: p.trackInventory && p.isActive })) };
  }) });
});

export const getTransferReceipts = asyncHandler(async (req: AuthRequest, res: Response) => {
  const transfer = await prisma.inventoryTransfer.findUnique({ where: { id: req.params.id }, select: { fromLocationId: true, toLocationId: true } });
  if (!transfer) throw new AppError('Transfer not found', 404);
  assertOwnsOneOfLocations(req, [transfer.fromLocationId, transfer.toLocationId]);
  const page = Math.max(1, parseInt(String(req.query.page)) || 1), limit = 20;
  const where = { transferId: req.params.id };
  const [data, total] = await Promise.all([
    prisma.transferReceipt.findMany({ where, include: { items: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * limit, take: limit }),
    prisma.transferReceipt.count({ where }),
  ]);
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(data.map(receipt => receipt.userId))] } }, select: { id: true, firstName: true, lastName: true } });
  res.json({ success: true, data: data.map(receipt => { const actor = users.find(user => user.id === receipt.userId); return { ...receipt, actor: actor ? actor.firstName + ' ' + actor.lastName : 'Former staff member' }; }), pagination: { page, total, totalPages: Math.ceil(total / limit) } });
});
