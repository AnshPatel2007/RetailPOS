import { lineMoney, formatUnitPrice, toCents } from '../utils/moneyNumbers';
import { lockInventory, moveInventory } from '../services/inventory.service';
import { saleCost, postNonstockCost } from '../services/inventoryCost.service';
import { randomUUID } from 'crypto';
import { lockDrawer, postDrawerEntry, saleTenderAmounts, dollars } from '../services/drawer.service';
import { allocateSale } from '../services/saleAllocation.service';
import { priceSaleItems } from '../services/salePricing.service';
import { resolveSellableProducts, sellPackages } from '../services/productSellingUnit.service';
import { checkoutTotals } from '../services/checkoutTotals.service';
import { assertCheckoutTendersAvailable, assertConfiguredTenders } from '../services/tenderAvailability.service';
import { publicStoreSettings } from '../validators/storeSettings.validator';
import { z } from 'zod';
import { requireTransactionApproval } from '../services/managerApproval.service';
import { Response } from 'express';
import { asyncHandler, AppError } from '../utils/errorHandler';
import { AuthRequest } from '../types';
import prisma from '../config/database';
import { logger } from '../utils/logger';
import { PaymentMethod, SaleStatus, Prisma, CostStatus } from '@prisma/client';
import { refundSaleInTransaction, voidSaleInTransaction } from '../services/saleReversal.service';
import { bulkVoid } from '../services/bulkVoid.service';
import { bulkRefund, previewBulkRefund } from '../services/bulkRefund.service';
import { generateSaleNumber } from '../utils/saleNumber';
import { nextDocumentSequence } from '../services/documentNumber.service';
import { getReportCalendar } from '../services/reportDates.service';
import { assertOwnsRecord, assertCanReadRecord } from '../utils/locationFilter.util';
import { createDateFilter } from '../utils/dateFilter.util';
import { isPromotionActiveNow } from '../utils/promotionEngine';
import { queueWebhook } from '../services/webhook.service';
import { queueLowStockEmails, queueEmail, emailContentKey, EmailPayload } from '../services/queuedEmail.service';
import { businessConfig } from '../config/business.config';
import { config } from '../config';
import { lockOfflineCheckout, offlineDisposition } from '../services/offlineReconciliation.service';
import {getRefundTenderOptions} from '../services/refundTenders.service';

function calculateLoyaltyTier(points: number): string {
  const tiers = businessConfig.customer.loyaltyTiers;
  if (points >= tiers.GOLD.min) return 'GOLD';
  if (points >= tiers.SILVER.min) return 'SILVER';
  return 'BRONZE';
}

/**
 * Create sale
 * POST /api/sales
 */
