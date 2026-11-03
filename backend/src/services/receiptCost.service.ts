import { Prisma } from '@prisma/client';
import { AppError } from '../utils/errorHandler';
import { decimal, precision } from './inventoryCost.service';
import { moveInventory } from './inventory.service';

type ReceiptLine = { id: string; quantity: number; unitCost: Prisma.Decimal.Value; packSize?: number; discount?: number };
/** Shared by PO receiving and reviewed invoice imports. Costs cover accepted goods only. */
export function allocateReceiptCosts(lines: ReceiptLine[], charges: { freight?: number; acquisitionTax?: number; invoiceDiscount?: number }) {
  const net = lines.map(line => {
    const amount = precision(decimal(line.unitCost).div(line.packSize || 1).mul(line.quantity).minus(line.discount || 0));
    if (amount.isNegative()) throw new AppError('A line discount cannot exceed accepted merchandise value', 400);
    return amount;
  });
  const total = net.reduce((sum, n) => sum.plus(n), decimal(0));
  if (decimal(charges.invoiceDiscount || 0).gt(total)) throw new AppError('Invoice discount exceeds accepted merchandise value', 400);
  const shared = decimal(charges.freight || 0).plus(charges.acquisitionTax || 0).minus(charges.invoiceDiscount || 0).mul(100).toDecimalPlaces(0);
  if (total.isZero() && !shared.isZero()) throw new AppError('Allocate invoice charges to merchandise with a value before receiving', 400);
  const shares = net.map((value, index) => {
    const exact = total.isZero() ? decimal(0) : shared.abs().mul(value).div(total);
    return { index, cents: exact.floor(), fraction: exact.minus(exact.floor()) };
  });
  let remaining = shared.abs().minus(shares.reduce((sum, r) => sum.plus(r.cents), decimal(0))).toNumber();
  for (const row of [...shares].sort((a, b) => b.fraction.comparedTo(a.fraction) || a.index - b.index)) {
    if (remaining-- <= 0) break;
    row.cents = row.cents.plus(1);
  }
  return lines.map((line, index) => {
    const allocatedCharges = shares[index].cents.div(100).mul(shared.isNegative() ? -1 : 1);
    return { ...line, unitCost: precision(decimal(line.unitCost).div(line.packSize || 1)),
      allocatedCharges, inventoryValue: precision(net[index].plus(allocatedCharges)) };
  });
}

export async function receiveStock(tx: Prisma.TransactionClient, input: {
  productId: string; locationId: string; userId: string; sourceId: string; sourceKey: string;
  quantity: number; inventoryValue: Prisma.Decimal; unitCost: Prisma.Decimal; notes?: string;
}) {
  const product = await tx.product.findUnique({ where: { id: input.productId } });
  if (!product || product.locationId !== input.locationId) throw new AppError('Received product is unavailable at this store', 409);
  // The supplier price is informational; inventory carrying value is separate.
  await tx.product.update({ where: { id: input.productId }, data: { cost: input.unitCost.toDecimalPlaces(4) } });
  if (!product.trackInventory || !input.quantity) return null;
  return moveInventory(tx, { ...input, type: 'PURCHASE', valueMode: 'FIXED', valueInput: input.inventoryValue });
}
