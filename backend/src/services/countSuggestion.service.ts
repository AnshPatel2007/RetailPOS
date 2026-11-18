import prisma from '../config/database';
import { ADJUSTMENT_REASONS } from '../controllers/inventoryAdjustment.controller';
import { valueProducts } from './inventoryValueRead.service';

/**
 * Which items to count next, and how accurate stock records have been.
 *
 * Score (higher first), each part with a plain reason:
 *   +40 never counted, else +1 per day since the last count (at most 40);
 *   +0..30 by stock value, highest in the store first;
 *   +0..20 by units sold in the last 30 days, best seller first;
 *   +15 when stock was adjusted by hand in the last 14 days;
 *   +10 when recorded stock is between 0 and the low-stock level (quick to count).
 * Items with an open stock exception or already on an open count are left out.
 */
export interface CountCandidate {
  productId: string; name: string; sku: string; stockQuantity: number; lowStockAlert: number;
  lastCountedAt: Date | null; inventoryValue: number; unitsSold30: number; adjustedRecently: boolean;
}
export interface ScoredCandidate extends CountCandidate { score: number; reasons: string[] }

const DAY = 86400000;
/** Log types that mean someone counted the item. */
export const COUNT_LOG_TYPES = ['CYCLE_COUNT', 'COUNT', 'MANUAL_COUNT', 'MISCOUNT', 'EXCEPTION_COUNT'];
const money = (value: number) => value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

/** Highest value gets `top` points, the lowest 0; equal values share points; nothing (0) earns nothing. */
function rankPoints(values: number[], top: number) {
  const positive = [...new Set(values.filter(value => value > 0))].sort((a, b) => b - a);
  return (value: number) => {
    if (!(value > 0)) return 0;
    if (positive.length === 1) return top;
    return Math.round(top * (positive.length - 1 - positive.indexOf(value)) / (positive.length - 1));
  };
}

export function scoreCountCandidates(candidates: CountCandidate[], now: Date): ScoredCandidate[] {
  const valuePoints = rankPoints(candidates.map(item => item.inventoryValue), 30);
  const salesPoints = rankPoints(candidates.map(item => item.unitsSold30), 20);
  return candidates.map(item => {
    const reasons: string[] = [];
    let score = 0;
    if (!item.lastCountedAt) { score += 40; reasons.push('Never counted'); }
    else {
      const days = Math.max(0, Math.floor((now.getTime() - item.lastCountedAt.getTime()) / DAY));
      score += Math.min(40, days);
      if (days >= 14) reasons.push(`Last counted ${days} days ago`);
    }
    const value = valuePoints(item.inventoryValue);
    score += value;
    if (value >= 15) reasons.push(`High stock value (${money(item.inventoryValue)})`);
    const sales = salesPoints(item.unitsSold30);
    score += sales;
    if (sales >= 10) reasons.push(`Sells often (${item.unitsSold30} in 30 days)`);
    if (item.adjustedRecently) { score += 15; reasons.push('Stock adjusted by hand in the last 14 days'); }
    if (item.stockQuantity >= 0 && item.stockQuantity <= item.lowStockAlert) { score += 10; reasons.push(`Only ${item.stockQuantity} on record, quick to count`); }
    return { ...item, score, reasons };
  }).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name) || a.productId.localeCompare(b.productId));
}

/** The store's top `limit` items to count now. */
export async function suggestedCounts(locationId: string, limit: number, now = new Date()) {
  const [exceptions, onCounts] = await Promise.all([
    prisma.inventoryException.findMany({ where: { locationId, status: { in: ['OPEN', 'RECOUNT_REQUESTED'] } }, select: { productId: true } }),
    prisma.cycleCountItem.findMany({ where: { cycleCount: { locationId, status: { in: ['IN_PROGRESS', 'REVIEW'] } } }, select: { productId: true } }),
  ]);
  const excluded = [...new Set([...exceptions, ...onCounts].map(row => row.productId))];
  const products = await prisma.product.findMany({ where: { locationId, isActive: true, trackInventory: true, sku: { notIn: ['MISC', 'MISC-001'] }, id: { notIn: excluded } },
    select: { id: true, name: true, sku: true, stockQuantity: true, lowStockAlert: true, trackInventory: true } });
  if (!products.length) return [];
  const ids = products.map(product => product.id);
  const [logs, approved, adjusted, sold, valued] = await Promise.all([
    prisma.inventoryLog.groupBy({ by: ['productId'], where: { productId: { in: ids }, type: { in: COUNT_LOG_TYPES } }, _max: { createdAt: true } }),
    // A count that matched the record moves no stock and writes no log; its approval still counts.
    prisma.$queryRaw<{ productId: string; at: Date }[]>`SELECT i."productId", MAX(c."completedAt") AS at FROM cycle_count_items i JOIN cycle_counts c ON c.id = i."cycleCountId"
      WHERE c."locationId" = ${locationId} AND c.status = 'APPROVED' AND c."completedAt" IS NOT NULL GROUP BY i."productId"`,
    prisma.inventoryLog.findMany({ where: { productId: { in: ids }, type: { in: [...ADJUSTMENT_REASONS] }, createdAt: { gte: new Date(now.getTime() - 14 * DAY) } }, select: { productId: true }, distinct: ['productId'] }),
    prisma.$queryRaw<{ productId: string; units: number }[]>`SELECT si."productId", SUM(COALESCE(si."inventoryQuantity", si.quantity * si."unitsPerPackage"))::int AS units
      FROM sale_items si JOIN sales s ON s.id = si."saleId"
      WHERE s."locationId" = ${locationId} AND s.status IN ('COMPLETED', 'REFUNDED') AND s."createdAt" >= ${new Date(now.getTime() - 30 * DAY)}
      GROUP BY si."productId"`,
    valueProducts(prisma, products),
  ]);
  const lastCount = new Map<string, Date>();
  for (const row of [...logs.map(log => ({ productId: log.productId, at: log._max.createdAt })), ...approved]) {
    if (row.at && (!lastCount.has(row.productId) || lastCount.get(row.productId)! < row.at)) lastCount.set(row.productId, new Date(row.at));
  }
  const adjustedIds = new Set(adjusted.map(row => row.productId));
  const unitsSold = new Map(sold.map(row => [row.productId, Number(row.units)]));
  const values = new Map(valued.map(product => [product.id, product.inventoryValue ?? 0]));
  return scoreCountCandidates(products.map(product => ({
    productId: product.id, name: product.name, sku: product.sku, stockQuantity: product.stockQuantity, lowStockAlert: product.lowStockAlert,
    lastCountedAt: lastCount.get(product.id) ?? null, inventoryValue: values.get(product.id) ?? 0,
    unitsSold30: unitsSold.get(product.id) ?? 0, adjustedRecently: adjustedIds.has(product.id),
  })), now).slice(0, limit);
}

/** Of the items on counts approved in the last 30 days, the share whose count matched the record. */
export async function stockAccuracy(locationId: string, now = new Date()) {
  const items = await prisma.cycleCountItem.findMany({
    where: { countedQty: { not: null }, cycleCount: { locationId, status: 'APPROVED', completedAt: { gte: new Date(now.getTime() - 30 * DAY) } } },
    select: { countedQty: true, expectedQty: true },
  });
  const matched = items.filter(item => item.countedQty === item.expectedQty).length;
  return { counted: items.length, matched, accuracy: items.length ? Math.round(matched / items.length * 1000) / 1000 : null };
}

export type SuggestedCount = Awaited<ReturnType<typeof suggestedCounts>>[number];
