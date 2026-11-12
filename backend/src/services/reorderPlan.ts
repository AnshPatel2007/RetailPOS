import { roundToCases } from './purchaseOrderLines';

/**
 * The one reorder engine: what to order from each supplier, from 30-day net
 * sales, stock, stock already on order and how the supplier sells (cases,
 * minimum order). Pure, so it is unit tested; reorder.service.ts loads the facts.
 *
 * Without delivery days (basis DEFAULT): an item is suggested when it is at or
 * below its low-stock level, or what is on hand and on order covers less than
 * 7 days; the order brings it to 14 days of selling (or twice the low-stock level).
 *
 * With delivery days (basis DELIVERY_DAYS): an order placed today arrives on the
 * first delivery day at least the lead time away (and never today), D1, and must
 * last until the delivery after that, D2, plus two days of safety. An item is
 * suggested when it will not last that long (or is at its low-stock level); it is
 * urgent when what is on hand runs out before D1.
 */
export const VELOCITY_DAYS = 30;
export const COVER_TARGET_DAYS = 14;
export const URGENT_DAYS = 7;
export const SAFETY_DAYS = 2;

export interface ReorderLink {
  supplierId: string; supplierName: string; leadTimeDays: number | null; deliveryDays: number[];
  cost: number | null; packSize: number; packCost: number | null; minOrder: number | null;
}
export interface ReorderProduct {
  productId: string; name: string; sku: string; cost: number; stockQuantity: number; lowStockAlert: number;
  /** Net units sold in the velocity window (refunds taken off). */
  unitsSold: number;
  onOrder: number;
  /** The cheapest active supplier link, or null. */
  link: ReorderLink | null;
}
/** Today in the store's time zone. */
export interface StoreDay { date: string; weekday: number }

export const addDays = (date: string, days: number) => {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
};
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Days until the next delivery an order placed today can make (D1) and the one after it (D2). */
export function deliverySchedule(today: StoreDay, deliveryDays: number[], leadTimeDays: number | null) {
  const days = [...new Set(deliveryDays.filter(day => Number.isInteger(day) && day >= 0 && day <= 6))];
  if (!days.length) return null;
  const firstDelivering = (from: number) => {
    for (let offset = from; offset < from + 7; offset++) if (days.includes((today.weekday + offset) % 7)) return offset;
    return from;
  };
  const daysToNext = firstDelivering(Math.max(1, leadTimeDays ?? 1));
  const daysToFollowing = firstDelivering(daysToNext + 1);
  return { daysToNext, daysToFollowing, nextDelivery: addDays(today.date, daysToNext), followingDelivery: addDays(today.date, daysToFollowing) };
}

export function planReorder(products: ReorderProduct[], today: StoreDay, velocityDays = VELOCITY_DAYS) {
  type Item = {
    productId: string; name: string; sku: string; stock: number; onOrder: number; lowStockAlert: number; velocityPerDay: number;
    daysOfCover: number | null; suggestedQty: number; cost: number; packSize: number; packCost: number | null; urgent: boolean;
    /** With delivery days: what is on hand and on order runs out before the following delivery. */
    runsOutBeforeFollowing: boolean;
  };
  const groups = new Map<string, {
    supplierId: string | null; supplierName: string; leadTimeDays: number | null; basis: 'DELIVERY_DAYS' | 'DEFAULT';
    deliveryDays: number[]; nextDelivery: string | null; followingDelivery: string | null; coverDays: number;
    schedule: ReturnType<typeof deliverySchedule>; items: Item[];
  }>();
  const groupFor = (link: ReorderLink | null) => {
    const key = link?.supplierId ?? 'unassigned';
    if (!groups.has(key)) {
      const schedule = link ? deliverySchedule(today, link.deliveryDays, link.leadTimeDays) : null;
      groups.set(key, { supplierId: link?.supplierId ?? null, supplierName: link?.supplierName ?? 'No supplier linked', leadTimeDays: link?.leadTimeDays ?? null,
        basis: schedule ? 'DELIVERY_DAYS' : 'DEFAULT', deliveryDays: link?.deliveryDays ?? [], nextDelivery: schedule?.nextDelivery ?? null,
        followingDelivery: schedule?.followingDelivery ?? null, coverDays: schedule ? schedule.daysToFollowing + SAFETY_DAYS : COVER_TARGET_DAYS, schedule, items: [] });
    }
    return groups.get(key)!;
  };

  for (const product of products) {
    const group = groupFor(product.link);
    const { schedule, coverDays } = group;
    const velocity = Math.max(0, product.unitsSold) / velocityDays;
    const expected = product.stockQuantity + product.onOrder;
    const expectedCover = velocity > 0 ? expected / velocity : null;
    const belowThreshold = product.lowStockAlert > 0 && expected <= product.lowStockAlert;
    const runningOut = expectedCover !== null && expectedCover < (schedule ? coverDays : URGENT_DAYS);
    if (!belowThreshold && !runningOut) continue;
    // Enough to sell until the cover target, or back above twice the low-stock level.
    const coverQty = Math.ceil(velocity * coverDays) - expected;
    const thresholdQty = product.lowStockAlert > 0 ? product.lowStockAlert * 2 - expected : 0;
    const link = product.link;
    group.items.push({
      productId: product.productId, name: product.name, sku: product.sku, stock: product.stockQuantity, onOrder: product.onOrder,
      lowStockAlert: product.lowStockAlert, velocityPerDay: Math.round(velocity * 100) / 100,
      daysOfCover: velocity > 0 ? Math.round((product.stockQuantity / velocity) * 10) / 10 : null,
      // Suppliers sell in cases: round up to whole cases and their minimum order.
      suggestedQty: roundToCases(Math.max(coverQty, thresholdQty, 1), link?.packSize, link?.minOrder),
      cost: link?.cost ?? product.cost, packSize: link?.packSize ?? 1, packCost: link?.packCost ?? null,
      urgent: product.stockQuantity <= 0 || (schedule ? velocity > 0 && product.stockQuantity / velocity < schedule.daysToNext : runningOut),
      runsOutBeforeFollowing: !!schedule && expectedCover !== null && expectedCover < schedule.daysToFollowing,
    });
  }

  const suppliers = [...groups.values()].filter(group => group.items.length).map(({ schedule: _schedule, ...group }) => ({
    ...group,
    items: group.items.sort((a, b) => (a.daysOfCover ?? 999) - (b.daysOfCover ?? 999) || a.name.localeCompare(b.name)),
    estimatedTotal: Math.round(group.items.reduce((sum, item) => sum + (item.packSize > 1 && item.packCost !== null
      ? item.packCost * (item.suggestedQty / item.packSize) : item.cost * item.suggestedQty), 0) * 100) / 100,
  })).sort((a, b) => (a.supplierId === null ? 1 : 0) - (b.supplierId === null ? 1 : 0));
  return { today: today.date, velocityWindowDays: velocityDays, coverTargetDays: COVER_TARGET_DAYS, suppliers };
}
export type ReorderPlan = ReturnType<typeof planReorder>;
