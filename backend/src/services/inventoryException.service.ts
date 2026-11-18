import { Prisma } from '@prisma/client';
import { AppError } from '../utils/errorHandler';
import type prisma from '../config/database';

/**
 * Negative-stock discrepancy alerts.
 *
 * The register never refuses a sale because recorded stock ran out. Instead, the
 * movement that takes a product below zero opens (or updates) one exception in
 * the same transaction, so an alert can never be lost and never delays checkout.
 * One unresolved exception exists per product; later movements update it rather
 * than creating new alerts.
 */

export const RESOLUTION_REASONS = ['WRONG_SKU_SOLD', 'RECEIVED_AS_OTHER', 'RETURNED_AS_OTHER', 'MISSING_RECEIPT', 'TRANSFER_NOT_RECORDED', 'MISCOUNT',
  'SOLD_WITHOUT_SCANNING', 'DAMAGED', 'THEFT', 'EXPIRED', 'NO_CHANGE_NEEDED', 'OTHER'] as const;
export type ResolutionReason = typeof RESOLUTION_REASONS[number];

/** Call after the stock row is updated, inside the movement's transaction (product row is locked). */
export async function trackStockException(tx: Prisma.TransactionClient, input: {
  productId: string; locationId: string; previousQuantity: number; newQuantity: number;
  movementType: string; sourceId?: string; entryId: string;
}) {
  const open = await tx.inventoryException.findUnique({ where: { openProductId: input.productId } });
  const decreased = input.newQuantity < input.previousQuantity;
  if (!open) {
    if (input.newQuantity >= 0 || !decreased) return null;
    return tx.inventoryException.create({ data: {
      productId: input.productId, locationId: input.locationId, openProductId: input.productId,
      triggerSaleId: input.movementType === 'SALE' ? input.sourceId ?? null : null, triggerEntryId: input.entryId,
      lowestQuantity: input.newQuantity, latestQuantity: input.newQuantity,
    } });
  }
  // Keep the existing alert current; a receipt that restores stock does not
  // explain the discrepancy, so the alert stays open for review.
  return tx.inventoryException.update({ where: { id: open.id }, data: {
    latestQuantity: input.newQuantity,
    lowestQuantity: Math.min(open.lowestQuantity, input.newQuantity),
    ...(decreased && input.newQuantity < 0 ? { occurrenceCount: { increment: 1 }, lastNegativeAt: new Date() } : {}),
  } });
}

const words = (value: string) => new Set(value.toLowerCase().replace(/[^a-z0-9.]+/g, ' ').split(' ').filter(w => w.length > 1));
function nameSimilarity(a: string, b: string) {
  const left = words(a), right = words(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared++;
  return shared / (left.size + right.size - shared);
}
const same = (a?: string | null, b?: string | null) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

type Candidate = { id: string; name: string; sku: string; barcode: string | null; stockQuantity: number; brand: string | null;
  productFamily: string | null; variant: string | null; size: string | null; categoryId: string | null; supplierIds: string[];
  /** Selling price; two items at one price are easy to ring up as each other. */
  price?: number | null };

/**
 * Rank SKUs worth counting alongside the negative one. Suggests; never asserts a cause.
 * `history` counts how often each candidate was mixed up with the target before
 * (sold as the other, or a sale line corrected between them).
 */
export function rankRelatedProducts(target: Candidate, candidates: Candidate[], limit = 8, history: Map<string, number> = new Map()) {
  const ranked = candidates.filter(c => c.id !== target.id).map(candidate => {
    const reasons: string[] = [];
    let score = 0;
    const mixedUp = history.get(candidate.id) || 0;
    if (mixedUp) { score += Math.min(75, 25 * mixedUp); reasons.push(`Mixed up before (${mixedUp} ${mixedUp === 1 ? 'time' : 'times'})`); }
    const samePrice = candidate.price != null && target.price != null && Math.round(candidate.price * 100) === Math.round(target.price * 100);
    if (samePrice) { score += 15; reasons.push('Same price'); }
    const sameSize = same(candidate.size, target.size);
    if (same(candidate.productFamily, target.productFamily)) { score += sameSize ? 100 : 70; reasons.push(sameSize ? 'Same product family and size' : 'Same product family'); }
    else if (same(candidate.brand, target.brand)) { score += sameSize ? 60 : 35; reasons.push(sameSize ? 'Same brand and size' : 'Same brand'); }
    if (target.categoryId && candidate.categoryId === target.categoryId) {
      const sharedSupplier = candidate.supplierIds.some(id => target.supplierIds.includes(id));
      score += sharedSupplier ? 20 : 12; reasons.push(sharedSupplier ? 'Same category and supplier' : 'Same category');
    }
    const similarity = nameSimilarity(candidate.name, target.name);
    if (similarity >= 0.25) { score += Math.round(similarity * 40); reasons.push('Similar name'); }
    if (candidate.stockQuantity > 0 && score > 0) reasons.push('Has recorded stock (a mis-scan may have reduced the wrong item)');
    return { id: candidate.id, name: candidate.name, sku: candidate.sku, barcode: candidate.barcode, variant: candidate.variant,
      size: candidate.size, stockQuantity: candidate.stockQuantity, score, reasons, mixedUp, samePrice };
  }).filter(c => c.score >= 12);
  return ranked.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, limit);
}