export const createSale = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { customerId, items, paymentMethod, amountPaid, notes, receiptEmail, payments, pointsRedeemed, idempotencyKey, ageVerification, offlineCreatedAt, offlineShiftId, expectedTotal } = req.body;

  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  // Idempotency check — return existing sale if key already used
  if (idempotencyKey) {
    const existing = await prisma.sale.findUnique({
      where: { idempotencyKey },
      include: { items: { include: { product: true } }, payments: true, customer: true, user: { select: { id: true, firstName: true, lastName: true } } },
    });
    if (existing) {
      assertOwnsRecord(req, existing.locationId);
      if (existing.userId !== req.user.id) throw new AppError('Checkout belongs to another cashier', 403);
      res.status(200).json({ success: true, data: existing });
      return;
    }
  }

  assertCheckoutTendersAvailable({ paymentMethod, payments });
  const saleTime = offlineCreatedAt ? new Date(offlineCreatedAt) : new Date();
  if (isNaN(saleTime.getTime()) || saleTime.getTime() > Date.now() + 60000) throw new AppError('Invalid checkout time', 400);
  if (offlineCreatedAt && (!offlineShiftId || !idempotencyKey || typeof expectedTotal !== 'number' || paymentMethod !== 'CASH' || pointsRedeemed || payments?.some((p: any) => p.paymentMethod !== 'CASH'))) {
    throw new AppError('Offline sales require the original shift, checkout key, total and cash-only payment without loyalty redemption', 400);
  }
  const currentShift = await prisma.shift.findFirst({
    where: { userId: req.user.id, locationId: req.user.locationId, ...(offlineCreatedAt ? { id: offlineShiftId } : { isClosed: false }) },
    orderBy: { clockInAt: 'desc' },
  });
  if (!currentShift) throw new AppError('You must clock in before creating a sale', 400);
  if (req.body.expectedShiftId && currentShift.id !== req.body.expectedShiftId) {
    throw new AppError('The original drawer session has changed. This payment requires manager reconciliation; do not charge the customer again.', 409);
  }
  if (offlineCreatedAt && (saleTime < currentShift.clockInAt || (currentShift.clockOutAt && saleTime > currentShift.clockOutAt))) {
    throw new AppError('Checkout time is outside the original shift', 400);
  }

  // Separate misc items (no real productId) from regular items
  const regularItems = items.filter((item: any) => item.productId && !item.productId.startsWith('misc-'));
  const miscItems = items.filter((item: any) => !item.productId || item.productId.startsWith('misc-'));

  // Batch-fetch all real products at once (avoids N+1 queries) — scoped to the
  // cashier's own store so a cart can't reference (and corrupt the stock of)
  // another store's product
  // A line may name a pack (e.g. a 12-pack barcode); it resolves to its
  // product, and stock moves in that product's base units.
  const productIds = regularItems.map((item: any) => item.productId);
  const products = await resolveSellableProducts(prisma, { locationId: req.user.locationId!, ids: productIds, includeInactive: true });
  const productMap = new Map<string, any>(products.map(p => [p.id, p]));
  const inventoryProductIds = regularItems.map((item: any) => productMap.get(item.productId)?.inventoryProductId ?? item.productId);

  // Find or create a MISC product for ad-hoc items — one per store, since
  // Product.sku is now only unique per-location
  let miscProduct: any = null;
  if (miscItems.length > 0) {
    miscProduct = await prisma.product.findFirst({
      where: { sku: 'MISC-001', locationId: req.user!.locationId },
    });
    if (!miscProduct) {
      miscProduct = await prisma.product.create({
        data: {
          sku: 'MISC-001',
          name: 'Misc Item',
          description: 'Miscellaneous / ad-hoc item',
          cost: 0,
          price: 0,
          stockQuantity: 0,
          lowStockAlert: 0,
          trackInventory: false,
          isTaxable: true,
          locationId: req.user!.locationId,
        },
      });
    }
  }

  // Pre-validate items exist (early fail before transaction)
  for (const item of regularItems) {
    if (!productMap.has(item.productId)) {
      throw new AppError(`Product not found: ${item.productId}. It may have been deleted.`, 404);
    }
  }

  // Age-restricted items require a verification record — the register must have
  // checked ID (or DOB, or visually confirmed) before this sale can complete.
  // Every verification is logged for compliance audits.
  const restrictedProducts = regularItems
    .map((item: any) => productMap.get(item.productId))
    .filter((p: any) => p && p.minimumAge && p.minimumAge > 0);

  let ageVerificationRecord: {
    minimumAge: number;
    method: string;
    birthDate: Date | null;
    productNames: string[];
  } | null = null;

  if (restrictedProducts.length > 0) {
    const requiredAge = Math.max(...restrictedProducts.map((p: any) => p.minimumAge));

    if (!ageVerification || !ageVerification.method) {
      throw new AppError(
        `Age verification required: cart contains item(s) restricted to ${requiredAge}+`,
        400
      );
    }

    let birthDate: Date | null = null;
    if (ageVerification.method !== 'VISUAL') {
      if (!ageVerification.birthDate) {
        throw new AppError('Birth date is required for ID scan / manual verification', 400);
      }
      birthDate = new Date(ageVerification.birthDate);
      if (isNaN(birthDate.getTime())) {
        throw new AppError('Invalid birth date', 400);
      }
      const now = saleTime;
      let age = now.getFullYear() - birthDate.getFullYear();
      const beforeBirthday =
        now.getMonth() < birthDate.getMonth() ||
        (now.getMonth() === birthDate.getMonth() && now.getDate() < birthDate.getDate());
      if (beforeBirthday) age -= 1;

      if (age < requiredAge) {
        // Log the failed check too — declined-sale evidence matters in audits
        await prisma.ageVerificationLog.create({
          data: {
            userId: req.user.id,
            locationId: req.user.locationId,
            minimumAge: requiredAge,
            method: ageVerification.method,
            birthDate,
            productNames: restrictedProducts.map((p: any) => p.name),
            approved: false,
          },
        });
        throw new AppError(
          `Customer is ${age} — must be ${requiredAge} or older for item(s) in this sale`,
          400
        );
      }
    }

    ageVerificationRecord = {
      minimumAge: requiredAge,
      method: ageVerification.method,
      birthDate,
      productNames: restrictedProducts.map((p: any) => p.name),
    };
  }

  // Track products that drop below low-stock threshold
  const lowStockProducts: { name: string; sku: string; stock: number; threshold: number }[] = [];

  // Active promotions for this location — the server recomputes promo discounts
  // itself rather than trusting anything the register sends
  const promotionRows = await prisma.promotion.findMany({
    where: {
      isActive: true,
      locationId: req.user.locationId,
    },
  });
  const activePromotions = promotionRows.filter((p) => isPromotionActiveNow(p, saleTime));

  // Split payments must add up to the amount paid
  if (payments && payments.length > 0) {
    const paymentsSum = Math.round(payments.reduce((sum: number, p: { amount: number }) => sum + p.amount, 0) * 100) / 100;
    if (toCents(paymentsSum) !== toCents(amountPaid)) {
      throw new AppError(
        `Split payments sum to $${paymentsSum.toFixed(2)} but amount paid is $${amountPaid.toFixed(2)}`,
        400
      );
    }
  }

  const saleInclude = {
    items: { include: { product: true } },
    payments: true,
    customer: true,
    user: { select: { id: true, firstName: true, lastName: true } },
  } as const;

  const saleCalendar = await getReportCalendar({ locationId: req.user.locationId || undefined }, saleTime);
  // Preserve the checkout's store date across retries, including offline uploads.
  let sale: any, replayed = false;
  for (let attempt = 1; ; attempt++) {
    const saleNumber = generateSaleNumber(saleTime, saleCalendar.timezone, await nextDocumentSequence());
    try {
  // Create sale with transaction — re-fetch products inside to prevent race conditions
  sale = await prisma.$transaction(async (tx) => {
    if (idempotencyKey) {
      await lockOfflineCheckout(tx, idempotencyKey);
      const recorded = await tx.sale.findUnique({ where: { idempotencyKey }, include: saleInclude });
      if (recorded) {
        assertOwnsRecord(req, recorded.locationId);
        if (recorded.userId !== req.user!.id) throw new AppError('Checkout belongs to another cashier', 403);
        replayed = true;
        return recorded;
      }
      if (await offlineDisposition(tx, req.user!.locationId!, idempotencyKey, true)) throw new AppError('This checkout is held or reconciled by a manager. Review its recorded disposition before saving or taking another payment.', 409);
    }
    const lockedShift = await lockDrawer(tx, currentShift.id);
    if (lockedShift.userId !== req.user!.id || lockedShift.locationId !== req.user!.locationId) throw new AppError('Shift does not belong to this register session', 403);
    if (lockedShift.isClosed && !offlineCreatedAt) throw new AppError('Your shift has closed. Clock in again before charging this sale.', 409);
    if (offlineCreatedAt && (saleTime < lockedShift.clockInAt || (lockedShift.clockOutAt && saleTime > lockedShift.clockOutAt))) throw new AppError('Checkout time is outside the original shift', 400);
    // Use one lock order for sales and reversals: drawer, products, customer, tenders.
    // Price/stock/loyalty checks below must use facts protected until commit.
    await lockInventory(tx, inventoryProductIds);
    if (customerId) {
      await tx.$queryRaw`SELECT id FROM customers WHERE id = ${customerId} FOR UPDATE`;
      const customer = await tx.customer.findUnique({ where: { id: customerId }, select: { locationId: true, isActive: true } });
      if (!customer) throw new AppError('Customer not found', 404);
      assertCanReadRecord(req, customer.locationId);
      if (!customer.isActive) throw new AppError('This customer is inactive', 400);
    }
    // Re-fetch all products INSIDE transaction for accurate stock — scoped to
    // the cashier's own store, same as the pre-check fetch above
    const freshProducts = regularItems.length > 0
      ? await resolveSellableProducts(tx, { locationId: req.user!.locationId!, ids: productIds, includeInactive: true })
      : [];
    const freshProductMap = new Map<string, any>(freshProducts.map(p => [p.id, p]));

    // Evaluate permission against the same product facts used for pricing.
    const needsApproval = items.some((item: any) => item.discount > 0 || (item.priceOverride && !freshProductMap.get(item.productId)?.priceEmbedded && !item.productId.startsWith('misc-')));
    if (needsApproval) await requireTransactionApproval(req, tx, 'checkout.override');

    const currentLocation = await tx.location.findUniqueOrThrow({ where: { id: req.user!.locationId! }, select: { taxRate: true, cardSurchargePercent: true, settings: true, isActive: true } });
    if (!currentLocation.isActive) throw new AppError('This store is inactive', 409);
    let { subtotal, totalTax, totalDiscount, total, itemsWithDetails } = priceSaleItems(items, freshProductMap, miscProduct, activePromotions, Number(currentLocation.taxRate), true);

    const pointBalance = customerId
      ? await tx.customer.findUnique({ where: { id: customerId }, select: { loyaltyPoints: true } }) : null;
    const settlement = checkoutTotals({ total, totalDiscount }, { customerId, pointsRedeemed, paymentMethod, payments }, pointBalance?.loyaltyPoints ?? null, Number(currentLocation.cardSurchargePercent));
    assertConfiguredTenders({ paymentMethod, payments }, currentLocation.settings, settlement.total);
    total = settlement.total;
    totalDiscount = settlement.totalDiscount;
    const { loyaltyDiscount, redeemedPoints, surcharge, earnedPoints } = settlement;
    const saleId = randomUUID();
    const allocatedItems = allocateSale(itemsWithDetails, loyaltyDiscount, redeemedPoints, surcharge, earnedPoints)
      .map(line => ({ ...line,
        // A queued offline sale has no trusted historical cost quote. Today's
        // cost cannot establish its cost at the earlier sale time.
        id: randomUUID(), unitCost: null as number | null,
        costAmount: null as Prisma.Decimal | null, inventoryEntryId: null as string | null, costStatus: 'UNKNOWN' as CostStatus,
        discount: Math.round((line.discount + line.loyaltyDiscount) * 100) / 100,
      }));
    if (typeof expectedTotal === 'number' && Math.abs(total - expectedTotal) > 0.005) {
      throw new AppError(offlineCreatedAt ? 'Queued sale total differs from current pricing. Manager reconciliation is required; sale remains queued.' : 'Prices or tax changed. Reopen checkout to review the current total before taking payment.', 409);
    }
    const changeDue = Math.round((amountPaid - total) * 100) / 100;

    if (toCents(amountPaid) < toCents(total)) {
      throw new AppError(
        `Insufficient payment: received $${amountPaid.toFixed(2)} but total is $${total.toFixed(2)}${surcharge > 0 ? ` (includes $${surcharge.toFixed(2)} card surcharge)` : ''}. Short by $${(total - amountPaid).toFixed(2)}`,
        400
      );
    }



    // Build split payment records if provided. For the single-payment fallback,
    // non-cash tenders are charged the sale total — change is never drawn from a
    // gift card or store credit balance.
    const paymentRecords: { paymentMethod: PaymentMethod; amount: number; reference: string | null }[] =
      payments && payments.length > 0
        ? payments.map((p: { paymentMethod: string; amount: number; reference?: string }) => ({
            paymentMethod: p.paymentMethod as PaymentMethod,
            amount: Math.round(p.amount * 100) / 100,
            reference: p.reference || null,
          }))
        : [{
            paymentMethod: paymentMethod as PaymentMethod,
            amount: paymentMethod === 'CASH'
              ? Math.round(amountPaid * 100) / 100
              : Math.min(Math.round(amountPaid * 100) / 100, total),
            reference: null,
          }];

    if (paymentRecords.some(payment => payment.amount === 0 && (total > 0 || payment.paymentMethod !== 'CASH'))) throw new AppError('Zero payment entries are only valid for a fully paid points purchase with cash settlement', 400);
    const cardReferences = paymentRecords.filter(payment => payment.paymentMethod === 'CARD' && payment.reference?.trim()).map(payment => payment.reference!.trim());
    if (new Set(cardReferences).size !== cardReferences.length) throw new AppError('A terminal approval cannot be counted twice in the same sale.', 400);
    // Create sale
    const cashTender = paymentRecords.filter(p => p.paymentMethod === 'CASH').reduce((sum, p) => sum + p.amount, 0);
    if (changeDue > 0.005 && cashTender + 0.005 < changeDue) throw new AppError('Change cannot exceed the cash tendered. Correct the payment amounts before charging.', 400);
    // Record stock and cost together before creating immutable sale snapshots.
    // The enclosing transaction rolls both back if any later tender check fails.
    for (const line of [...allocatedItems].sort((a, b) => a.productId.localeCompare(b.productId))) {
      const product = await tx.product.findUnique({ where: { id: line.productId } });
      if (!product) throw new AppError('Product is unavailable', 409);
      if (product.trackInventory) {
        // A pack sale uses an unopened pack when the records have one.
        if (line.sellingUnitId) await sellPackages(tx, { productId: product.id, locationId: req.user!.locationId!, sellingUnitId: line.sellingUnitId, quantity: line.quantity, userId: req.user!.id, sourceId: saleId });
        const updated = await moveInventory(tx, { productId: product.id, locationId: req.user!.locationId!, userId: req.user!.id,
          type: 'SALE', sourceId: saleId, sourceKey: 'sale-line:' + line.id, quantity: -(line.inventoryQuantity ?? line.quantity), forceUnknown: !!offlineCreatedAt, allowNegative: true });
        line.inventoryEntryId = updated.inventoryEntry.id;
        line.costAmount = updated.inventoryEntry.cogsAmount;
        line.costStatus = updated.inventoryEntry.costStatus;
        if (updated.stockQuantity <= product.lowStockAlert && product.stockQuantity > product.lowStockAlert)
          lowStockProducts.push({ name: product.name, sku: product.sku, stock: updated.stockQuantity, threshold: product.lowStockAlert });
      } else {
        line.costAmount = offlineCreatedAt ? null : await saleCost(tx, product, line.quantity);
        const entry = await postNonstockCost(tx, { productId: product.id, locationId: req.user!.locationId!, userId: req.user!.id,
          sourceId: saleId, sourceKey: 'sale-line:' + line.id, kind: 'SALE', quantity: line.quantity, cost: line.costAmount });
        line.inventoryEntryId = entry.id;
        line.costStatus = line.costAmount === null ? 'UNKNOWN' : 'VERIFIED';
      }
      line.unitCost = line.costAmount === null ? null : line.costAmount.div(line.quantity).toDecimalPlaces(4).toNumber();
    }
    const newSale = await tx.sale.create({
      data: {
        saleNumber,
        pricingVersion: 1, pointsEarned: earnedPoints, pointsRedeemed: redeemedPoints, loyaltyDiscount,
        createdAt: saleTime,
        id: saleId,
        customerId,
        userId: req.user!.id,
        locationId: req.user!.locationId,
        shiftId: currentShift?.id,
        idempotencyKey: idempotencyKey || null,
        subtotal,
        tax: totalTax,
        discount: totalDiscount,
        surcharge,
        total,
        paymentMethod: paymentMethod as PaymentMethod,
        amountPaid,
        changeDue,
        status: SaleStatus.COMPLETED,
        notes,
        receiptEmail,
        completedAt: saleTime,
        items: {
          create: allocatedItems,
        },
        payments: {
          create: paymentRecords,
        },
      },
      include: {
        items: {
          include: {
            product: true,
          },
        },
        payments: true,
        customer: true,
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    // Log the age verification against this sale (compliance audit trail)
    if (ageVerificationRecord) {
      await tx.ageVerificationLog.create({
        data: {
          saleId: newSale.id,
          userId: req.user!.id,
          locationId: req.user!.locationId,
          minimumAge: ageVerificationRecord.minimumAge,
          method: ageVerificationRecord.method,
          birthDate: ageVerificationRecord.birthDate,
          productNames: ageVerificationRecord.productNames,
          approved: true,
        },
      });
    }

    // Count each applied promotion once per sale
    const usedPromotionIds = [
      ...new Set(itemsWithDetails.map((i: any) => i.promotionId).filter(Boolean)),
    ] as string[];
    if (usedPromotionIds.length > 0) {
      await tx.promotion.updateMany({
        where: { id: { in: usedPromotionIds } },
        data: { timesUsed: { increment: 1 } },
      });
    }

    // Debit gift card / store credit balances for those payment methods.
    // This validates the tender actually exists and has funds.
    for (const payment of [...paymentRecords].sort((a, b) => (a.paymentMethod + ':' + (a.reference || '')).localeCompare(b.paymentMethod + ':' + (b.reference || '')))) {
      if (payment.amount <= 0) continue;

      if (payment.paymentMethod === 'GIFT_CARD') {
        if (!payment.reference) {
          throw new AppError('Gift card number is required for gift card payments', 400);
        }
        await tx.$queryRaw`SELECT id FROM gift_cards WHERE code = ${payment.reference} OR id = ${payment.reference} FOR UPDATE`;
        const card = await tx.giftCard.findFirst({
          where: { OR: [{ code: payment.reference }, { id: payment.reference }] },
        });
        if (!card) throw new AppError(`Gift card not found: ${payment.reference}`, 400);
        assertCanReadRecord(req, card.locationId);
        if (!card.isActive) throw new AppError('Gift card is deactivated', 400);
        if (card.expiresAt && card.expiresAt < new Date()) throw new AppError('Gift card has expired', 400);
        if (Number(card.currentBalance) < payment.amount - 0.001) {
          throw new AppError(
            `Insufficient gift card balance: $${card.currentBalance.toFixed(2)} available, $${payment.amount.toFixed(2)} required`,
            400
          );
        }
        await tx.giftCard.update({
          where: { id: card.id },
          data: {
            currentBalance: { decrement: payment.amount },
            transactions: {
              create: {
                type: 'REDEEM',
                amount: -payment.amount,
                balanceBefore: card.currentBalance,
                balanceAfter: Math.round((Number(card.currentBalance) - payment.amount) * 100) / 100,
                saleId: newSale.id,
              },
            },
          },
        });
      }

      if (payment.paymentMethod === 'HOUSE_ACCOUNT') {
        if (!customerId) {
          throw new AppError('A customer must be linked to charge to a house account', 400);
        }
        await tx.$queryRaw`SELECT id FROM house_accounts WHERE "customerId" = ${customerId} FOR UPDATE`;
        const account = await tx.houseAccount.findUnique({ where: { customerId } });
        if (!account || !account.isActive) {
          throw new AppError('This customer has no active house account', 400);
        }
        assertCanReadRecord(req, account.locationId);
        const newBalance = Math.round((Number(account.balance) + payment.amount) * 100) / 100;
        if (newBalance > Number(account.creditLimit) + 0.001) {
          const available = Math.max(0, Math.round((Number(account.creditLimit) - Number(account.balance)) * 100) / 100);
          throw new AppError(
            `House account credit limit exceeded: $${available.toFixed(2)} available of $${account.creditLimit.toFixed(2)} limit`,
            400
          );
        }
        await tx.houseAccount.update({
          where: { id: account.id },
          data: {
            // Store the rounded value — float increments drift over many charges
            balance: newBalance,
            transactions: {
              create: {
                type: 'CHARGE',
                amount: payment.amount,
                balanceBefore: account.balance,
                balanceAfter: newBalance,
                saleId: newSale.id,
                userId: req.user!.id,
              },
            },
          },
        });
      }

      if (payment.paymentMethod === 'STORE_CREDIT') {
        if (!customerId) {
          throw new AppError('A customer must be linked to pay with store credit', 400);
        }
        await tx.$queryRaw`SELECT id FROM store_credit_accounts WHERE "customerId" = ${customerId} FOR UPDATE`;
        const account = await tx.storeCreditAccount.findUnique({ where: { customerId } });
        if (!account) throw new AppError('No store credit account found for this customer', 400);
        assertCanReadRecord(req, account.locationId);
        if (Number(account.balance) < payment.amount - 0.001) {
          throw new AppError(
            `Insufficient store credit: $${account.balance.toFixed(2)} available, $${payment.amount.toFixed(2)} required`,
            400
          );
        }
        await tx.storeCreditAccount.update({
          where: { id: account.id },
          data: {
            balance: { decrement: payment.amount },
            transactions: {
              create: {
                type: 'DEBIT',
                amount: -payment.amount,
                balanceBefore: account.balance,
                balanceAfter: Math.round((Number(account.balance) - payment.amount) * 100) / 100,
                saleId: newSale.id,
              },
            },
          },
        });
      }
    }

    // Update customer stats and loyalty tier
    if (customerId) {
      // Points earned on this sale minus any redeemed
      const pointsEarned = earnedPoints;
      const pointsUsed = redeemedPoints;
      const netPoints = pointsEarned - pointsUsed;

      const updatedCust = await tx.customer.update({
        where: { id: customerId },
        data: {
          totalSpent: { increment: total },
          visitCount: { increment: 1 },
          loyaltyPoints: { increment: netPoints },
          lastVisitAt: new Date(),
        },
      });

      const newTier = calculateLoyaltyTier(updatedCust.loyaltyPoints);
      if (newTier !== updatedCust.loyaltyTier) {
        await tx.customer.update({
          where: { id: customerId },
          data: { loyaltyTier: newTier },
        });
      }
    }

    // Update shift totals
    if (currentShift) {
      const cashKept = dollars(saleTenderAmounts(newSale).CASH || 0);
      await postDrawerEntry(tx, { sourceKey: 'sale:' + newSale.id, shiftId: currentShift.id, locationId: newSale.locationId, userId: req.user!.id, saleId: newSale.id, type: 'SALE', amount: cashKept, createdAt: saleTime });
      await tx.shift.update({
        where: { id: currentShift.id },
        data: {
          totalSales: { increment: total },
          totalTransactions: { increment: 1 },
          ...(offlineCreatedAt && lockedShift.isClosed ? {
            expectedCash: { increment: cashKept }, cashDifference: { decrement: cashKept },
          } : {}),
        },
      });
    }

  // Log activity
  await tx.activityLog.create({
    data: {
      userId: req.user!.id,
      action: 'CREATE',
      entity: 'SALE',
      entityId: newSale.id,
      details: { saleNumber: newSale.saleNumber, total: newSale.total },
      locationId: newSale.locationId,
    },
  });


    await queueLowStockEmails(tx, newSale.locationId!, newSale.id, lowStockProducts);
    for (const product of lowStockProducts) await queueWebhook(tx, 'product.low_stock', product, newSale.id + ':' + product.sku, newSale.locationId, newSale.createdAt);
    await queueWebhook(tx, 'sale.completed', { id: newSale.id, saleNumber: newSale.saleNumber, total: newSale.total, subtotal: newSale.subtotal,
      tax: newSale.tax, discount: newSale.discount, surcharge: newSale.surcharge, paymentMethod: newSale.paymentMethod, customerId: newSale.customerId,
      itemCount: newSale.items.length, createdAt: newSale.createdAt }, newSale.id, newSale.locationId, newSale.createdAt);
    return newSale;
  });
      break;
    } catch (err: any) {
      const uniqueTarget = err?.code === 'P2002' ? String(err?.meta?.target ?? '') : '';
      // Concurrent duplicate submit with the same idempotency key — return the existing sale
      if (uniqueTarget.includes('idempotencyKey') && idempotencyKey) {
        const existing = await prisma.sale.findUnique({ where: { idempotencyKey }, include: saleInclude });
        if (existing) {
          assertOwnsRecord(req, existing.locationId);
          if (existing.userId !== req.user.id) throw new AppError('Checkout belongs to another cashier', 403);
          res.status(200).json({ success: true, data: existing });
          return;
        }
      }
      if (uniqueTarget.includes('saleNumber') && attempt < 4) continue;
      throw err;
    }
  }

  logger.info(`Sale created: ${sale.saleNumber} - Total: $${sale.total}`);

  res.status(replayed ? 200 : 201).json({
    success: true,
    data: sale,
    message: 'Sale completed successfully',
  });
  if (replayed) return;


});

/**
 * Get all sales
 * GET /api/sales
 */
export const getSales = asyncHandler(async (req: AuthRequest, res: Response) => {
  const {
    page = 1,
    limit = 20,
    startDate,
    endDate,
    customerId,
    userId,
    status,
    paymentMethod,
    saleNumber,
  } = req.query;

  const pageNum = parseInt(page as string);
  const limitNum = parseInt(limit as string);
  const skip = (pageNum - 1) * limitNum;

  const where: any = {};

  // Filter by user's location
  if (req.user?.locationId) {
    where.locationId = req.user.locationId;
  }

  const dateFilter = createDateFilter(startDate as string, endDate as string);
  if (dateFilter) {
    where.createdAt = dateFilter;
  }

  if (saleNumber) {
    const reference = String(saleNumber).trim();
    where.saleNumber = /^\d{6,19}$/.test(reference)
      ? { startsWith: 'S-', endsWith: '-' + reference }
      : reference;
  }
  if (customerId) where.customerId = customerId;
  if (userId) where.userId = userId;
  if (status) where.status = status;
  if (paymentMethod) where.paymentMethod = paymentMethod;

  // Cashiers can only see their own sales (override any userId param)
  if (req.user?.role === 'CASHIER') {
    where.userId = req.user.id;
  }

  const [sales, total] = await Promise.all([
    prisma.sale.findMany({
      where,
      include: {
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        items: {
          select: {
            id: true,
            productName: true,
            quantity: true,
            price: true,
            total: true,
          },
        },
      },
      skip,
      take: limitNum,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.sale.count({ where }),
  ]);

  res.json({
    success: true,
    data: sales,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
    },
  });
});

/**
 * Get single sale
 * GET /api/sales/:id
 */
export const getSale = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  const sale = await prisma.sale.findUnique({
    where: { id },
    include: {
      customer: true,
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
        },
      },
      items: {
        include: {
          product: true,
        },
      },
      payments: true,
      location: true,
      refunds: { include: { items: true } },
      voidEvent: true,
    },
  });

  if (!sale) {
    throw new AppError('Sale not found', 404);
  }

  assertCanReadRecord(req, sale.locationId, 'Sale not found');
  let refundTenderOptions:ReturnType<typeof getRefundTenderOptions>=[],refundTenderError:string|null=null;
  try{refundTenderOptions=getRefundTenderOptions(sale);}catch(error){if(error instanceof AppError)refundTenderError=error.message;else throw error;}
  res.json({
    success: true,
    data: {...sale,refundTenderOptions,refundTenderError},
  });
});

