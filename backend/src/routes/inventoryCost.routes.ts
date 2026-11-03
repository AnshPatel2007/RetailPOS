import { Router, Response } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { authorize } from '../middleware/auth';
import { AuthRequest } from '../types';
import { asyncHandler, AppError } from '../utils/errorHandler';
import { getLocationFilter, resolveWriteLocation } from '../utils/locationFilter.util';
import { confirmOpening, previewCostCorrection, confirmCostCorrection, supplierReturn } from '../services/inventoryCostReview.service';
import { inventoryReconciliation } from '../services/inventoryCostReport.service';
import { getReportRange } from '../services/reportDates.service';
import { dateCondition } from '../services/financialMetrics.service';

const router = Router();
router.use(authorize('SUPER_ADMIN', 'ADMIN', 'MANAGER'));
const location = (req: AuthRequest) => {
  const { locationId } = getLocationFilter(req, typeof req.query.locationId === 'string' ? req.query.locationId : undefined);
  if (!locationId) throw new AppError('Select a store', 400);
  return locationId;
};
const money = z.number().finite().min(0).max(1_000_000_000_000);
const reason = z.string().trim().min(3).max(2000);
const correction = z.object({ entryId: z.string().min(1), value: money, reason });
const options = { timeout: 60000, isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead };

router.get('/receipts', asyncHandler(async (req: AuthRequest, res: Response) => {
  const locationId = location(req);
  const data = await prisma.purchaseReceipt.findMany({ where: { purchaseOrder: { locationId } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100,
    select: { id: true, invoiceNumber: true, createdAt: true, purchaseOrder: { select: { orderNumber: true, supplier: { select: { name: true } } } } } });
  res.json({ success: true, data });
}));

router.get('/balances', asyncHandler(async (req: AuthRequest, res: Response) => {
  const locationId = location(req), search = z.string().max(200).parse(req.query.search || '');
  const page = z.coerce.number().int().min(1).max(100000).parse(req.query.page || 1);
  const where: Prisma.ProductWhereInput = { locationId, isActive: true, trackInventory: true,
    ...(search ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { sku: { contains: search, mode: 'insensitive' } }] } : {}) };
  const data = await prisma.$transaction(async tx => {
    const [products, total, store] = await Promise.all([tx.product.findMany({ where, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: 50, skip: (page - 1) * 50 }), tx.product.count({ where }),
      tx.location.findUnique({ where: { id: locationId }, select: { costingActivatedAt: true } })]);
    const balances = await tx.inventoryValuation.findMany({ where: { productId: { in: products.map(p => p.id) } } });
    const openings = await tx.inventoryValueEntry.findMany({ where: { productId: { in: products.map(p => p.id) }, kind: 'OPENING' }, select: { productId: true } });
    return { products: products.map(p => { const b = balances.find(b => b.productId === p.id); return { id: p.id, name: p.name, sku: p.sku, quantity: p.stockQuantity,
      stockVersion: p.stockVersion, supplierPrice: Number(p.cost), value: p.stockQuantity === 0 ? 0 : b?.value === undefined || b.value === null ? null : Number(b.value),
      averageCost: b?.value == null || !b.quantity ? null : b.value.div(b.quantity).toNumber(), openingConfirmed: openings.some(o => o.productId === p.id), lastEntryId: b?.lastEntryId }; }),
      pagination: { page, total, totalPages: Math.ceil(total / 50) }, activatedAt: store?.costingActivatedAt };
  }, options);
  res.json({ success: true, data });
}));

router.get('/opening-review', authorize('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const locationId = location(req), search = z.string().max(200).parse(req.query.search || '');
  const filter = Prisma.sql`p."locationId" = ${locationId} AND p."isActive" AND p."trackInventory" AND p."stockQuantity" > 0
    AND v.value IS NULL
    AND NOT EXISTS (SELECT 1 FROM inventory_value_entries e WHERE e."productId" = p.id AND e.kind = 'OPENING')
    AND (${search} = '' OR POSITION(LOWER(${search}) IN LOWER(p.name)) > 0 OR POSITION(LOWER(${search}) IN LOWER(p.sku)) > 0)`;
  const data = await prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<{ id: string; name: string; sku: string; quantity: number; stockVersion: number; supplierPrice: Prisma.Decimal }[]>(Prisma.sql`
      SELECT p.id, p.name, p.sku, p."stockQuantity" AS quantity, p."stockVersion", p.cost AS "supplierPrice"
      FROM products p LEFT JOIN inventory_valuations v ON v."productId" = p.id WHERE ${filter}
      ORDER BY p.name, p.id LIMIT 500`);
    const [count] = await tx.$queryRaw<{ total: bigint }[]>(Prisma.sql`SELECT COUNT(*) AS total
      FROM products p LEFT JOIN inventory_valuations v ON v."productId" = p.id WHERE ${filter}`);
    return { products: rows.map(row => ({ ...row, supplierPrice: Number(row.supplierPrice) })), total: Number(count.total) };
  }, options);
  res.json({ success: true, data });
}));

