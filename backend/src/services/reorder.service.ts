import prisma from '../config/database';
import { planReorder, ReorderProduct, StoreDay, VELOCITY_DAYS } from './reorderPlan';

const DAY = 86400000;
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Today's date and weekday in a time zone (a store's day, not the server's). */
export function storeDay(timezone: string, now = new Date()): StoreDay {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })
    .formatToParts(now).map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, weekday: WEEKDAY_SHORT.indexOf(parts.weekday) };
}

/** The facts planReorder needs, for one store (or every store for a platform-wide view). */
export async function loadReorderPlan(scope: { locationId?: string }, now = new Date()) {
  const cutoff = new Date(now.getTime() - VELOCITY_DAYS * DAY);
  const [products, soldRows, refundedRows, openOrderRows, store] = await Promise.all([
    prisma.product.findMany({
      where: { isActive: true, trackInventory: true, sku: { not: 'MISC-001' }, ...scope },
      select: { id: true, name: true, sku: true, cost: true, stockQuantity: true, lowStockAlert: true,
        suppliers: { where: { supplier: { ...scope, isActive: true } }, orderBy: { cost: 'asc' }, take: 1,
          select: { cost: true, leadTime: true, minOrder: true, packSize: true, packCost: true,
            supplier: { select: { id: true, name: true, leadTimeDays: true, deliveryDays: true } } } } },
    }),
    // A 12-pack sold counts as 12 units of demand.
    prisma.saleItem.groupBy({ by: ['productId', 'sellingUnitId'], where: { createdAt: { gte: cutoff }, sale: { status: { in: ['COMPLETED', 'REFUNDED'] }, ...scope } },
      _sum: { quantity: true, inventoryQuantity: true } }),
    // Units refunded in the same window were not real demand.
    prisma.refundItem.findMany({ where: { refund: { createdAt: { gte: cutoff }, sale: { status: { in: ['COMPLETED', 'REFUNDED'] }, ...scope } } },
      select: { quantity: true, saleItem: { select: { productId: true, unitsPerPackage: true } } } }),
    // Stock already ordered and not yet received is not suggested again.
    prisma.purchaseOrderItem.findMany({ where: { purchaseOrder: { status: { in: ['PENDING', 'ORDERED', 'PARTIALLY_RECEIVED'] }, ...scope } },
      select: { productId: true, quantity: true, receivedQty: true, damagedQty: true, rejectedQty: true } }),
    scope.locationId ? prisma.location.findUnique({ where: { id: scope.locationId }, select: { timezone: true } }) : null,
  ]);
  const sold = new Map<string, number>();
  for (const row of soldRows) sold.set(row.productId, (sold.get(row.productId) || 0) + (row.sellingUnitId ? row._sum.inventoryQuantity || 0 : row._sum.quantity || 0));
  for (const row of refundedRows) sold.set(row.saleItem.productId, Math.max(0, (sold.get(row.saleItem.productId) || 0) - row.quantity * Math.max(1, row.saleItem.unitsPerPackage || 1)));
  const onOrder = new Map<string, number>();
  for (const row of openOrderRows) onOrder.set(row.productId, (onOrder.get(row.productId) || 0) + Math.max(0, row.quantity - row.receivedQty - row.damagedQty - row.rejectedQty));
  const input: ReorderProduct[] = products.map(product => {
    const link = product.suppliers[0];
    return { productId: product.id, name: product.name, sku: product.sku, cost: Number(product.cost), stockQuantity: product.stockQuantity,
      lowStockAlert: product.lowStockAlert, unitsSold: sold.get(product.id) || 0, onOrder: onOrder.get(product.id) || 0,
      link: link ? { supplierId: link.supplier.id, supplierName: link.supplier.name, leadTimeDays: link.leadTime ?? link.supplier.leadTimeDays,
        deliveryDays: link.supplier.deliveryDays, cost: link.cost === null ? null : Number(link.cost), packSize: link.packSize,
        packCost: link.packCost === null ? null : Number(link.packCost), minOrder: link.minOrder } : null };
  });
  return planReorder(input, storeDay(store?.timezone || 'UTC', now));
}

/**
 * Weekdays on which this supplier's deliveries arrived on at least three
 * different days in the last eight weeks (store time). A suggestion only;
 * delivery days are saved only when the owner chooses them.
 */
export async function suggestDeliveryDays(supplierId: string, timezone: string, now = new Date()) {
  const receipts = await prisma.purchaseReceipt.findMany({ where: { purchaseOrder: { supplierId }, createdAt: { gte: new Date(now.getTime() - 56 * DAY) } }, select: { createdAt: true } });
  const dates = new Map<number, Set<string>>();
  for (const receipt of receipts) {
    const day = storeDay(timezone, receipt.createdAt);
    if (!dates.has(day.weekday)) dates.set(day.weekday, new Set());
    dates.get(day.weekday)!.add(day.date);
  }
  const weekdays = [...dates.entries()].filter(([, days]) => days.size >= 3).map(([weekday]) => weekday).sort((a, b) => a - b);
  return { weekdays, deliveries: [...dates.values()].reduce((sum, days) => sum + days.size, 0), weeks: 8 };
}