/**
 * Refund sale
 * POST /api/sales/:id/refund
 */
export const refundSale = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { sale, refund, replayed } = await prisma.$transaction(tx => refundSaleInTransaction(req, tx));
  res.json({ success: true, data: sale, refund: { id: refund.id, amount: refund.amount, pointsRestored: refund.pointsRestored, pointsReversed: refund.pointsReversed, taxAmount: refund.taxAmount,method:refund.method,reference:refund.reference,tenders:refund.tenders }, replayed, message: replayed ? 'Saved refund confirmed' : 'Sale refunded successfully' });
});

/**
 * Void sale
 * POST /api/sales/:id/void
 */
export const voidSale = asyncHandler(async (req: AuthRequest, res: Response) => {
  const sale = await prisma.$transaction(tx => voidSaleInTransaction(req, tx));
  res.json({ success: true, data: sale, replayed: sale.replayed, message: sale.replayed ? 'Saved void confirmed' : 'Sale voided successfully' });
});

/**
 * Bulk void sales
 * POST /api/sales/bulk-void
 */
export const previewBulkRefundSales = asyncHandler(async (req: AuthRequest, res: Response) => res.json({ success: true, data: await previewBulkRefund(req) }));

export const bulkVoidSales = asyncHandler(async (req: AuthRequest, res: Response) => {
  const result = await bulkVoid(req);
  res.json({ success: true, data: result, replayed: result.replayed, message: result.replayed ? 'Saved bulk void confirmed' : 'Sales voided successfully' });
});