router.get('/valuation', asyncHandler(async (req: AuthRequest, res: Response) => {
  const locationId = location(req), day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(req.query.date);
  const { range } = await getReportRange({ locationId }, day, day);
  const page = z.coerce.number().int().min(1).max(100000).parse(req.query.page || 1);
  const data = await prisma.$transaction(async tx => {
    const products = await tx.$queryRaw(Prisma.sql`SELECT p.id, p.name, p.sku, l."quantityAfter" AS quantity, l."valueAfter" AS value,
      l."valueAfter" / NULLIF(l."quantityAfter",0) AS "averageCost", p.cost AS "supplierPrice", FALSE AS "openingConfirmed"
      FROM products p LEFT JOIN LATERAL (SELECT e."quantityAfter", e."valueAfter" FROM effective_inventory_values e
        WHERE e."productId" = p.id AND ${dateCondition(Prisma.sql`e."createdAt"`, { lt: range.lt })} ORDER BY e.sequence DESC LIMIT 1) l ON TRUE
      WHERE p."locationId" = ${locationId} AND p."trackInventory" AND ${dateCondition(Prisma.sql`p."createdAt"`, { lt: range.lt })}
      ORDER BY p.name, p.id LIMIT 50 OFFSET ${(page - 1) * 50}`);
    const total = await tx.product.count({ where: { locationId, trackInventory: true, createdAt: { lt: range.lt } } });
    return { products, pagination: { page, total, totalPages: Math.ceil(total / 50) }, asOf: day };
  }, options);
  res.json({ success: true, data });
}));

router.get('/entries', asyncHandler(async (req: AuthRequest, res: Response) => {
  const locationId = location(req), page = z.coerce.number().int().min(1).max(100000).parse(req.query.page || 1);
  const productId = z.string().max(100).optional().parse(req.query.productId);
  const kind = z.string().regex(/^[A-Z_]+$/).max(50).optional().parse(req.query.kind);
  const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional().parse(req.query.month);
  const range = month ? (await getReportRange({ locationId }, month + '-01', month + '-' + new Date(Date.UTC(Number(month.slice(0,4)), Number(month.slice(5)), 0)).getUTCDate())).range : undefined;
  const filter = Prisma.sql`e."locationId" = ${locationId} AND ${productId ? Prisma.sql`e."productId" = ${productId}` : Prisma.sql`TRUE`}
    AND ${kind ? Prisma.sql`e.kind = ${kind}` : Prisma.sql`TRUE`} AND ${dateCondition(Prisma.sql`e."createdAt"`, range)}
    AND ${req.query.missing === 'true' ? Prisma.sql`(e."cogsAmount" IS NULL OR (e."valueAfter" IS NULL AND e.kind IN ('OPENING','BASELINE','PURCHASE')))` : Prisma.sql`TRUE`}`;
  const data = await prisma.$transaction(async tx => {
    const records = await tx.$queryRaw(Prisma.sql`SELECT e.*, p.name AS "productName", p.sku FROM effective_inventory_values e JOIN products p ON p.id = e."productId"
      WHERE ${filter} ORDER BY sequence DESC LIMIT 50 OFFSET ${(page - 1) * 50}`);
    const [count] = await tx.$queryRaw<{ total: bigint }[]>(Prisma.sql`SELECT COUNT(*) AS total FROM effective_inventory_values e WHERE ${filter}`);
    return { records, pagination: { page, total: Number(count.total), totalPages: Math.ceil(Number(count.total) / 50) } };
  }, options);
  res.json({ success: true, data });
}));

router.get('/reconciliation', asyncHandler(async (req: AuthRequest, res: Response) => {
  const locationId = location(req);
  const { range } = await getReportRange({ locationId }, req.query.startDate, req.query.endDate, 'month');
  res.json({ success: true, data: await prisma.$transaction(tx => inventoryReconciliation(locationId, range, tx), options) });
}));

router.post('/opening', authorize('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const body = z.object({ idempotencyKey: z.string().uuid(), notes: reason, items: z.array(z.object({ productId: z.string().min(1),
    quantity: z.number().int().min(0).max(2147483647), value: money, expectedVersion: z.number().int().min(0) })).min(1).max(500) }).parse(req.body);
  res.json({ success: true, data: await prisma.$transaction(tx => confirmOpening(tx, resolveWriteLocation(req), req.user!.id, body), options) });
}));
router.post('/corrections/preview', authorize('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const body = correction.parse(req.body);
  res.json({ success: true, data: await prisma.$transaction(tx => previewCostCorrection(tx, resolveWriteLocation(req), body), options) });
}));
router.post('/corrections', authorize('ADMIN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const body = correction.extend({ token: z.string().length(64), idempotencyKey: z.string().uuid() }).parse(req.body);
  res.json({ success: true, data: await prisma.$transaction(tx => confirmCostCorrection(tx, resolveWriteLocation(req), req.user!.id, body), options) });
}));
router.post('/supplier-returns', authorize('ADMIN', 'MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const body = z.object({ receiptEntryId: z.string().min(1), quantity: z.number().int().positive().max(2147483647), creditAmount: money,
    reason, idempotencyKey: z.string().uuid() }).parse(req.body);
  res.json({ success: true, data: await prisma.$transaction(tx => supplierReturn(tx, resolveWriteLocation(req), req.user!.id, body), options) });
}));
export default router;
