import { Response } from 'express';
import { asyncHandler, AppError } from '../utils/errorHandler';
import { AuthRequest } from '../types';
import prisma from '../config/database';
import { logger } from '../utils/logger';
import { PaymentMethod, SaleStatus } from '@prisma/client';
import { createDateFilter } from '../utils/dateFilter.util';
import { businessConfig } from '../config/business.config';
import { sendEmail, sendLowStockAlert } from '../utils/email';
import { config } from '../config';

function calculateLoyaltyTier(points: number): string {
  const tiers = businessConfig.customer.loyaltyTiers;
  if (points >= tiers.GOLD.min) return 'GOLD';
  if (points >= tiers.SILVER.min) return 'SILVER';
  return 'BRONZE';
}

/**
 * Generate unique sale number
 */
const generateSaleNumber = async (): Promise<string> => {
  const date = new Date();
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
  const count = await prisma.sale.count({
    where: {
      createdAt: {
        gte: new Date(date.setHours(0, 0, 0, 0)),
      },
    },
  });
  return `SALE-${dateStr}-${(count + 1).toString().padStart(4, '0')}`;
};

/**
 * Create sale
 * POST /api/sales
 */
export const createSale = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { customerId, items, paymentMethod, amountPaid, notes, receiptEmail, payments, pointsRedeemed, idempotencyKey } = req.body;

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
      res.status(200).json({ success: true, data: existing });
      return;
    }
  }

  // Get current shift — required for sale creation
  const currentShift = await prisma.shift.findFirst({
    where: {
      userId: req.user.id,
      isClosed: false,
    },
    orderBy: {
      clockInAt: 'desc',
    },
  });

  if (!currentShift) {
    throw new AppError('You must clock in before creating a sale', 400);
  }

  // Fetch default tax rate once for the whole transaction (not per item)
  const defaultTaxRate = await prisma.taxRate.findFirst({
    where: { isDefault: true, isActive: true },
  });

  // Separate misc items (no real productId) from regular items
  const regularItems = items.filter((item: any) => item.productId && !item.productId.startsWith('misc-'));
  const miscItems = items.filter((item: any) => !item.productId || item.productId.startsWith('misc-'));

  // Batch-fetch all real products at once (avoids N+1 queries)
  const productIds = regularItems.map((item: any) => item.productId);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
  });
  const productMap = new Map(products.map(p => [p.id, p]));

  // Find or create a MISC product for ad-hoc items
  let miscProduct: any = null;
  if (miscItems.length > 0) {
    miscProduct = await prisma.product.findFirst({
      where: { sku: 'MISC-001' },
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

  // Track products that drop below low-stock threshold
  const lowStockProducts: { name: string; sku: string; stock: number; threshold: number }[] = [];

  // Price overrides are only honored for manager+ roles (UI hides the control for
  // cashiers, but the API must enforce it too)
  const canOverridePrice = ['SUPER_ADMIN', 'ADMIN', 'MANAGER'].includes(req.user.role);

  // Split payments must add up to the amount paid
  if (payments && payments.length > 0) {
    const paymentsSum = Math.round(payments.reduce((sum: number, p: { amount: number }) => sum + p.amount, 0) * 100) / 100;
    if (Math.abs(paymentsSum - amountPaid) > 0.01) {
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

  // Sale numbers are count-based, so two registers checking out at the same moment
  // can generate the same number — retry with a fresh number on unique collision.
  let sale: any;
  for (let attempt = 1; ; attempt++) {
    const saleNumber = await generateSaleNumber();
    try {
  // Create sale with transaction — re-fetch products inside to prevent race conditions
  sale = await prisma.$transaction(async (tx) => {
    // Re-fetch all products INSIDE transaction for accurate stock
    const freshProducts = regularItems.length > 0
      ? await tx.product.findMany({ where: { id: { in: productIds } } })
      : [];
    const freshProductMap = new Map(freshProducts.map(p => [p.id, p]));

    // Validate and calculate totals using fresh data
    let subtotal = 0;
    let totalTax = 0;
    let totalDiscount = 0;

    const itemsWithDetails = items.map((item: any) => {
      const isMisc = !item.productId || item.productId.startsWith('misc-');
      const product = isMisc ? miscProduct : freshProductMap.get(item.productId);

      if (!product) {
        throw new AppError(`Product not found: ${item.productId}. It may have been deleted.`, 404);
      }

      if (!isMisc && product.trackInventory && product.stockQuantity < item.quantity) {
        throw new AppError(
          `Insufficient stock for "${product.name}": requested ${item.quantity}, only ${product.stockQuantity} available`,
          400
        );
      }

      // Use the ACTUAL product price from DB, not the frontend-supplied price
      const verifiedPrice = isMisc ? item.price : product.price;
      // Honor the override flag only for manager+ users
      const itemPrice = item.priceOverride && canOverridePrice ? item.price : verifiedPrice;

      const itemSubtotal = itemPrice * item.quantity;
      const itemDiscount = Math.min(item.discount || 0, itemSubtotal); // Discount can't exceed item total
      const itemTotal = itemSubtotal - itemDiscount;

      let itemTax = 0;
      if (product.isTaxable && defaultTaxRate) {
        itemTax = Math.round((itemTotal * defaultTaxRate.rate) / 100 * 100) / 100;
      }

      subtotal += itemSubtotal;
      totalDiscount += itemDiscount;
      totalTax += itemTax;

      return {
        productId: product.id,
        sku: isMisc ? 'MISC' : product.sku,
        productName: isMisc ? (item.name || 'Misc Item') : product.name,
        quantity: item.quantity,
        price: itemPrice,
        discount: itemDiscount,
        tax: itemTax,
        total: itemTotal + itemTax,
        notes: item.notes,
      };
    });

    // Round all monetary values to 2 decimal places
    subtotal = Math.round(subtotal * 100) / 100;
    totalDiscount = Math.round(totalDiscount * 100) / 100;
    totalTax = Math.round(totalTax * 100) / 100;
    let total = Math.round(Math.max(0, subtotal - totalDiscount + totalTax) * 100) / 100;

    // Apply loyalty point redemption as a post-tax discount so the amount due,
    // change, and payment check all reflect what the customer actually owes
    if (pointsRedeemed && pointsRedeemed > 0) {
      if (!customerId) {
        throw new AppError('A customer must be linked to redeem loyalty points', 400);
      }
      const customer = await tx.customer.findUnique({ where: { id: customerId }, select: { loyaltyPoints: true } });
      if (!customer || customer.loyaltyPoints < pointsRedeemed) {
        throw new AppError(
          `Insufficient loyalty points: requested ${pointsRedeemed}, available ${customer?.loyaltyPoints || 0}`,
          400
        );
      }
      const redemptionValue = Math.round(
        Math.min(pointsRedeemed / businessConfig.customer.pointsToDollarRatio, total) * 100
      ) / 100;
      totalDiscount = Math.round((totalDiscount + redemptionValue) * 100) / 100;
      total = Math.round((total - redemptionValue) * 100) / 100;
    }

    const changeDue = Math.round((amountPaid - total) * 100) / 100;

    // Allow 1 cent tolerance for floating point rounding differences
    if (amountPaid < total - 0.01) {
      throw new AppError(
        `Insufficient payment: received $${amountPaid.toFixed(2)} but total is $${total.toFixed(2)}. Short by $${(total - amountPaid).toFixed(2)}`,
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

    // Create sale
    const newSale = await tx.sale.create({
      data: {
        saleNumber,
        customerId,
        userId: req.user!.id,
        locationId: req.user!.locationId,
        shiftId: currentShift?.id,
        idempotencyKey: idempotencyKey || null,
        subtotal,
        tax: totalTax,
        discount: totalDiscount,
        total,
        paymentMethod: paymentMethod as PaymentMethod,
        amountPaid,
        changeDue,
        status: SaleStatus.COMPLETED,
        notes,
        receiptEmail,
        completedAt: new Date(),
        items: {
          create: itemsWithDetails,
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

    // Debit gift card / store credit balances for those payment methods.
    // This validates the tender actually exists and has funds.
    for (const payment of paymentRecords) {
      if (payment.amount <= 0) continue;

      if (payment.paymentMethod === 'GIFT_CARD') {
        if (!payment.reference) {
          throw new AppError('Gift card number is required for gift card payments', 400);
        }
        const card = await tx.giftCard.findFirst({
          where: { OR: [{ code: payment.reference }, { id: payment.reference }] },
        });
        if (!card) throw new AppError(`Gift card not found: ${payment.reference}`, 400);
        if (!card.isActive) throw new AppError('Gift card is deactivated', 400);
        if (card.expiresAt && card.expiresAt < new Date()) throw new AppError('Gift card has expired', 400);
        if (card.currentBalance < payment.amount - 0.001) {
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
                balanceAfter: Math.round((card.currentBalance - payment.amount) * 100) / 100,
                saleId: newSale.id,
              },
            },
          },
        });
      }

      if (payment.paymentMethod === 'STORE_CREDIT') {
        if (!customerId) {
          throw new AppError('A customer must be linked to pay with store credit', 400);
        }
        const account = await tx.storeCreditAccount.findUnique({ where: { customerId } });
        if (!account) throw new AppError('No store credit account found for this customer', 400);
        if (account.balance < payment.amount - 0.001) {
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
                balanceAfter: Math.round((account.balance - payment.amount) * 100) / 100,
                saleId: newSale.id,
              },
            },
          },
        });
      }
    }

    // Update inventory (skip misc items) — uses fresh product data
    for (const item of regularItems) {
      const product = freshProductMap.get(item.productId);

      if (product?.trackInventory) {
        const newQty = product.stockQuantity - item.quantity;

        // Conditional decrement guards against overselling when two registers
        // sell the same last units concurrently
        const decremented = await tx.product.updateMany({
          where: { id: item.productId, stockQuantity: { gte: item.quantity } },
          data: {
            stockQuantity: {
              decrement: item.quantity,
            },
          },
        });
        if (decremented.count === 0) {
          throw new AppError(
            `Insufficient stock for "${product.name}" — it may have just been sold on another register`,
            400
          );
        }

        // Log inventory change
        await tx.inventoryLog.create({
          data: {
            productId: item.productId,
            type: 'SALE',
            quantity: -item.quantity,
            previousQty: product.stockQuantity,
            newQty,
            userId: req.user!.id,
          },
        });

        // Check low stock alert (fire-and-forget, don't block sale)
        if (product.lowStockAlert > 0 && newQty <= product.lowStockAlert && product.stockQuantity > product.lowStockAlert) {
          lowStockProducts.push({ name: product.name, sku: product.sku, stock: newQty, threshold: product.lowStockAlert });
        }
      }
    }

    // Update customer stats and loyalty tier
    if (customerId) {
      // Points earned on this sale minus any redeemed
      const pointsEarned = Math.floor(total);
      const pointsUsed = pointsRedeemed || 0;
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
      await tx.shift.update({
        where: { id: currentShift.id },
        data: {
          totalSales: { increment: total },
          totalTransactions: { increment: 1 },
        },
      });
    }

    return newSale;
  });
      break;
    } catch (err: any) {
      const uniqueTarget = err?.code === 'P2002' ? String(err?.meta?.target ?? '') : '';
      // Concurrent duplicate submit with the same idempotency key — return the existing sale
      if (uniqueTarget.includes('idempotencyKey') && idempotencyKey) {
        const existing = await prisma.sale.findUnique({ where: { idempotencyKey }, include: saleInclude });
        if (existing) {
          res.status(200).json({ success: true, data: existing });
          return;
        }
      }
      if (uniqueTarget.includes('saleNumber') && attempt < 4) continue;
      throw err;
    }
  }

  // Log activity
  await prisma.activityLog.create({
    data: {
      userId: req.user.id,
      action: 'CREATE',
      entity: 'SALE',
      entityId: sale.id,
      details: { saleNumber: sale.saleNumber, total: sale.total },
    },
  });

  logger.info(`Sale created: ${sale.saleNumber} - Total: $${sale.total}`);

  res.status(201).json({
    success: true,
    data: sale,
    message: 'Sale completed successfully',
  });

  // Fire-and-forget: send low stock alert email if any products dropped below threshold
  if (lowStockProducts.length > 0) {
    sendLowStockAlert(lowStockProducts).catch((err) => {
      logger.error('Failed to send low stock alert email:', err);
    });
  }
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

  if (saleNumber) where.saleNumber = saleNumber;
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
    },
  });

  if (!sale) {
    throw new AppError('Sale not found', 404);
  }

  // Verify user has access to this sale's location
  if (req.user?.locationId && sale.locationId !== req.user.locationId) {
    throw new AppError('Sale not found', 404);
  }

  res.json({
    success: true,
    data: sale,
  });
});