export const bulkRefundSales = asyncHandler(async (req: AuthRequest, res: Response) => {
  res.json({ success: true, ...await bulkRefund(req) });
});


/**
 * Email receipt
 * POST /api/sales/:id/email-receipt
 */
export const emailReceipt = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { email } = req.body;

  if (!z.string().email().max(254).safeParse(email).success) {
    throw new AppError('A valid email address is required', 400);
  }

  const sale = await prisma.sale.findUnique({
    where: { id },
    include: {
      items: { include: { product: true } },
      customer: true,
      user: { select: { firstName: true, lastName: true } },
      location: true,
      payments: true,
    },
  });

  if (!sale) {
    throw new AppError('Sale not found', 404);
  }

  assertCanReadRecord(req, sale.locationId, 'Sale not found');

  const storeName = sale.location?.name || config.app.name || 'POS System';
  const receiptSettings = publicStoreSettings(sale.location?.settings).receiptSettings;

  // HTML-escape helper to prevent XSS in email content
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const itemsHtml = sale.items.map(item =>
    `<tr>
      <td style="padding:4px 0;">${esc(item.productName)}</td>
      <td style="padding:4px 0;text-align:center;">${item.quantity}</td>
      <td style="padding:4px 0;text-align:right;">$${formatUnitPrice(Number(item.price))}</td>
      <td style="padding:4px 0;text-align:right;">$${lineMoney(Number(item.price), item.quantity).toFixed(2)}</td>
    </tr>`
  ).join('');

  const paymentInfo = sale.payments.length > 1
    ? sale.payments.map(p => `${p.paymentMethod}: $${p.amount.toFixed(2)}`).join(', ')
    : sale.paymentMethod;

  const html = `
    <!DOCTYPE html><html><head><style>
      body { font-family: Arial, sans-serif; color: #333; }
      .receipt { max-width: 500px; margin: 0 auto; padding: 20px; }
      .header { text-align: center; border-bottom: 2px solid #4F46E5; padding-bottom: 16px; margin-bottom: 16px; }
      .header h1 { color: #4F46E5; margin: 0; }
      table { width: 100%; border-collapse: collapse; }
      th { text-align: left; border-bottom: 1px solid #ddd; padding: 6px 0; }
      .totals td { padding: 4px 0; }
      .grand-total td { font-size: 18px; font-weight: bold; border-top: 2px solid #333; padding-top: 8px; }
      .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
    </style></head><body>
    <div class="receipt">
      <div class="header">
        <h1>${esc(storeName)}</h1>
        ${receiptSettings?.showAddress !== false && sale.location?.address ? `<p>${esc([sale.location.address, sale.location.city, sale.location.state].filter(Boolean).join(', '))}</p>` : ''}
        ${sale.location?.phone ? `<p>${esc(sale.location.phone)}</p>` : ''}
        ${receiptSettings?.header ? `<p>${esc(receiptSettings.header)}</p>` : ''}
        <p>Receipt #${sale.saleNumber}</p>
        <p>${new Date(sale.createdAt).toLocaleString('en-US', { timeZone: sale.location?.timezone || 'UTC' })}</p>
        ${sale.user ? `<p>Cashier: ${esc(sale.user.firstName)} ${esc(sale.user.lastName)}</p>` : ''}
      </div>
      <table>
        <thead><tr><th>Item</th><th style="text-align:center;">Qty</th><th style="text-align:right;">Price</th><th style="text-align:right;">Total</th></tr></thead>
        <tbody>${itemsHtml}</tbody>
      </table>
      <hr>
      <table class="totals">
        <tr><td>Subtotal</td><td style="text-align:right;">$${sale.subtotal.toFixed(2)}</td></tr>
        ${receiptSettings?.showTaxBreakdown !== false ? `<tr><td>Tax</td><td style="text-align:right;">$${sale.tax.toFixed(2)}</td></tr>` : ''}
        ${Number(sale.discount) > 0 ? `<tr><td>Discount</td><td style="text-align:right;">-$${sale.discount.toFixed(2)}</td></tr>` : ''}
        ${Number(sale.surcharge) > 0 ? `<tr><td>Card Surcharge</td><td style="text-align:right;">$${sale.surcharge.toFixed(2)}</td></tr>` : ''}
        <tr class="grand-total"><td>Total</td><td style="text-align:right;">$${sale.total.toFixed(2)}</td></tr>
        <tr><td>Paid (${paymentInfo})</td><td style="text-align:right;">$${sale.amountPaid.toFixed(2)}</td></tr>
        ${Number(sale.changeDue) > 0 ? `<tr><td>Change</td><td style="text-align:right;">$${sale.changeDue.toFixed(2)}</td></tr>` : ''}
      </table>
      ${sale.customer ? `<p>Customer: ${esc(sale.customer.firstName)} ${esc(sale.customer.lastName)}</p>` : ''}
      <div class="footer"><p>${esc(receiptSettings?.footer ?? 'Thank you for your business!')}</p></div>
    </div>
    </body></html>
  `;

  const payload: EmailPayload = { type: 'RECEIPT', to: email, subject: 'Receipt #' + sale.saleNumber + ' from ' + storeName, html, saleId: sale.id };
  const job = await prisma.$transaction(async tx => {
    await tx.sale.update({ where: { id }, data: { receiptEmail: email } });
    return queueEmail(tx, sale.locationId!, req.user!.id, 'receipt:' + req.user!.id + ':' + sale.id + ':' + emailContentKey(payload), payload);
  });
  res.json({ success: true, data: job, message: 'Receipt queued. Delivery status is available to the store owner.' });
});