const candidateSelect = { id: true, name: true, sku: true, barcode: true, stockQuantity: true, brand: true, productFamily: true,
  variant: true, size: true, categoryId: true, price: true, suppliers: { select: { supplierId: true } } } as const;
const toCandidate = (p: Prisma.ProductGetPayload<{ select: typeof candidateSelect }>): Candidate => ({ ...p, price: Number(p.price), supplierIds: p.suppliers.map(s => s.supplierId) });
const HISTORY_DAYS = 180;

/** How often each other product was mixed up with this one in the last 180 days, in either direction. */
export async function mixUpHistory(db: Prisma.TransactionClient | typeof prisma, productId: string, locationId: string | null, now = new Date()) {
  const since = new Date(now.getTime() - HISTORY_DAYS * 86400000);
  const pair = { OR: [{ fromProductId: productId }, { toProductId: productId }] };
  const [reclasses, corrections] = await Promise.all([
    db.stockReclass.findMany({ where: { ...(locationId ? { locationId } : {}), reason: 'SOLD_AS_OTHER', createdAt: { gte: since }, ...pair }, select: { fromProductId: true, toProductId: true } }),
    db.saleItemCorrection.findMany({ where: { ...(locationId ? { locationId } : {}), createdAt: { gte: since }, ...pair }, select: { fromProductId: true, toProductId: true } }),
  ]);
  const history = new Map<string, number>();
  for (const row of [...reclasses, ...corrections]) {
    const other = row.fromProductId === productId ? row.toProductId : row.fromProductId;
    if (other !== productId) history.set(other, (history.get(other) || 0) + 1);
  }
  return history;
}

export async function relatedProducts(db: Prisma.TransactionClient | typeof prisma, product: Prisma.ProductGetPayload<{ select: typeof candidateSelect }> & { locationId: string | null }) {
  const history = await mixUpHistory(db, product.id, product.locationId);
  const nameTokens = [...words(product.name)].filter(w => w.length > 2).slice(0, 3);
  const or: Prisma.ProductWhereInput[] = [];
  // Items mixed up with this one before are always considered, however different they look.
  if (history.size) or.push({ id: { in: [...history.keys()] } });
  if (product.productFamily) or.push({ productFamily: { equals: product.productFamily, mode: 'insensitive' } });
  if (product.brand) or.push({ brand: { equals: product.brand, mode: 'insensitive' } });
  if (product.categoryId) or.push({ categoryId: product.categoryId });
  for (const token of nameTokens) or.push({ name: { contains: token, mode: 'insensitive' } });
  if (!or.length) return [];
  const candidates = await db.product.findMany({ where: { locationId: product.locationId, isActive: true, trackInventory: true, id: { not: product.id }, OR: or },
    select: candidateSelect, take: 300 });
  return rankRelatedProducts(toCandidate(product), candidates.map(toCandidate), 8, history);
}

/**
 * Open exceptions whose likeliest partner (mixed up before, or the same price)
 * has stock on hand: counting both usually finds the mis-scan. Most past
 * mix-ups first. Suggests only; nothing is corrected automatically.
 */