/**
 * Refund sale
 * POST /api/sales/:id/refund
 */
export const refundSale = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { amount, reason, notes, items, restock = true, refundMethod, reference } = req.body;

  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const sale = await prisma.sale.findUnique({
    where: { id },
    include: { items: true, refunds: { include: { items: true } }, payments: true },
  });

  if (!sale) {
    throw new AppError('Sale not found', 404);
  }

  // Verify user has access to this sale's location
  if (req.user?.locationId && sale.locationId !== req.user.locationId) {
    throw new AppError('Sale not found', 404);
  }

  if (sale.status === SaleStatus.VOIDED) {
    throw new AppError('Cannot refund a voided sale', 400);
  }

  // Calculate already-refunded amount
  const previouslyRefunded = sale.refunds.reduce((sum, r) => sum + r.amount, 0);
  const refundableAmount = Math.round((sale.total - previouslyRefunded) * 100) / 100;

  if (refundableAmount <= 0) {
    throw new AppError('Sale has already been fully refunded', 400);
  }

  // Per-sale-item quantities already refunded / restocked by earlier item-level refunds
  const refundedQtyByItem = new Map<string, number>();
  const restockedQtyByItem = new Map<string, number>();
  for (const r of sale.refunds) {
    for (const ri of r.items) {
      refundedQtyByItem.set(ri.saleItemId, (refundedQtyByItem.get(ri.saleItemId) || 0) + ri.quantity);
      if (ri.restocked) {
        restockedQtyByItem.set(ri.saleItemId, (restockedQtyByItem.get(ri.saleItemId) || 0) + ri.quantity);
      }
    }
  }

  // Item-level refunds: compute the amount server-side from the returned lines
  // (each unit refunds its prorated share of the line total, tax included)
  let refundAmount: number;
  const refundLines: { saleItemId: string; productId: string; productName: string; quantity: number; amount: number }[] = [];

  if (items && items.length > 0) {
    const saleItemMap = new Map(sale.items.map((i) => [i.id, i]));
    let computed = 0;
    for (const line of items as { saleItemId: string; quantity: number }[]) {
      const saleItem = saleItemMap.get(line.saleItemId);
      if (!saleItem) {
        throw new AppError(`Sale item not found on this sale: ${line.saleItemId}`, 400);
      }
      const refundableQty = saleItem.quantity - (refundedQtyByItem.get(saleItem.id) || 0);
      if (line.quantity > refundableQty) {
        throw new AppError(
          `Cannot refund ${line.quantity} × "${saleItem.productName}": only ${refundableQty} left to refund`,
          400
        );
      }
      const unitTotal = saleItem.total / saleItem.quantity;
      const lineAmount = Math.round(unitTotal * line.quantity * 100) / 100;
      computed += lineAmount;
      refundLines.push({
        saleItemId: saleItem.id,
        productId: saleItem.productId,
        productName: saleItem.productName,
        quantity: line.quantity,
        amount: lineAmount,
      });
    }
    refundAmount = Math.round(computed * 100) / 100;
  } else {
    refundAmount = amount;
  }

  if (refundAmount > refundableAmount + 0.01) {
    throw new AppError(
      `Refund amount exceeds refundable balance. Max refundable: $${refundableAmount.toFixed(2)}`,
      400
    );
  }

  // Update sale, credit the refund tender, and restore inventory
  const refundedSale = await prisma.$transaction(async (tx) => {
    // Create refund record (with item lines when this is an item-level refund)
    await tx.refund.create({
      data: {
        saleId: id,
        amount: refundAmount,
        reason,
        notes,
        refundedBy: req.user!.id,
        method: refundMethod || null,
        reference: reference || null,
        items: refundLines.length > 0
          ? {
              create: refundLines.map((line) => ({
                saleItemId: line.saleItemId,
                quantity: line.quantity,
                amount: line.amount,
                restocked: restock !== false,
              })),
            }
          : undefined,
      },
    });

    // Credit the money back to the original tender when requested
    if (refundMethod === 'GIFT_CARD') {
      const cardRef = reference
        || sale.payments.find((p) => p.paymentMethod === 'GIFT_CARD' && p.reference)?.reference;
      if (!cardRef) {
        throw new AppError('No gift card on this sale — provide the card number to refund to', 400);
      }
      const card = await tx.giftCard.findFirst({
        where: { OR: [{ code: cardRef }, { id: cardRef }] },
      });
      if (!card) throw new AppError(`Gift card not found: ${cardRef}`, 400);
      if (!card.isActive) throw new AppError('Gift card is deactivated', 400);
      await tx.giftCard.update({
        where: { id: card.id },
        data: {
          currentBalance: { increment: refundAmount },
          transactions: {
            create: {
              type: 'REFUND',
              amount: refundAmount,
              balanceBefore: card.currentBalance,
              balanceAfter: Math.round((card.currentBalance + refundAmount) * 100) / 100,
              saleId: id,
            },
          },
        },
      });
    }

    if (refundMethod === 'STORE_CREDIT') {
      if (!sale.customerId) {
        throw new AppError('Sale has no linked customer — store credit refunds need a customer', 400);
      }
      let account = await tx.storeCreditAccount.findUnique({ where: { customerId: sale.customerId } });
      if (!account) {
        account = await tx.storeCreditAccount.create({ data: { customerId: sale.customerId, balance: 0 } });
      }
      await tx.storeCreditAccount.update({
        where: { id: account.id },
        data: {
          balance: { increment: refundAmount },
          transactions: {
            create: {
              type: 'REFUND',
              amount: refundAmount,
              balanceBefore: account.balance,
              balanceAfter: Math.round((account.balance + refundAmount) * 100) / 100,
              saleId: id,
            },
          },
        },
      });
    }

    // Mark fully refunded if total refunds now equal sale total
    const totalRefundedNow = previouslyRefunded + refundAmount;
    const isFullyRefunded = totalRefundedNow >= sale.total - 0.01;

    const updated = await tx.sale.update({
      where: { id },
      data: {
        status: isFullyRefunded ? SaleStatus.REFUNDED : SaleStatus.COMPLETED,
        refundedAt: isFullyRefunded ? new Date() : undefined,
      },
      include: {
        items: true,
        refunds: { include: { items: true } },
      },
    });

    if (refundLines.length > 0 && restock !== false) {
      // Item-level refund: restock exactly the returned units
      for (const line of refundLines) {
        const product = await tx.product.findUnique({ where: { id: line.productId } });
        if (product?.trackInventory) {
          await tx.product.update({
            where: { id: line.productId },
            data: { stockQuantity: { increment: line.quantity } },
          });
          await tx.inventoryLog.create({
            data: {
              productId: line.productId,
              type: 'RETURN',
              quantity: line.quantity,
              previousQty: product.stockQuantity,
              newQty: product.stockQuantity + line.quantity,
              notes: `Refund for sale ${sale.saleNumber}`,
              userId: req.user!.id,
            },
          });
        }
      }
    } else if (refundLines.length === 0 && isFullyRefunded) {
      // Money-only refund that completes the full amount: restore whatever
      // earlier item-level refunds haven't already put back
      for (const item of sale.items) {
        const toRestore = item.quantity - (restockedQtyByItem.get(item.id) || 0);
        if (toRestore <= 0) continue;
        const product = await tx.product.findUnique({ where: { id: item.productId } });
        if (product?.trackInventory) {
          await tx.product.update({
            where: { id: item.productId },
            data: { stockQuantity: { increment: toRestore } },
          });
          await tx.inventoryLog.create({
            data: {
              productId: item.productId,
              type: 'RETURN',
              quantity: toRestore,
              previousQty: product.stockQuantity,
              newQty: product.stockQuantity + toRestore,
              notes: `Refund for sale ${sale.saleNumber}`,
              userId: req.user!.id,
            },
          });
        }
      }
    }

    // Update customer stats (floored at 0 so refunds can't drive them negative)
    if (sale.customerId) {
      const customer = await tx.customer.findUnique({
        where: { id: sale.customerId },
        select: { totalSpent: true, loyaltyPoints: true },
      });
      if (customer) {
        await tx.customer.update({
          where: { id: sale.customerId },
          data: {
            totalSpent: Math.max(0, Math.round((customer.totalSpent - refundAmount) * 100) / 100),
            loyaltyPoints: Math.max(0, customer.loyaltyPoints - Math.floor(refundAmount)),
          },
        });
      }
    }

    return updated;
  });

  // Log activity
  await prisma.activityLog.create({
    data: {
      userId: req.user.id,
      action: 'REFUND',
      entity: 'SALE',
      entityId: id,
      details: { saleNumber: sale.saleNumber, refundAmount, refundMethod: refundMethod || 'CASH' },
    },
  });

  logger.info(`Sale refunded: ${sale.saleNumber} - Amount: $${refundAmount}`);

  res.json({
    success: true,
    data: refundedSale,
    message: 'Sale refunded successfully',
  });
});

