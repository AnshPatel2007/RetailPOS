import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { AuthRequest } from '../types';
import { AppError } from '../utils/errorHandler';
import { assertOwnsRecord } from '../utils/locationFilter.util';
import { lockInventory } from './inventory.service';
import { allocateReceiptCosts, receiveStock } from './receiptCost.service';
import { receivePurchaseOrderSchema } from '../validators/supplier.validator';
import { receiveSealedPackages } from './productSellingUnit.service';
import { creditReceiptProblems } from './supplierCredit.service';

export async function lockPurchaseOrder(tx: Prisma.TransactionClient, req: AuthRequest) {
  await tx.$queryRaw`SELECT id FROM purchase_orders WHERE id = ${req.params.id} FOR UPDATE`;
  const order = await tx.purchaseOrder.findUnique({ where: { id: req.params.id }, include: { items: true } });
  if (!order) throw new AppError('Purchase order not found', 404);
  assertOwnsRecord(req, order.locationId);
  return order;
}

export async function receiveOrder(tx: Prisma.TransactionClient, req: AuthRequest) {
  const body = receivePurchaseOrderSchema.parse({ body: req.body }).body;
  if (body.receivedItems && !body.idempotencyKey) throw new AppError('A receipt retry key is required for item-level receiving', 400);
  const order = await lockPurchaseOrder(tx, req);
  const key = body.idempotencyKey || 'legacy-receive-remainder';
  const hash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
  const existing = await tx.purchaseReceipt.findUnique({ where: { purchaseOrderId_idempotencyKey: { purchaseOrderId: order.id, idempotencyKey: key } }, include: { items: true } });
  if (existing) {
    if (existing.requestHash !== hash) throw new AppError('This receipt retry key was used for different quantities', 409);
    return { orderNumber: order.orderNumber, status: order.status, receipt: existing, replayed: true };
  }
  if (order.status === 'RECEIVED') throw new AppError('Order has already been received', 400);
  if (order.status === 'CANCELLED') throw new AppError('Cannot receive a cancelled order', 400);
  if (!['ORDERED', 'PARTIALLY_RECEIVED'].includes(order.status)) throw new AppError('Mark the order as ordered before receiving it', 409);
  if (!order.locationId) throw new AppError('Assign this legacy order to a store before receiving it', 409);
  const remaining = (item: typeof order.items[number]) => item.quantity - item.receivedQty - item.damagedQty - item.rejectedQty;
  const incoming = body.receivedItems ?? order.items.map(item => ({ purchaseOrderItemId: item.id, productId: item.productId, quantity: remaining(item), damagedQty: 0, rejectedQty: 0, packSize: 1, lineDiscount: 0, unitCost: undefined, packQuantity: undefined, sellingUnitId: undefined, receivedPackageQuantity: undefined, zeroCostConfirmed: false }));
  // Format edits and checkout use these same product locks. Read the conversion
  // after locking so a delivery cannot use an obsolete carton definition.
  await lockInventory(tx, order.items.map(item => item.productId));
  const sellingUnits = await tx.productSellingUnit.findMany({ where: {
    id: { in: incoming.flatMap(line => line.sellingUnitId ? [line.sellingUnitId] : []) }, locationId: order.locationId, isActive: true,
  } });
  const seen = new Set<string>();
  const lines = incoming.map(line => {
    const matches = order.items.filter(item => line.purchaseOrderItemId ? item.id === line.purchaseOrderItemId : item.productId === line.productId);
    if (matches.length !== 1) throw new AppError('Receipt item is missing or ambiguous on this order. Select the order line.', 400);
    const item = matches[0];
    if (seen.has(item.id)) throw new AppError('Duplicate receipt item', 400);
    seen.add(item.id);
    const sellingUnit = line.sellingUnitId ? sellingUnits.find(unit => unit.id === line.sellingUnitId && unit.productId === item.productId) : undefined;
    if (line.sellingUnitId && !sellingUnit) throw new AppError('The selected package is unavailable for ' + item.productName, 409);
    if (sellingUnit && line.packSize !== sellingUnit.unitsPerPackage) throw new AppError('The package size changed. Review the delivery again.', 409);
    const packSize = sellingUnit?.unitsPerPackage ?? line.packSize;
    const acceptedQty = line.packQuantity === undefined ? line.quantity : line.packQuantity * packSize;
    if (!Number.isSafeInteger(acceptedQty) || acceptedQty > 2147483647) throw new AppError('Accepted units exceed the supported quantity', 400);
    if (line.packQuantity !== undefined && line.quantity !== 0 && line.quantity !== acceptedQty) throw new AppError('Accepted units must match packs multiplied by units per pack', 400);
    const receivedPackageQuantity = line.receivedPackageQuantity ?? (sellingUnit ? line.packQuantity ?? 0 : 0);
    if (receivedPackageQuantity && (!sellingUnit || receivedPackageQuantity * packSize > acceptedQty))
      throw new AppError('Sealed packages cannot exceed the accepted units. Record damaged and rejected quantities separately.', 400);
    const accounted = acceptedQty + line.damagedQty + line.rejectedQty;
    if (acceptedQty && new Prisma.Decimal(line.unitCost ?? item.cost).isZero() && !line.zeroCostConfirmed)
      throw new AppError('Confirm free goods explicitly, or enter the actual purchase cost for ' + item.productName, 400);
    if (accounted > remaining(item)) throw new AppError('Receipt exceeds remaining quantity for ' + item.productName + '. Remaining: ' + remaining(item), 400);
    return { item, acceptedQty, damagedQty: line.damagedQty, rejectedQty: line.rejectedQty, accounted,
      unitCost: line.unitCost ?? item.cost.mul(packSize), packSize, lineDiscount: line.lineDiscount, sellingUnit, receivedPackageQuantity };
  });
  const totalIncoming = lines.reduce((sum, line) => sum + line.accounted, 0);
  const remainingAfter = order.items.reduce((sum, item) => sum + remaining(item), 0) - totalIncoming;
  if (!totalIncoming && !body.finalDelivery) throw new AppError('Enter at least one received quantity', 400);
  if ((lines.some(line => line.damagedQty || line.rejectedQty) || (body.finalDelivery && remainingAfter > 0)) && !body.notes) {
    throw new AppError('Add a reason for damaged, rejected or missing items', 400);
  }
  await lockInventory(tx, lines.map(line => line.item.productId));
  const products = await tx.product.findMany({ where: { id: { in: lines.map(line => line.item.productId) }, locationId: order.locationId } });
  const productMap = new Map(products.map(p => [p.id, p]));
  if (lines.some(line => !productMap.has(line.item.productId))) throw new AppError('An ordered product is unavailable at this store', 409);
  const finalDelivery = body.finalDelivery || remainingAfter === 0;
  const costs = allocateReceiptCosts(lines.map(line => ({ id: line.item.id, quantity: line.acceptedQty,
    unitCost: line.unitCost, packSize: line.packSize, discount: line.lineDiscount })), body);
  if (body.invoiceNumber) {
    // Supplier/store serialization also covers scanned invoice imports.
    await tx.$queryRaw`SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtextextended(${order.locationId + ':' + order.supplierId + ':' + body.invoiceNumber.toLowerCase()}, 0))`;
    if (await tx.purchaseReceipt.findFirst({ where: { invoiceNumber: { equals: body.invoiceNumber, mode: 'insensitive' }, purchaseOrder: { supplierId: order.supplierId, locationId: order.locationId } } }))
      throw new AppError('This supplier invoice was already received. Open its original receipt.', 409);
  }
  const receipt = await tx.purchaseReceipt.create({ data: {
    invoiceNumber: body.invoiceNumber, invoiceDate: body.invoiceDate ? new Date(body.invoiceDate) : undefined,
    freight: body.freight, acquisitionTax: body.acquisitionTax, invoiceDiscount: body.invoiceDiscount,
    purchaseOrderId: order.id, idempotencyKey: key, requestHash: hash,
    receivedBy: req.user!.id, notes: body.notes, finalDelivery,
    items: { create: lines.filter(line => line.accounted > 0).map(line => ({
      purchaseOrderItemId: line.item.id, acceptedQty: line.acceptedQty, damagedQty: line.damagedQty, rejectedQty: line.rejectedQty,
      unitCost: costs.find(cost => cost.id === line.item.id)!.unitCost, packSize: line.packSize, lineDiscount: line.lineDiscount,
      sellingUnitId: line.sellingUnit?.id, sellingUnitName: line.sellingUnit?.name, receivedPackageQuantity: line.receivedPackageQuantity,
      allocatedCharges: costs.find(cost => cost.id === line.item.id)!.allocatedCharges,
      inventoryValue: costs.find(cost => cost.id === line.item.id)!.inventoryValue,
      // Read before receiveStock overwrites it below: what the item cost until this delivery.
      previousUnitCost: productMap.get(line.item.productId)!.cost,
    })) },
  }, include: { items: true } });
  for (const line of [...lines].sort((a, b) => a.item.productId.localeCompare(b.item.productId))) {
    if (!line.accounted) continue;
    const cost = costs.find(cost => cost.id === line.item.id)!;
    if (line.acceptedQty) {
      const received = await receiveStock(tx, { productId: line.item.productId, locationId: order.locationId, userId: req.user!.id,
        sourceId: receipt.id, sourceKey: 'receipt-line:' + receipt.id + ':' + line.item.id,
        quantity: line.acceptedQty, inventoryValue: cost.inventoryValue, unitCost: cost.unitCost, notes: 'Received from PO: ' + order.orderNumber });
      if (received) await tx.purchaseReceiptItem.update({ where: { id: receipt.items.find(item => item.purchaseOrderItemId === line.item.id)!.id }, data: { inventoryEntryId: received.inventoryEntry.id } });
      if (line.sellingUnit && line.receivedPackageQuantity) await receiveSealedPackages(tx, {
        productId: line.item.productId, locationId: order.locationId, sellingUnitId: line.sellingUnit.id,
        quantity: line.receivedPackageQuantity, userId: req.user!.id, sourceId: receipt.id,
        requestKey: 'receipt-package:' + receipt.id + ':' + line.item.id,
      });
    }
    await tx.purchaseOrderItem.update({ where: { id: line.item.id }, data: {
      receivedQty: { increment: line.acceptedQty }, damagedQty: { increment: line.damagedQty }, rejectedQty: { increment: line.rejectedQty },
    } });
  }
  if (body.supplierBilledForProblems ?? !!body.invoiceNumber) await creditReceiptProblems(tx, { locationId: order.locationId, supplierId: order.supplierId,
    receiptId: receipt.id, userId: req.user!.id, lines: lines.map(line => ({ productName: line.item.productName, damagedQty: line.damagedQty,
      rejectedQty: line.rejectedQty, unitCost: costs.find(cost => cost.id === line.item.id)!.unitCost })) });
  const status = finalDelivery ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
  await tx.purchaseOrder.update({ where: { id: order.id }, data: { status, receivedAt: finalDelivery ? new Date() : null } });
  await tx.activityLog.create({ data: { userId: req.user!.id, locationId: order.locationId, action: 'PURCHASE_RECEIVED', entity: 'PurchaseReceipt', entityId: receipt.id, details: { orderId: order.id, finalDelivery, remaining: remainingAfter } } });
  return { orderNumber: order.orderNumber, status, receipt, remaining: remainingAfter, replayed: false };
}
