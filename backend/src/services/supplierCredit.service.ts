import { Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '../config/database';
import { AppError } from '../utils/errorHandler';

/**
 * Money a supplier owes the store: damaged or rejected goods the invoice still
 * charged for, returns, shortages and price corrections. A credit stays OPEN
 * until the supplier's credit note arrives (RECEIVED) or the owner gives up on
 * it (WRITTEN_OFF). Credits are records of what is owed; they never change
 * stock or inventory value.
 */
export const CREDIT_REASONS = ['DAMAGED', 'REJECTED', 'SHORT', 'PRICE', 'RETURN', 'OTHER'] as const;
export const CREDIT_STATUSES = ['OPEN', 'RECEIVED', 'WRITTEN_OFF'] as const;
type Db = Prisma.TransactionClient | typeof prisma;
const DAY = 86400000;
const toCents = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value).toDecimalPlaces(2);
const money = (value: number) => Math.round(value * 100) / 100;

/**
 * One OPEN credit per cause (damaged, rejected) for a receipt whose invoice
 * charged for goods the store did not accept, valued at the supplier's unit price.
 */
export async function creditReceiptProblems(tx: Prisma.TransactionClient, input: {
  locationId: string; supplierId: string; receiptId: string; userId: string;
  lines: { productName: string; damagedQty: number; rejectedQty: number; unitCost: Prisma.Decimal }[];
}) {
  const created = [];
  for (const [reason, field] of [['DAMAGED', 'damagedQty'], ['REJECTED', 'rejectedQty']] as const) {
    const affected = input.lines.filter(line => line[field] > 0);
    const amount = toCents(affected.reduce((sum, line) => sum.plus(line.unitCost.mul(line[field])), new Prisma.Decimal(0)));
    if (amount.lte(0)) continue;
    created.push(await tx.supplierCredit.create({ data: { locationId: input.locationId, supplierId: input.supplierId, receiptId: input.receiptId,
      reason, amount, createdById: input.userId, notes: affected.map(line => `${line[field]} × ${line.productName}`).join(', ').slice(0, 2000) } }));
  }
  return created;
}

/** A supplier return refunded by credit: the supplier owes that credit until it arrives. */
export async function creditSupplierReturn(tx: Prisma.TransactionClient, input: {
  locationId: string; userId: string; receiptEntryId: string; amount: number; quantity: number; productName: string; reason: string;
}) {
  if (!(input.amount > 0)) return null;
  const line = await tx.purchaseReceiptItem.findUnique({ where: { inventoryEntryId: input.receiptEntryId },
    select: { receiptId: true, receipt: { select: { purchaseOrder: { select: { supplierId: true } } } } } });
  // Older receipts without a linked receipt line cannot name the supplier: nothing to track.
  if (!line) return null;
  return tx.supplierCredit.create({ data: { locationId: input.locationId, supplierId: line.receipt.purchaseOrder.supplierId, receiptId: line.receiptId,
    reason: 'RETURN', amount: toCents(input.amount), createdById: input.userId,
    notes: `Returned ${input.quantity} × ${input.productName}: ${input.reason}`.slice(0, 2000) } });
}

const listQuery = z.object({
  status: z.enum(['open', 'settled', 'all']).default('open'),
  supplierId: z.string().min(1).max(100).optional(),
});

/** The store's credits, newest first, with what is still owed. */
export async function listCredits(db: Db, locationId: string, query: unknown, now = new Date()) {
  const { status, supplierId } = listQuery.parse(query);
  const where: Prisma.SupplierCreditWhereInput = { locationId, ...(supplierId ? { supplierId } : {}),
    ...(status === 'open' ? { status: 'OPEN' } : status === 'settled' ? { status: { in: ['RECEIVED', 'WRITTEN_OFF'] } } : {}) };
  const [rows, open] = await Promise.all([
    db.supplierCredit.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 200,
      include: { supplier: { select: { id: true, name: true } } } }),
    db.supplierCredit.findMany({ where: { locationId, status: 'OPEN', ...(supplierId ? { supplierId } : {}) }, select: { amount: true, createdAt: true } }),
  ]);
  const cutoff = new Date(now.getTime() - 30 * DAY);
  return {
    credits: rows.map(row => ({ ...row, amount: Number(row.amount) })),
    summary: {
      openCount: open.length,
      openAmount: money(open.reduce((sum, row) => sum + Number(row.amount), 0)),
      olderThan30Amount: money(open.filter(row => row.createdAt < cutoff).reduce((sum, row) => sum + Number(row.amount), 0)),
    },
  };
}