/**
 * Void sale
 * POST /api/sales/:id/void
 */
export const voidSale = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const sale = await prisma.sale.findUnique({
    where: { id },
    include: { items: true, refunds: true },
  });

  if (!sale) {
    throw new AppError('Sale not found', 404);
  }

  // Verify user has access to this sale's location
  if (req.user?.locationId && sale.locationId !== req.user.locationId) {
    throw new AppError('Sale not found', 404);
  }

  if (sale.status === SaleStatus.VOIDED) {
    throw new AppError('Sale already voided', 400);
  }

  // Check if sale was already fully refunded — inventory already restored
  const isFullyRefunded = sale.status === SaleStatus.REFUNDED;

  // Void sale and restore inventory
  const voidedSale = await prisma.$transaction(async (tx) => {
    const updated = await tx.sale.update({
      where: { id },
      data: { status: SaleStatus.VOIDED },
    });

    // Reverse customer stats and shift totals recorded at sale time.
    // Refunds already reversed part of the customer stats, so only the
    // remaining (unrefunded) amount is backed out here.
    if (!isFullyRefunded) {
      const alreadyRefunded = sale.refunds.reduce((sum, r) => sum + r.amount, 0);
      const remaining = Math.max(0, Math.round((sale.total - alreadyRefunded) * 100) / 100);

      if (sale.customerId && remaining > 0) {
        const customer = await tx.customer.findUnique({
          where: { id: sale.customerId },
          select: { totalSpent: true, loyaltyPoints: true, visitCount: true },
        });
        if (customer) {
          await tx.customer.update({
            where: { id: sale.customerId },
            data: {
              totalSpent: Math.max(0, Math.round((customer.totalSpent - remaining) * 100) / 100),
              loyaltyPoints: Math.max(0, customer.loyaltyPoints - Math.floor(remaining)),
              visitCount: Math.max(0, customer.visitCount - 1),
            },
          });
        }
      }

      if (sale.shiftId) {
        const shift = await tx.shift.findUnique({
          where: { id: sale.shiftId },
          select: { totalSales: true, totalTransactions: true },
        });
        if (shift) {
          await tx.shift.update({
            where: { id: sale.shiftId },
            data: {
              totalSales: Math.max(0, Math.round((shift.totalSales - sale.total) * 100) / 100),
              totalTransactions: Math.max(0, shift.totalTransactions - 1),
            },
          });
        }
      }
    }

    // Only restore inventory if NOT already fully refunded (refund already restored it)
    if (!isFullyRefunded) {
      for (const item of sale.items) {
        const product = await tx.product.findUnique({
          where: { id: item.productId },
        });

        if (product?.trackInventory) {
          await tx.product.update({
            where: { id: item.productId },
            data: {
              stockQuantity: { increment: item.quantity },
            },
          });

          await tx.inventoryLog.create({
            data: {
              productId: item.productId,
              type: 'RETURN',
              quantity: item.quantity,
              previousQty: product.stockQuantity,
              newQty: product.stockQuantity + item.quantity,
              notes: `Voided sale ${sale.saleNumber}`,
              userId: req.user!.id,
            },
          });
        }
      }
    }

    return updated;
  });

  // Log activity
  await prisma.activityLog.create({
    data: {
      userId: req.user.id,
      action: 'VOID',
      entity: 'SALE',
      entityId: id,
      details: { saleNumber: sale.saleNumber, total: sale.total },
    },
  });

  logger.info(`Sale voided: ${sale.saleNumber}`);

  res.json({
    success: true,
    data: voidedSale,
    message: 'Sale voided successfully',
  });
});