export async function likelyMixUps(db: Prisma.TransactionClient | typeof prisma, locationId: string, limit = 20) {
  const open = await db.inventoryException.findMany({ where: { locationId, status: { in: ['OPEN', 'RECOUNT_REQUESTED'] } },
    orderBy: [{ lastNegativeAt: 'desc' }, { id: 'asc' }], take: limit, include: { product: { select: { ...candidateSelect, locationId: true } } } });
  const found = [];
  for (const exception of open) {
    const partner = (await relatedProducts(db, exception.product)).find(candidate => (candidate.mixedUp > 0 || candidate.samePrice) && candidate.stockQuantity > 0);
    if (partner) found.push({ exceptionId: exception.id, product: { id: exception.product.id, name: exception.product.name, stockQuantity: exception.product.stockQuantity }, partner });
  }
  return found.sort((a, b) => b.partner.mixedUp - a.partner.mixedUp || b.partner.score - a.partner.score || a.product.name.localeCompare(b.product.name));
}

/** Everything a manager needs to investigate one exception. */
export async function exceptionDetail(db: Prisma.TransactionClient, id: string, locationId: string | null) {
  const exception = await db.inventoryException.findUnique({ where: { id }, include: { product: { select: { ...candidateSelect, locationId: true, lowStockAlert: true, stockVersion: true } } } });
  if (!exception || (locationId && exception.locationId !== locationId)) throw new AppError('Inventory exception not found', 404);
  const productId = exception.productId;
  const [recentSales, lastCount, lastReceipt, lastAdjustment, related] = await Promise.all([
    db.saleItem.findMany({ where: { productId, sale: { locationId: exception.locationId } }, orderBy: { createdAt: 'desc' }, take: 10,
      select: { id: true, quantity: true, price: true, createdAt: true, sale: { select: { id: true, saleNumber: true, user: { select: { firstName: true, lastName: true } } } } } }),
    db.inventoryLog.findFirst({ where: { productId, type: { in: ['CYCLE_COUNT', 'COUNT', 'MANUAL_COUNT', 'MISCOUNT', 'EXCEPTION_COUNT'] } }, orderBy: { createdAt: 'desc' } }),
    db.inventoryLog.findFirst({ where: { productId, type: { in: ['PURCHASE', 'TRANSFER_IN', 'TRANSFER_RETURN'] } }, orderBy: { createdAt: 'desc' } }),
    db.inventoryLog.findFirst({ where: { productId, type: { notIn: ['SALE', 'PURCHASE', 'TRANSFER_IN', 'TRANSFER_RETURN', 'TRANSFER_OUT', 'RETURN', 'VOID'] } }, orderBy: { createdAt: 'desc' } }),
    relatedProducts(db, exception.product),
  ]);
  const shortfall = Math.max(0, -exception.product.stockQuantity);
  return {
    ...exception,
    currentQuantity: exception.product.stockQuantity,
    summary: shortfall
      ? `${shortfall} more unit${shortfall === 1 ? ' was' : 's were'} sold than the system currently accounts for.`
      : 'Recorded stock is no longer negative, but the earlier discrepancy has not been reviewed.',
    recommendation: related.length
      ? `Count ${exception.product.name} and the related items below. Check whether a similar product was selected during recent sales.`
      : `Count ${exception.product.name}. Check recent deliveries, transfers and damaged goods.`,
    possibleCauses: ['A similar product was scanned or selected instead', 'A delivery was not received in the system', 'A transfer was not recorded', 'Damaged or expired goods were not written off', 'An earlier count was inaccurate'],
    recentSales, lastCount, lastReceipt, lastAdjustment, relatedProducts: related,
  };
}

export async function resolveException(tx: Prisma.TransactionClient, input: {
  id: string; locationId: string | null; userId: string; resolution: ResolutionReason; notes?: string | null;
  countedQuantity?: number | null; adjustmentEntryId?: string | null;
}) {
  const exception = await tx.inventoryException.findUnique({ where: { id: input.id } });
  if (!exception || (input.locationId && exception.locationId !== input.locationId)) throw new AppError('Inventory exception not found', 404);
  if (exception.status === 'RESOLVED') throw new AppError('This exception is already resolved', 409);
  if (input.resolution === 'OTHER' && !input.notes?.trim()) throw new AppError('Describe the resolution when choosing Other', 400);
  return tx.inventoryException.update({ where: { id: exception.id }, data: {
    status: 'RESOLVED', openProductId: null, resolution: input.resolution, resolutionNotes: input.notes?.trim() || null,
    resolvedById: input.userId, resolvedAt: new Date(),
    ...(input.countedQuantity !== undefined && input.countedQuantity !== null ? { countedQuantity: input.countedQuantity } : {}),
    ...(input.adjustmentEntryId ? { adjustmentEntryId: input.adjustmentEntryId } : {}),
  } });
}