// The register obtains current, server-priced totals before collecting payment.
export const quoteSale = asyncHandler(async (req: AuthRequest, res: Response) => {
  const locationId = req.user?.locationId;
  if (!locationId) throw new AppError('Sign in to a store to check out', 400);
  const { items, customerId } = req.body;
  const [location, products, promotions, customer] = await prisma.$transaction(async tx => Promise.all([
    tx.location.findUnique({ where: { id: locationId } }),
    resolveSellableProducts(tx, { locationId, ids: items.filter((i: any) => !i.productId.startsWith('misc-')).map((i: any) => i.productId), includeInactive: true }),
    tx.promotion.findMany({ where: { isActive: true, locationId } }),
    customerId ? tx.customer.findFirst({ where: { id: customerId, locationId, isActive: true }, select: { loyaltyPoints: true } }) : Promise.resolve(null),
  ]), { isolationLevel: 'RepeatableRead' });
  if (!location?.isActive) throw new AppError('Store is unavailable', 400);
  if (customerId && !customer) throw new AppError('Customer is unavailable in this store', 404);
  const activePromotions = promotions.filter(p => isPromotionActiveNow(p, new Date()));
  // A preview may show a proposed override. Committing it requires a manager
  // capability or exact, single-use approval inside the sale transaction.
  const pricing = priceSaleItems(items, new Map<string, any>(products.map(p => [p.id, p])), { id: 'misc', isTaxable: true, trackInventory: false }, activePromotions, Number(location.taxRate), true);
  const settlement = checkoutTotals(pricing, req.body, customer?.loyaltyPoints ?? null, Number(location.cardSurchargePercent));
  // The initial catalog quote has no selected tender yet.
  if (req.body.paymentMethod || req.body.payments?.length) assertConfiguredTenders(req.body, location.settings, settlement.total);
  res.json({ success: true, data: { ...pricing, ...settlement, products, promotions: activePromotions, taxRate: location.taxRate, cardSurchargePercent: location.cardSurchargePercent } });
});