/**
 * Bulk void sales
 * POST /api/sales/bulk-void
 */
export const bulkVoidSales = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { saleIds } = req.body;

  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  if (!Array.isArray(saleIds) || saleIds.length === 0) {
    throw new AppError('Sale IDs array is required', 400);
  }

  if (saleIds.length > 50) {
    throw new AppError('Cannot void more than 50 sales at once', 400);
  }

  // Build where clause with location filter
  const where: any = {
    id: { in: saleIds },
  };
  if (req.user?.locationId) {
    where.locationId = req.user.locationId;
  }

  // Fetch all sales to void
  const sales = await prisma.sale.findMany({
    where,
    include: {
      items: true,
    },
  });

  if (sales.length === 0) {
    throw new AppError('No sales found with provided IDs', 404);
  }

  // Check if any sales are already voided
  const alreadyVoided = sales.filter((s) => s.status === SaleStatus.VOIDED);
  if (alreadyVoided.length > 0) {
    throw new AppError(
      `${alreadyVoided.length} sale(s) already voided: ${alreadyVoided.map((s) => s.saleNumber).join(', ')}`,
      400
    );
  }

  // Void all sales in a transaction
  const voidedSales = await prisma.$transaction(async (tx) => {
    const results = [];

    for (const sale of sales) {
      // Update sale status
      const updated = await tx.sale.update({
        where: { id: sale.id },
        data: { status: SaleStatus.VOIDED },
      });

      // Restore inventory for each item
      for (const item of sale.items) {
        const product = await tx.product.findUnique({
          where: { id: item.productId },
        });

        if (product?.trackInventory) {
          await tx.product.update({
            where: { id: item.productId },
            data: {
              stockQuantity: { increment: item.quantity },
            },
          });

          await tx.inventoryLog.create({
            data: {
              productId: item.productId,
              type: 'RETURN',
              quantity: item.quantity,
              previousQty: product.stockQuantity,
              newQty: product.stockQuantity + item.quantity,
              notes: `Bulk voided sale ${sale.saleNumber}`,
              userId: req.user!.id,
            },
          });
        }
      }

      results.push(updated);
      logger.info(`Sale voided (bulk): ${sale.saleNumber}`);
    }

    return results;
  });

  res.json({
    success: true,
    data: {
      voidedCount: voidedSales.length,
      voidedSales,
    },
    message: `${voidedSales.length} sale(s) voided successfully`,
  });
});