const createBody = z.object({
  supplierId: z.string().min(1).max(100),
  reason: z.enum(CREDIT_REASONS, { errorMap: () => ({ message: 'Choose why the supplier owes this credit' }) }),
  amount: z.number().finite().positive('Enter the amount owed').max(1_000_000),
  notes: z.string().trim().max(2000).optional(),
}).refine(body => body.reason !== 'OTHER' || !!body.notes, { message: 'Describe the credit when choosing Other', path: ['notes'] });

/** A credit the owner records by hand (a short delivery, a price correction...). */
export async function createCredit(locationId: string, userId: string, body: unknown) {
  const input = createBody.parse(body);
  const supplier = await prisma.supplier.findUnique({ where: { id: input.supplierId }, select: { id: true, locationId: true } });
  if (!supplier || (supplier.locationId !== null && supplier.locationId !== locationId)) throw new AppError('Supplier not found', 404);
  return prisma.$transaction(async tx => {
    const credit = await tx.supplierCredit.create({ data: { locationId, supplierId: supplier.id, reason: input.reason,
      amount: toCents(input.amount), notes: input.notes || null, createdById: userId }, include: { supplier: { select: { id: true, name: true } } } });
    await tx.activityLog.create({ data: { userId, locationId, action: 'SUPPLIER_CREDIT_CREATED', entity: 'SupplierCredit', entityId: credit.id,
      details: { supplierId: supplier.id, reason: input.reason, amount: Number(credit.amount) } } });
    return { ...credit, amount: Number(credit.amount) };
  });
}

const settleBody = z.object({
  status: z.enum(['RECEIVED', 'WRITTEN_OFF'], { errorMap: () => ({ message: 'Mark the credit received or written off' }) }),
  notes: z.string().trim().max(2000).optional(),
});

/** Received or written off, once: a credit already settled is never settled again. */
export async function settleCredit(locationId: string, userId: string, id: string, body: unknown) {
  const input = settleBody.parse(body);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM supplier_credits WHERE id = ${id} FOR UPDATE`;
    const credit = await tx.supplierCredit.findUnique({ where: { id } });
    if (!credit || credit.locationId !== locationId) throw new AppError('Credit not found', 404);
    if (credit.status !== 'OPEN') throw new AppError(credit.status === 'RECEIVED' ? 'This credit was already received.' : 'This credit was already written off.', 409);
    const settled = await tx.supplierCredit.update({ where: { id }, data: { status: input.status, settledAt: new Date(), settledById: userId,
      notes: [credit.notes, input.notes].filter(Boolean).join('\n').slice(0, 4000) || null }, include: { supplier: { select: { id: true, name: true } } } });
    await tx.activityLog.create({ data: { userId, locationId, action: 'SUPPLIER_CREDIT_SETTLED', entity: 'SupplierCredit', entityId: id,
      details: { status: input.status, amount: Number(credit.amount) } } });
    return { ...settled, amount: Number(settled.amount) };
  });
}

/** Cost changes recorded at receiving for one supplier (newest first), and its fill rate: units accepted ÷ units ordered on closed orders. */
export async function supplierCostHistory(db: Db, supplierId: string, limit = 10) {
  const changes = await db.purchaseReceiptItem.findMany({
    where: { previousUnitCost: { not: null }, unitCost: { not: null }, receipt: { purchaseOrder: { supplierId } } },
    orderBy: [{ receipt: { createdAt: 'desc' } }, { id: 'desc' }], take: 50,
    select: { previousUnitCost: true, unitCost: true, receipt: { select: { createdAt: true, invoiceNumber: true } },
      purchaseOrderItem: { select: { productId: true, productName: true } } },
  });
  const costChanges = changes.filter(row => !row.previousUnitCost!.toDecimalPlaces(4).equals(row.unitCost!.toDecimalPlaces(4))).slice(0, limit).map(row => ({
    productId: row.purchaseOrderItem.productId, productName: row.purchaseOrderItem.productName, receivedAt: row.receipt.createdAt,
    invoiceNumber: row.receipt.invoiceNumber, previousUnitCost: Number(row.previousUnitCost!.toDecimalPlaces(4)), unitCost: Number(row.unitCost!.toDecimalPlaces(4)),
    percentChange: row.previousUnitCost!.isZero() ? null : Number(row.unitCost!.minus(row.previousUnitCost!).div(row.previousUnitCost!).mul(100).toDecimalPlaces(1)),
  }));
  const items = await db.purchaseOrderItem.aggregate({ where: { purchaseOrder: { supplierId, status: 'RECEIVED' } }, _sum: { quantity: true, receivedQty: true } });
  const ordered = items._sum.quantity || 0;
  return { costChanges, fillRate: ordered ? Math.round((items._sum.receivedQty || 0) / ordered * 1000) / 10 : null };
}
