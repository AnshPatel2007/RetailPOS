import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { getReportCalendar } from './reportDates.service';

/**
 * About how much was lost to empty shelves in the last seven complete store
 * days. An estimate, always shown as "about":
 *
 * - Only items with at least 21 days of sales history that averaged one or
 *   more a day over the 28 days before the week.
 * - Out of stock: from a stock record taking the item to zero or below until
 *   the next one above zero. A stretch with a sale of the item in it is skipped:
 *   the record was wrong, not the shelf.
 * - Only selling hours count: local hours in which the store had a sale on at
 *   least half of those 28 days.
 * - Missed units = selling hours out x (average daily units / selling hours a
 *   day), at most three average days per item, valued at today's price.
 */
const DAY = 86400000;
const HOUR = 3600000;
const BASE_DAYS = 28;
const MIN_HISTORY_DAYS = 21;
const MAX_DAYS_MISSED = 3;

export interface MissedSalesItem { productId: string; name: string; hoursOut: number; missedUnits: number; value: number }
type LogRow = { productId: string; newQty: number; createdAt: Date };

/** Stretches inside [start, end) during which recorded stock was zero or below. */
export function outOfStockIntervals(rows: LogRow[], start: Date, end: Date) {
  const sorted = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const before = sorted.filter(row => row.createdAt < start).pop();
  const intervals: { start: Date; end: Date }[] = [];
  let openedAt: Date | null = before && before.newQty <= 0 ? start : null;
  for (const row of sorted.filter(row => row.createdAt >= start && row.createdAt < end)) {
    if (row.newQty <= 0 && !openedAt) openedAt = row.createdAt;
    else if (row.newQty > 0 && openedAt) { intervals.push({ start: openedAt, end: row.createdAt }); openedAt = null; }
  }
  if (openedAt) intervals.push({ start: openedAt, end });
  return intervals;
}

/** Hours of [start, end) that fall in the store's selling hours (local clock hours). */
export function sellingHoursBetween(start: Date, end: Date, sellingHours: Set<number>, localHour: (at: Date) => number) {
  let total = 0;
  for (let cursor = start.getTime(); cursor < end.getTime();) {
    const next = Math.min(end.getTime(), Math.floor(cursor / HOUR) * HOUR + HOUR);
    if (sellingHours.has(localHour(new Date(cursor)))) total += next - cursor;
    cursor = next;
  }
  return total / HOUR;
}

export async function missedSales(locationId: string, now = new Date()) {
  const calendar = await getReportCalendar({ locationId }, now);
  const weekStart = calendar.day(-7), weekEnd = calendar.day(), baseStart = calendar.day(-7 - BASE_DAYS);
  const zone = calendar.timezone;
  const units = Prisma.sql`COALESCE(si."inventoryQuantity", si.quantity * si."unitsPerPackage")`;
  const recorded = Prisma.sql`s."locationId" = ${locationId} AND s.status IN ('COMPLETED', 'REFUNDED')`;
  const [baseSales, hours] = await Promise.all([
    prisma.$queryRaw<{ productId: string; units: number; firstSale: Date }[]>`
      SELECT si."productId", SUM(${units})::int AS units,
        (SELECT MIN(s2."createdAt") FROM sale_items si2 JOIN sales s2 ON s2.id = si2."saleId"
          WHERE si2."productId" = si."productId" AND s2."locationId" = ${locationId} AND s2.status IN ('COMPLETED', 'REFUNDED')) AS "firstSale"
      FROM sale_items si JOIN sales s ON s.id = si."saleId"
      WHERE ${recorded} AND s."createdAt" >= ${baseStart} AND s."createdAt" < ${weekStart}
      GROUP BY si."productId" HAVING SUM(${units}) >= ${BASE_DAYS}`,
    // Stored times are UTC: read them as UTC, then as the store's local clock.
    prisma.$queryRaw<{ hour: number; days: number }[]>`
      SELECT EXTRACT(HOUR FROM (s."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${zone})::int AS hour,
        COUNT(DISTINCT DATE((s."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${zone}))::int AS days
      FROM sales s WHERE ${recorded} AND s."createdAt" >= ${baseStart} AND s."createdAt" < ${weekStart}
      GROUP BY 1`,
  ]);
  const historyCutoff = new Date(weekStart.getTime() - MIN_HISTORY_DAYS * DAY);
  const candidates = baseSales.filter(row => row.firstSale && new Date(row.firstSale) <= historyCutoff);
  const sellingHours = new Set(hours.filter(row => row.days * 2 >= BASE_DAYS).map(row => Number(row.hour)));
  const period = { start: weekStart, end: weekEnd, timezone: zone };
  if (!candidates.length || !sellingHours.size) return { period, total: 0, items: [] as MissedSalesItem[] };

  const ids = candidates.map(row => row.productId);
  const [products, logs, weekSales] = await Promise.all([
    prisma.product.findMany({ where: { id: { in: ids }, locationId, isActive: true, trackInventory: true }, select: { id: true, name: true, price: true } }),
    prisma.inventoryLog.findMany({ where: { productId: { in: ids }, createdAt: { gte: baseStart, lt: weekEnd } }, select: { productId: true, newQty: true, createdAt: true } }),
    prisma.saleItem.findMany({ where: { productId: { in: ids }, sale: { locationId, status: { in: ['COMPLETED', 'REFUNDED'] }, createdAt: { gte: weekStart, lt: weekEnd } } },
      select: { productId: true, sale: { select: { createdAt: true } } } }),
  ]);
  const hourFormat = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', hourCycle: 'h23' });
  const localHour = (at: Date) => Number(hourFormat.format(at));
  const items: MissedSalesItem[] = [];
  for (const product of products) {
    const averageDaily = candidates.find(row => row.productId === product.id)!.units / BASE_DAYS;
    const sold = weekSales.filter(row => row.productId === product.id).map(row => row.sale.createdAt.getTime());
    const stretches = outOfStockIntervals(logs.filter(row => row.productId === product.id), weekStart, weekEnd)
      .filter(stretch => !sold.some(at => at > stretch.start.getTime() && at < stretch.end.getTime()));
    const hoursOut = stretches.reduce((sum, stretch) => sum + sellingHoursBetween(stretch.start, stretch.end, sellingHours, localHour), 0);
    if (!hoursOut) continue;
    const missedUnits = Math.min(hoursOut * averageDaily / sellingHours.size, MAX_DAYS_MISSED * averageDaily);
    items.push({ productId: product.id, name: product.name, hoursOut: Math.round(hoursOut * 10) / 10,
      missedUnits: Math.round(missedUnits * 10) / 10, value: Math.round(missedUnits * Number(product.price) * 100) / 100 });
  }
  items.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  return { period, total: Math.round(items.reduce((sum, item) => sum + item.value, 0) * 100) / 100, items };
}
