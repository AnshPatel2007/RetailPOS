import { Prisma } from '@prisma/client';
import { AppError } from '../utils/errorHandler';
import { postInventoryValue, ValuePosting } from './inventoryCost.service';
import { reconcileSealedStock } from './productSellingUnit.service';
import { trackStockException } from './inventoryException.service';

/** Take all required product locks first in a stable order for multi-line work. */
export async function lockInventory(tx: Prisma.TransactionClient, productIds: string[]) {
  const ids = [...new Set(productIds)].sort();
  if (ids.length) await tx.$queryRaw(Prisma.sql`SELECT id FROM products WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`);
}

interface Movement extends ValuePosting {
  productId: string;
  locationId: string;
  userId: string;
  type: string;
  sourceId?: string;
  quantity?: number;
  setQuantity?: number;
  expectedVersion?: number | null;
  notes?: string;
  /** Sales (and corrections of sales) may take recorded stock below zero: the
   * customer is holding the item. Every other decrease still requires stock. */
  allowNegative?: boolean;
}

/** Must run in the same transaction as the originating business operation. */
export async function moveInventory(tx: Prisma.TransactionClient, movement: Movement) {
  await lockInventory(tx, [movement.productId]);
  const product = await tx.product.findUnique({ where: { id: movement.productId } });
  if (!product || product.locationId !== movement.locationId) throw new AppError('Product not found at this store', 404);
  if (!product.trackInventory) throw new AppError(`Stock is not tracked for ${product.name}`, 400);
  if (movement.expectedVersion !== undefined && movement.expectedVersion !== product.stockVersion) throw new AppError(`Stock changed for ${product.name}. Refresh and recount this item.`, 409);
  const quantity = movement.setQuantity ?? product.stockQuantity + (movement.quantity ?? 0);
  // Recorded stock may go negative only for sales: a customer holding the item
  // is proof it exists. Transfers, write-offs and supplier returns still need
  // recorded stock. Negative balances raise an inventory exception.
  if (movement.setQuantity !== undefined && movement.setQuantity < 0) throw new AppError(`A counted quantity cannot be negative for ${product.name}`, 400);
  if (!movement.allowNegative && quantity < 0 && quantity < product.stockQuantity)
    throw new AppError(`Insufficient stock for ${product.name}. Available: ${product.stockQuantity}`, 400);
  if (!Number.isSafeInteger(quantity) || quantity > 2147483647 || quantity < -2147483648) throw new AppError(`Invalid stock adjustment for ${product.name}`, 400);
  const inventoryEntry = await postInventoryValue(tx, { ...movement, type: movement.costKind || movement.type }, product.stockQuantity, quantity);
  const updated = await tx.product.update({ where: { id: product.id }, data: { stockQuantity: quantity } });
  if (quantity < product.stockQuantity) await reconcileSealedStock(tx, {
    productId: product.id, locationId: movement.locationId, stockQuantity: quantity,
    userId: movement.userId, sourceId: movement.sourceId || inventoryEntry.id,
  });
  if (quantity !== product.stockQuantity) await tx.inventoryLog.create({ data: {
    productId: product.id, locationId: movement.locationId, userId: movement.userId,
    type: movement.type, sourceId: movement.sourceId || inventoryEntry.id, notes: movement.notes,
    quantity: quantity - product.stockQuantity, previousQty: product.stockQuantity,
    newQty: quantity, stockVersion: updated.stockVersion,
  } });
  // Same transaction as the movement: the alert cannot be lost and never delays checkout.
  if (quantity !== product.stockQuantity) await trackStockException(tx, { productId: product.id, locationId: movement.locationId,
    previousQuantity: product.stockQuantity, newQuantity: quantity, movementType: movement.type, sourceId: movement.sourceId, entryId: inventoryEntry.id });
  return { ...updated, inventoryEntry };
}
