import { Prisma, Product, TransferItem } from '@prisma/client';
import { createHash } from 'crypto';
import { z } from 'zod';
import { AuthRequest } from '../types';
import { AppError } from '../utils/errorHandler';
import { lockInventory, moveInventory } from './inventory.service';

const quantity = z.number().int().min(0).max(2147483647).default(0);
const receiptSchema = z.object({
  idempotencyKey: z.string().uuid(), notes: z.string().trim().max(2000).default(''),
  items: z.array(z.object({
    transferItemId: z.string().min(1), acceptedQty: quantity, damagedQty: quantity,
    missingQty: quantity, sentBackQty: quantity,
    destinationProductId: z.string().min(1).optional(), createProduct: z.boolean().default(false),
    newSku: z.string().trim().min(1).max(100).optional(),
  })).max(100).default([]),
});
export type TransferReceiptKind = 'RECEIVE' | 'SOURCE_RETURN' | 'REQUEST_RETURN';
export const outstanding = (item: TransferItem) => item.quantity - item.receivedQty - item.damagedQty - item.missingQty - item.sentBackQty;
export const returning = (item: TransferItem) => item.sentBackQty - item.returnedQty - item.returnDamagedQty - item.returnMissingQty;
export const snapshotProduct = (p: Product) => ({
  name: p.name, sku: p.sku, barcode: p.barcode, description: p.description, price: Number(p.price), cost: Number(p.cost),
  lowStockAlert: p.lowStockAlert, isTaxable: p.isTaxable, minimumAge: p.minimumAge,
  ebtEligible: p.ebtEligible, priceEmbedded: p.priceEmbedded,
});
type Snapshot = ReturnType<typeof snapshotProduct>;
export const shipmentProduct = (item: TransferItem & { product: Product }): Snapshot => item.productSnapshot ? item.productSnapshot as Snapshot : snapshotProduct(item.product);
export const exactProductMatch = (p: Product, snapshot: Snapshot) => p.sku === snapshot.sku && p.name.trim().toLowerCase() === snapshot.name.trim().toLowerCase() && (p.barcode || null) === (snapshot.barcode || null) && p.isActive && p.trackInventory;

