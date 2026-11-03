import { Prisma, CostStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { AuthRequest } from '../types';
import { AppError } from '../utils/errorHandler';
import { recordOperation } from './operationReceipt.service';
import { cents, lockDrawer, postDrawerEntry } from './drawer.service';
import { lockInventory, moveInventory } from './inventory.service';
import { postNonstockCost } from './inventoryCost.service';
import { generateSaleNumber } from '../utils/saleNumber';
import { nextDocumentSequence } from './documentNumber.service';
import { lineMoney } from '../utils/moneyNumbers';
import { queueWebhook } from './webhook.service';
import { queueLowStockEmails } from './queuedEmail.service';

export async function lockOfflineCheckout(tx: Prisma.TransactionClient, localId: string) {
  await tx.$queryRaw`SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtext(${'offline:' + localId}))`;
}
export async function offlineDisposition(tx: Prisma.TransactionClient, locationId: string, localId: string, includeHolds = false) {
  const receipts = await tx.operationReceipt.findMany({ where: { locationId, kind: 'OFFLINE_RECONCILIATION', targetId: localId }, select: { result: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
  const results = receipts.map(row => row.result as Record<string, unknown>);
  return results.find(result => result.status === 'FINAL') || (includeHolds ? results.find(result => result.status === 'HOLD') : undefined);
}
const amount = z.number().finite().nonnegative().max(999999999.99).refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 0.00001, 'Use whole cents');
const line = z.object({ productId: z.string().min(1).max(100), sku: z.string().min(1).max(100), productName: z.string().min(1).max(200), quantity: z.number().int().min(1).max(100000),
  price: z.number().finite().nonnegative().max(999999).refine(value => Math.abs(value * 10000 - Math.round(value * 10000)) < 0.00001), discount: amount, tax: amount, total: amount,
  pointsEarned: z.number().int().min(0).max(1000000) }).strict();
export async function reconcileOfflineCheckout(req: AuthRequest) {
  if (!req.user?.locationId || !['ADMIN', 'MANAGER'].includes(req.user.role)) throw new AppError('A store manager or owner must reconcile register payments', 403);
  const input = z.object({ idempotencyKey: z.string().uuid(), localId: z.string().uuid(), cashierId: z.string().min(1).max(100),
    kind: z.enum(['CASH', 'TERMINAL']), disposition: z.enum(['MATCH_RECORDED', 'NOT_COLLECTED', 'EXTERNAL_REVERSAL', 'BOOK_CASH', 'HOLD']),
    createdAt: z.string().datetime(), total: amount, originalShiftId: z.string().min(1).max(100).optional(),
    customerId: z.string().uuid().optional(), matchedSaleId: z.string().uuid().optional(),
    reason: z.string().trim().min(1).max(500), reference: z.string().trim().min(1).max(150), confirmed: z.literal(true),
    references: z.array(z.string().min(1).max(200)).max(20).default([]),
    receipt: z.object({ subtotal: amount, tax: amount, discount: amount, amountPaid: amount, changeDue: amount,
      pointsEarned: z.number().int().min(0).max(1000000), items: z.array(line).min(1).max(100), ageVerified: z.boolean() }).strict().optional(),
  }).strict().parse(req.body);
  const at = new Date(input.createdAt);
  if (at > new Date()) throw new AppError('Original checkout time cannot be in the future', 400);
  if (input.kind === 'TERMINAL' && ['BOOK_CASH', 'NOT_COLLECTED'].includes(input.disposition)) throw new AppError('Confirm terminal settlement with the provider; do not relabel an accepted payment as cash or uncollected', 400);
  return recordOperation(req, 'OFFLINE_RECONCILIATION', input.localId, input.idempotencyKey, input, async tx => {
    await lockOfflineCheckout(tx, input.localId);
    if (await offlineDisposition(tx, req.user!.locationId!, input.localId)) throw new AppError('This checkout already has a final disposition. Review reconciliation history.', 409);
    // Historical staff may be inactive or transferred; the original shift still
    // proves their store assignment. Current assignment alone cannot prove it.
    const cashier = await tx.user.findUnique({ where: { id: input.cashierId }, select: { id: true, firstName: true, lastName: true, locationId: true } });
    const shift = input.originalShiftId ? await tx.shift.findFirst({ where: { id: input.originalShiftId, userId: input.cashierId, locationId: req.user!.locationId! } }) : null;
    if (!cashier || (!shift && cashier.locationId !== req.user!.locationId)) throw new AppError('Original cashier/store attribution could not be verified', 400);
    const existing = await tx.sale.findUnique({ where: { idempotencyKey: input.localId }, include: { payments: true, items: true } });
    let saleId: string | null = null, saleNumber: string | null = null;
    if (input.disposition === 'MATCH_RECORDED') {
      const matched = existing || (input.matchedSaleId ? await tx.sale.findUnique({ where: { id: input.matchedSaleId }, include: { payments: true, items: true } }) : null);
      if (!matched || matched.locationId !== req.user!.locationId || matched.userId !== input.cashierId || cents(Number(matched.total)) !== cents(input.total)) throw new AppError('The recorded sale must match the original store, cashier and amount', 409);
      if (matched.status !== 'COMPLETED' && matched.status !== 'REFUNDED') throw new AppError('The matching sale is not a recorded purchase', 409);
      if (input.kind === 'CASH' && (matched.paymentMethod !== 'CASH' || matched.payments.some(payment => payment.paymentMethod !== 'CASH'))) throw new AppError('The recorded tender does not match this cash checkout', 409);
      if (input.kind === 'TERMINAL' && !matched.payments.some(payment => payment.paymentMethod === 'CARD' && payment.reference && input.references.includes(payment.reference))) throw new AppError('The original terminal reference must match the recorded sale', 409);
      if (Math.abs(matched.createdAt.getTime() - at.getTime()) > 86400000) throw new AppError('The matching sale date requires manual investigation', 409);
      saleId = matched.id; saleNumber = matched.saleNumber;
    } else if (input.disposition !== 'HOLD' && existing) {
      throw new AppError('This checkout is already recorded. Match its sale and use the normal reversal workflow if needed.', 409);
    }
    if (input.disposition === 'BOOK_CASH') {
      if (!shift || !input.receipt) throw new AppError('Booking requires the original cashier shift and verified receipt lines', 400);
      const lockedShift = await lockDrawer(tx, shift.id), receipt = input.receipt;
      if (at < lockedShift.clockInAt || (lockedShift.clockOutAt && at > lockedShift.clockOutAt)) throw new AppError('Original time falls outside the original shift', 400);
      if (new Set(receipt.items.map(item => item.productId)).size !== receipt.items.length) throw new AppError('Combine repeated product lines before review', 400);
      let gross = 0, discount = 0, tax = 0, total = 0;
      for (const item of receipt.items) {
        const itemGross = cents(lineMoney(item.price, item.quantity));
        if (cents(item.discount) > itemGross || itemGross - cents(item.discount) + cents(item.tax) !== cents(item.total)) throw new AppError('Verified line amounts do not reconcile', 400);
        gross += itemGross; discount += cents(item.discount); tax += cents(item.tax); total += cents(item.total);
      }
      if (gross !== cents(receipt.subtotal) || discount !== cents(receipt.discount) || tax !== cents(receipt.tax) || total !== cents(input.total)
        || cents(receipt.amountPaid) - cents(receipt.changeDue) !== total || receipt.amountPaid < input.total) throw new AppError('Receipt totals, tax, discounts and cash change must reconcile exactly', 400);
      if (!input.customerId && receipt.pointsEarned) throw new AppError('Verified earned points require the original customer', 400);
      if (receipt.items.reduce((sum, item) => sum + item.pointsEarned, 0) !== receipt.pointsEarned) throw new AppError('Verified line points must equal the receipt points', 400);
      await lockInventory(tx, receipt.items.map(item => item.productId));
      const products = await tx.product.findMany({ where: { id: { in: receipt.items.map(item => item.productId) }, locationId: req.user!.locationId! } });
      if (products.length !== receipt.items.length) throw new AppError('Every receipt product must be identified at the original store', 400);
      if (products.some(product => product.minimumAge && product.minimumAge > 0) && !receipt.ageVerified) throw new AppError('Verify original age-check evidence before booking restricted merchandise', 400);
      if (input.customerId) {
        await tx.$queryRaw`SELECT id FROM customers WHERE id = ${input.customerId} FOR UPDATE`;
        if (!await tx.customer.findFirst({ where: { id: input.customerId, locationId: req.user!.locationId! } })) throw new AppError('Original customer not found at this store', 404);
      }
      const offlineSaleId = randomUUID();
      const costEntries = new Map<string, { id: string; cogsAmount: Prisma.Decimal | null; costStatus: CostStatus }>();
      const lowStockProducts: { name: string; sku: string; stock: number; threshold: number }[] = [];
      for (const product of products.sort((a, b) => a.id.localeCompare(b.id))) if (product.trackInventory) {
        const updated = await moveInventory(tx, { productId: product.id, locationId: req.user!.locationId!, userId: input.cashierId,
          type: 'SALE', sourceId: offlineSaleId, sourceKey: 'offline-sale:' + input.localId + ':' + product.id, forceUnknown: true, allowNegative: true,
          quantity: -receipt.items.find(item => item.productId === product.id)!.quantity, notes: 'Offline receipt reviewed by ' + req.user!.id });
        costEntries.set(product.id, updated.inventoryEntry);
        if (updated.stockQuantity <= product.lowStockAlert) lowStockProducts.push({ name: product.name, sku: product.sku, stock: updated.stockQuantity, threshold: product.lowStockAlert });
        } else {
          const entry = await postNonstockCost(tx, { productId: product.id, locationId: req.user!.locationId!, userId: input.cashierId,
            sourceId: offlineSaleId, sourceKey: 'offline-sale:' + input.localId + ':' + product.id, kind: 'OFFLINE_SALE',
            quantity: receipt.items.find(item => item.productId === product.id)!.quantity, cost: null });
          costEntries.set(product.id, { id: entry.id, cogsAmount: null, costStatus: 'UNKNOWN' });
      }
      const store = await tx.location.findUniqueOrThrow({ where: { id: req.user!.locationId! }, select: { timezone: true } });
      const sale = await tx.sale.create({ data: { id: offlineSaleId, saleNumber: generateSaleNumber(at, store.timezone, await nextDocumentSequence(tx)), idempotencyKey: input.localId, userId: input.cashierId,
        locationId: req.user!.locationId!, shiftId: shift.id, customerId: input.customerId, createdAt: at, completedAt: at,
        pricingVersion: 1, pointsEarned: receipt.pointsEarned, pointsRedeemed: 0, loyaltyDiscount: 0, paymentMethod: 'CASH',
        subtotal: receipt.subtotal, discount: receipt.discount, tax: receipt.tax, total: input.total, amountPaid: receipt.amountPaid, changeDue: receipt.changeDue,
        notes: 'Manager-booked original offline receipt: ' + input.reference,
        payments: { create: { paymentMethod: 'CASH', amount: receipt.amountPaid } },
        items: { create: receipt.items.map(item => { const cost = costEntries.get(item.productId)!; return { ...item,
          // Today's average estimates the original receipt's cost; it is flagged, not verified.
          unitCost: cost.cogsAmount === null ? null : cost.cogsAmount.div(item.quantity).toDecimalPlaces(4), costAmount: cost.cogsAmount,
          costStatus: cost.costStatus, inventoryEntryId: cost.id, taxRate: null, taxTreatment: 'VERIFIED_OFFLINE_RECEIPT',
          manualDiscount: item.discount, loyaltyDiscount: 0, surcharge: 0, pointsRedeemed: 0 }; }) } } });
      await postDrawerEntry(tx, { sourceKey: 'sale:' + sale.id, shiftId: shift.id, locationId: req.user!.locationId!, userId: input.cashierId, saleId: sale.id, type: 'SALE', amount: input.total, createdAt: at });
      await tx.shift.update({ where: { id: shift.id }, data: { totalSales: { increment: input.total }, totalTransactions: { increment: 1 },
        ...(lockedShift.isClosed ? { expectedCash: { increment: input.total }, cashDifference: { decrement: input.total } } : {}) } });
      if (input.customerId) {
        const customer = await tx.customer.findUniqueOrThrow({ where: { id: input.customerId } });
        await tx.customer.update({ where: { id: input.customerId }, data: { totalSpent: { increment: input.total }, visitCount: { increment: 1 },
          loyaltyPoints: { increment: receipt.pointsEarned }, ...(!customer.lastVisitAt || customer.lastVisitAt < at ? { lastVisitAt: at } : {}) } });
      }
      if (receipt.ageVerified && products.some(product => product.minimumAge)) await tx.ageVerificationLog.create({ data: {
        userId: input.cashierId, locationId: req.user!.locationId!, minimumAge: Math.max(...products.map(product => product.minimumAge || 0)),
        method: 'MANAGER_RECONCILIATION', productNames: receipt.items.map(item => item.productName), approved: true, createdAt: at,
      } });
      await queueLowStockEmails(tx, sale.locationId!, sale.id, lowStockProducts);
      for (const product of lowStockProducts) await queueWebhook(tx, 'product.low_stock', product, sale.id + ':' + product.sku, sale.locationId, sale.createdAt);
      await queueWebhook(tx, 'sale.completed', { id: sale.id, saleNumber: sale.saleNumber, total: sale.total, subtotal: sale.subtotal,
        tax: sale.tax, discount: sale.discount, surcharge: sale.surcharge, paymentMethod: sale.paymentMethod, customerId: sale.customerId,
        itemCount: receipt.items.length, createdAt: sale.createdAt }, sale.id, sale.locationId, sale.createdAt);
      saleId = sale.id; saleNumber = sale.saleNumber;
    }
    return { localId: input.localId, kind: input.kind, disposition: input.disposition, status: input.disposition === 'HOLD' ? 'HOLD' : 'FINAL',
      cashierId: input.cashierId, cashierName: cashier.firstName + ' ' + cashier.lastName, originalShiftId: input.originalShiftId || null,
      originalCreatedAt: at, amount: input.total, saleId, saleNumber, references: input.references, reason: input.reason, reference: input.reference,
      verifiedReceipt: input.receipt || null, recordedAt: new Date(), historicalCostKnown: false };
  });
}
