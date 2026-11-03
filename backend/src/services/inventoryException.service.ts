import { Prisma } from '@prisma/client';
import { AppError } from '../utils/errorHandler';

/**
 * Negative-stock discrepancy alerts.
 *
 * The register never refuses a sale because recorded stock ran out. Instead, the
 * movement that takes a product below zero opens (or updates) one exception in
 * the same transaction, so an alert can never be lost and never delays checkout.
 * One unresolved exception exists per product; later movements update it rather
 * than creating new alerts.
 */

export const RESOLUTION_REASONS = ['WRONG_SKU_SOLD', 'MISSING_RECEIPT', 'MISCOUNT', 'DAMAGED', 'THEFT', 'EXPIRED', 'TRANSFER_NOT_RECORDED', 'NO_CHANGE_NEEDED', 'OTHER'] as const;
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
  productFamily: string | null; variant: string | null; size: string | null; categoryId: string | null; supplierIds: string[] };

/** Rank SKUs worth counting alongside the negative one. Suggests; never asserts a cause. */
export function rankRelatedProducts(target: Candidate, candidates: Candidate[], limit = 8) {
  const ranked = candidates.filter(c => c.id !== target.id).map(candidate => {
    const reasons: string[] = [];
    let score = 0;
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
      size: candidate.size, stockQuantity: candidate.stockQuantity, score, reasons };
  }).filter(c => c.score >= 12);
  return ranked.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, limit);
}

const candidateSelect = { id: true, name: true, sku: true, barcode: true, stockQuantity: true, brand: true, productFamily: true,
  variant: true, size: true, categoryId: true, suppliers: { select: { supplierId: true } } } as const;
const toCandidate = (p: Prisma.ProductGetPayload<{ select: typeof candidateSelect }>): Candidate => ({ ...p, supplierIds: p.suppliers.map(s => s.supplierId) });

export async function relatedProducts(db: Prisma.TransactionClient, product: Prisma.ProductGetPayload<{ select: typeof candidateSelect }> & { locationId: string | null }) {
  const nameTokens = [...words(product.name)].filter(w => w.length > 2).slice(0, 3);
  const or: Prisma.ProductWhereInput[] = [];
  if (product.productFamily) or.push({ productFamily: { equals: product.productFamily, mode: 'insensitive' } });
  if (product.brand) or.push({ brand: { equals: product.brand, mode: 'insensitive' } });
  if (product.categoryId) or.push({ categoryId: product.categoryId });
  for (const token of nameTokens) or.push({ name: { contains: token, mode: 'insensitive' } });
  if (!or.length) return [];
  const candidates = await db.product.findMany({ where: { locationId: product.locationId, isActive: true, trackInventory: true, id: { not: product.id }, OR: or },
    select: candidateSelect, take: 300 });
  return rankRelatedProducts(toCandidate(product), candidates.map(toCandidate));
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