/**
 * Bulk refund sales
 * POST /api/sales/bulk-refund
 */
export const bulkRefundSales = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { saleIds } = req.body;

  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  if (!Array.isArray(saleIds) || saleIds.length === 0) {
    throw new AppError('Sale IDs array is required', 400);
  }

  if (saleIds.length > 50) {
    throw new AppError('Cannot refund more than 50 sales at once', 400);
  }

  // Build where clause with location filter
  const refundWhere: any = {
    id: { in: saleIds },
  };
  if (req.user?.locationId) {
    refundWhere.locationId = req.user.locationId;
  }

  // Fetch all sales to refund
  const sales = await prisma.sale.findMany({
    where: refundWhere,
    include: {
      items: true,
      customer: true,
      refunds: true,
    },
  });

  if (sales.length === 0) {
    throw new AppError('No sales found with provided IDs', 404);
  }

  // Check if any sales are already refunded or voided
  const invalidSales = sales.filter(
    (s) => s.status === SaleStatus.REFUNDED || s.status === SaleStatus.VOIDED
  );
  if (invalidSales.length > 0) {
    throw new AppError(
      `${invalidSales.length} sale(s) cannot be refunded (already refunded or voided): ${invalidSales.map((s) => s.saleNumber).join(', ')}`,
      400
    );
  }

  // Refund all sales in a transaction
  const refundedSales = await prisma.$transaction(async (tx) => {
    const results = [];

    for (const sale of sales) {
      // Refund only what hasn't been refunded yet (partial refunds may exist)
      const previouslyRefunded = sale.refunds.reduce((sum, r) => sum + r.amount, 0);
      const refundAmount = Math.max(0, Math.round((sale.total - previouslyRefunded) * 100) / 100);

      // Record the refund so refund history and refundable-balance math stay consistent
      if (refundAmount > 0) {
        await tx.refund.create({
          data: {
            saleId: sale.id,
            amount: refundAmount,
            reason: 'Bulk refund',
            refundedBy: req.user!.id,
          },
        });
      }

      // Update sale status
      const updated = await tx.sale.update({
        where: { id: sale.id },
        data: { status: SaleStatus.REFUNDED, refundedAt: new Date() },
      });

      // Restore inventory for each item
      for (const item of sale.items) {
        const product = await tx.product.findUnique({
          where: { id: item.productId },
        });

        if (product?.trackInventory) {
          await tx.product.update({
            where: { id: item.productId },
            data: {
              stockQuantity: { increment: item.quantity },
            },
          });

          await tx.inventoryLog.create({
            data: {
              productId: item.productId,
              type: 'RETURN',
              quantity: item.quantity,
              previousQty: product.stockQuantity,
              newQty: product.stockQuantity + item.quantity,
              notes: `Bulk refunded sale ${sale.saleNumber}`,
              userId: req.user!.id,
            },
          });
        }
      }

      // Update customer points and totals if customer exists
      if (sale.customerId) {
        const customer = await tx.customer.findUnique({
          where: { id: sale.customerId },
        });

        if (customer) {
          // Deduct points earned from this sale (assuming 1 point per dollar)
          const pointsToDeduct = Math.floor(refundAmount);

          await tx.customer.update({
            where: { id: sale.customerId },
            data: {
              loyaltyPoints: Math.max(0, customer.loyaltyPoints - pointsToDeduct),
              totalSpent: Math.max(0, Math.round((customer.totalSpent - refundAmount) * 100) / 100),
              visitCount: Math.max(0, customer.visitCount - 1),
            },
          });
        }
      }

      results.push(updated);
      logger.info(`Sale refunded (bulk): ${sale.saleNumber}`);
    }

    return results;
  });

  res.json({
    success: true,
    data: {
      refundedCount: refundedSales.length,
      refundedSales,
    },
    message: `${refundedSales.length} sale(s) refunded successfully`,
  });
});