export async function lockTransfer(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT id FROM inventory_transfers WHERE id = ${id} FOR UPDATE`;
  const transfer = await tx.inventoryTransfer.findUnique({ where: { id }, include: { items: { include: { product: true } } } });
  if (!transfer) throw new AppError('Transfer not found', 404);
  return transfer;
}
export function requireTransferStore(req: AuthRequest, locationId: string, message: string) {
  if (req.user?.locationId !== locationId || !['ADMIN', 'MANAGER'].includes(req.user.role)) throw new AppError(message, 403);
}

export async function recordTransferReceipt(tx: Prisma.TransactionClient, req: AuthRequest, kind: TransferReceiptKind) {
  const transfer = await lockTransfer(tx, req.params.id);
  const locationId = kind === 'RECEIVE' ? transfer.toLocationId : transfer.fromLocationId;
  requireTransferStore(req, locationId, kind === 'RECEIVE' ? 'Only the destination store can record deliveries' : 'Only the source store can record returns');
  const body = receiptSchema.parse(req.body);
  const hash = createHash('sha256').update(JSON.stringify({ kind, body })).digest('hex');
  const existing = await tx.transferReceipt.findUnique({ where: { transferId_idempotencyKey: { transferId: transfer.id, idempotencyKey: body.idempotencyKey } }, include: { items: true } });
  if (existing) {
    if (existing.requestHash !== hash) throw new AppError('This retry key belongs to different transfer quantities or an action', 409);
    return { receipt: existing, status: transfer.status, replayed: true };
  }
  if (!['IN_TRANSIT', 'PARTIALLY_RECEIVED', 'RETURN_IN_TRANSIT'].includes(transfer.status)) throw new AppError('This shipment has no open delivery or return', 400);
  if (kind === 'REQUEST_RETURN') {
    if (!body.notes || body.items.length) throw new AppError('Provide a return reason without changing any quantities', 400);
    if (!transfer.items.some(item => outstanding(item) > 0)) throw new AppError('No unreceived units remain to request back. Accepted stock needs a new transfer.', 409);
  } else if (!body.items.length) throw new AppError('Enter at least one item', 400);
  const seen = new Set<string>();
  const lines = body.items.map(line => {
    const item = transfer.items.find(item => item.id === line.transferItemId);
    if (!item || seen.has(item.id)) throw new AppError('Invalid or duplicate transfer item', 400);
    seen.add(item.id);
    if (kind === 'SOURCE_RETURN' && (line.sentBackQty || line.destinationProductId || line.createProduct || line.newSku)) throw new AppError('Returned goods must use the original source product', 400);
    const total = line.acceptedQty + line.damagedQty + line.missingQty + line.sentBackQty;
    const remaining = kind === 'SOURCE_RETURN' ? returning(item) : outstanding(item);
    if (total > remaining) throw new AppError('Quantity exceeds the remaining units for ' + shipmentProduct(item).name + '. Remaining: ' + remaining, 400);
    return { ...line, item, total };
  });
  if (kind !== 'REQUEST_RETURN' && !lines.some(line => line.total > 0)) throw new AppError('Enter at least one received or resolved unit', 400);
  if (lines.some(line => line.damagedQty || line.missingQty || line.sentBackQty) && !body.notes) throw new AppError('Add a reason for damaged, missing or sent-back goods', 400);

  // Serialize catalog resolution/creation at the receiving store before taking product locks.
  // A removed connection blocks new shipments, but never strands an existing receipt or return.
  // Catalog serialization must not block the foreign-key checks of a sale that
  // already holds a product lock, or receiving and checkout can deadlock.
  if (kind === 'RECEIVE') await tx.$queryRaw`SELECT id FROM locations WHERE id = ${locationId} FOR NO KEY UPDATE`;
  const targets = new Map<string, { id: string; automatic: boolean }>();
  for (const line of lines.filter(line => line.acceptedQty > 0).sort((a, b) => a.item.productId.localeCompare(b.item.productId))) {
    if (kind === 'SOURCE_RETURN') { targets.set(line.item.id, { id: line.item.productId, automatic: false }); continue; }
    const snapshot = shipmentProduct(line.item);
    if (line.item.destinationProductId && ((line.destinationProductId && line.destinationProductId !== line.item.destinationProductId) || line.createProduct)) throw new AppError('This line is already mapped to a destination product', 409);
    let id = line.item.destinationProductId || line.destinationProductId;
    let automatic = false;
    if (line.createProduct) {
      if (id) throw new AppError('Select an existing product or create a product, not both', 400);
      const sku = line.newSku || snapshot.sku;
      if (sku === 'MISC-001') throw new AppError('The internal MISC product cannot receive transferred stock', 400);
      const conflict = await tx.product.findFirst({ where: { locationId, OR: [{ sku }, ...(snapshot.barcode ? [{ barcode: snapshot.barcode }] : [])] } });
      if (conflict) throw new AppError('A destination product already uses that SKU or barcode. Select its mapping or use a different SKU where appropriate.', 409);
      const product = await tx.product.create({ data: { ...snapshot, sku, locationId, stockQuantity: 0, trackInventory: true } });
      id = product.id;
    } else if (!id) {
      const product = await tx.product.findUnique({ where: { sku_locationId: { sku: snapshot.sku, locationId } } });
      if (!line.item.productSnapshot || !product || !exactProductMatch(product, snapshot)) throw new AppError('Choose a destination product for ' + snapshot.name + ' before accepting stock', 409);
      id = product.id; automatic = true;
    }
    targets.set(line.item.id, { id, automatic });
  }
  await lockInventory(tx, [...targets.values()].map(target => target.id).concat(lines.map(line => line.item.productId)));
  for (const line of lines.filter(line => line.acceptedQty > 0)) {
    const target = targets.get(line.item.id)!;
    const product = await tx.product.findUnique({ where: { id: target.id } });
    if (!product || product.locationId !== locationId || !product.trackInventory || (kind === 'RECEIVE' && !product.isActive) || product.sku === 'MISC-001') throw new AppError('Select an active tracked product at this store', 409);
    if (target.automatic && !exactProductMatch(product, shipmentProduct(line.item))) throw new AppError('The destination product changed; confirm its mapping', 409);
  }
  const receipt = await tx.transferReceipt.create({ data: {
    transferId: transfer.id, kind, idempotencyKey: body.idempotencyKey, requestHash: hash, locationId, userId: req.user!.id, notes: body.notes,
    items: { create: lines.filter(line => line.total > 0).map(line => ({ transferItemId: line.item.id, acceptedQty: line.acceptedQty, damagedQty: line.damagedQty, missingQty: line.missingQty, sentBackQty: line.sentBackQty })) },
  }, include: { items: true } });
  for (const line of lines.filter(line => line.total > 0)) {
    const offset = line.item.receivedQty + line.item.damagedQty + line.item.missingQty + line.item.returnedQty + line.item.returnDamagedQty + line.item.returnMissingQty;
    if (line.acceptedQty) await moveInventory(tx, { productId: targets.get(line.item.id)!.id, locationId, userId: req.user!.id,
      type: kind === 'SOURCE_RETURN' ? 'TRANSFER_RETURN' : 'TRANSFER_IN', quantity: line.acceptedQty, sourceId: receipt.id,
      sourceKey: 'transfer-receipt:' + receipt.id + ':' + line.item.id,
      valueMode: line.item.inventoryEntryId ? 'REFERENCE' : 'FIXED', referenceEntryId: line.item.inventoryEntryId,
      referenceQuantity: line.acceptedQty, referenceOffset: offset, notes: transfer.transferNumber });
    if (line.damagedQty + line.missingQty) await moveInventory(tx, { productId: line.item.productId, locationId: transfer.fromLocationId, userId: req.user!.id,
      type: 'TRANSFER_LOSS', reason: 'TRANSFER_DAMAGED_OR_MISSING', quantity: 0, sourceId: receipt.id, sourceKey: 'transfer-loss:' + receipt.id + ':' + line.item.id,
      valueMode: line.item.inventoryEntryId ? 'REFERENCE' : 'FIXED', referenceEntryId: line.item.inventoryEntryId,
      referenceQuantity: line.damagedQty + line.missingQty, referenceOffset: offset + line.acceptedQty, notes: body.notes });
    await tx.transferItem.update({ where: { id: line.item.id }, data: kind === 'SOURCE_RETURN' ? {
      returnedQty: { increment: line.acceptedQty }, returnDamagedQty: { increment: line.damagedQty }, returnMissingQty: { increment: line.missingQty },
    } : {
      receivedQty: { increment: line.acceptedQty }, damagedQty: { increment: line.damagedQty }, missingQty: { increment: line.missingQty }, sentBackQty: { increment: line.sentBackQty },
      ...(line.acceptedQty ? { destinationProductId: targets.get(line.item.id)!.id } : {}),
    } });
  }
  const items = await tx.transferItem.findMany({ where: { transferId: transfer.id } });
  const pendingDelivery = items.reduce((sum, item) => sum + outstanding(item), 0);
  const pendingReturn = items.reduce((sum, item) => sum + returning(item), 0);
  const status = kind === 'REQUEST_RETURN' ? transfer.status : pendingDelivery > 0 ? 'PARTIALLY_RECEIVED' : pendingReturn > 0 ? 'RETURN_IN_TRANSIT' : items.some(item => item.sentBackQty > 0) ? 'CLOSED' : 'RECEIVED';
  await tx.inventoryTransfer.update({ where: { id: transfer.id }, data: { status, receivedAt: pendingDelivery + pendingReturn === 0 ? new Date() : null } });
  await tx.activityLog.create({ data: { userId: req.user!.id, locationId, action: 'TRANSFER_' + kind, entity: 'TransferReceipt', entityId: receipt.id, details: { transferId: transfer.id, pendingDelivery, pendingReturn } } });
  return { receipt, status, pendingDelivery, pendingReturn, replayed: false };
}