/**
 * Email receipt
 * POST /api/sales/:id/email-receipt
 */
export const emailReceipt = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { email } = req.body;

  if (!email) {
    throw new AppError('Email address is required', 400);
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

  // Verify user has access to this sale's location
  if (req.user?.locationId && sale.locationId !== req.user.locationId) {
    throw new AppError('Sale not found', 404);
  }

  const storeName = config.app.name || 'POS System';

  // HTML-escape helper to prevent XSS in email content
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const itemsHtml = sale.items.map(item =>
    `<tr>
      <td style="padding:4px 0;">${esc(item.productName)}</td>
      <td style="padding:4px 0;text-align:center;">${item.quantity}</td>
      <td style="padding:4px 0;text-align:right;">$${item.price.toFixed(2)}</td>
      <td style="padding:4px 0;text-align:right;">$${item.total.toFixed(2)}</td>
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
        <h1>${storeName}</h1>
        <p>Receipt #${sale.saleNumber}</p>
        <p>${new Date(sale.createdAt).toLocaleString()}</p>
        ${sale.user ? `<p>Cashier: ${esc(sale.user.firstName)} ${esc(sale.user.lastName)}</p>` : ''}
      </div>
      <table>
        <thead><tr><th>Item</th><th style="text-align:center;">Qty</th><th style="text-align:right;">Price</th><th style="text-align:right;">Total</th></tr></thead>
        <tbody>${itemsHtml}</tbody>
      </table>
      <hr>
      <table class="totals">
        <tr><td>Subtotal</td><td style="text-align:right;">$${sale.subtotal.toFixed(2)}</td></tr>
        <tr><td>Tax</td><td style="text-align:right;">$${sale.tax.toFixed(2)}</td></tr>
        ${sale.discount > 0 ? `<tr><td>Discount</td><td style="text-align:right;">-$${sale.discount.toFixed(2)}</td></tr>` : ''}
        <tr class="grand-total"><td>Total</td><td style="text-align:right;">$${sale.total.toFixed(2)}</td></tr>
        <tr><td>Paid (${paymentInfo})</td><td style="text-align:right;">$${sale.amountPaid.toFixed(2)}</td></tr>
        ${sale.changeDue > 0 ? `<tr><td>Change</td><td style="text-align:right;">$${sale.changeDue.toFixed(2)}</td></tr>` : ''}
      </table>
      ${sale.customer ? `<p>Customer: ${esc(sale.customer.firstName)} ${esc(sale.customer.lastName)}</p>` : ''}
      <div class="footer"><p>Thank you for your business!</p></div>
    </div>
    </body></html>
  `;

  await sendEmail({
    to: email,
    subject: `Receipt #${sale.saleNumber} from ${storeName}`,
    html,
  });

  // Save email for reference
  await prisma.sale.update({
    where: { id },
    data: { receiptEmail: email },
  });

  logger.info(`Receipt emailed: ${sale.saleNumber} to ${email}`);

  res.json({
    success: true,
    message: `Receipt emailed to ${email}`,
  });
});
