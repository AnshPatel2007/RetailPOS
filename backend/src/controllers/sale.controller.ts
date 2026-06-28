import { Response } from 'express';
import { asyncHandler, AppError } from '../utils/errorHandler';
import { AuthRequest } from '../types';
import prisma from '../config/database';
import { logger } from '../utils/logger';
import { PaymentMethod, SaleStatus } from '@prisma/client';
import { createDateFilter } from '../utils/dateFilter.util';
import { businessConfig } from '../config/business.config';

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
  const { customerId, items, paymentMethod, amountPaid, notes, receiptEmail } = req.body;

  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  // Get current shift
  const currentShift = await prisma.shift.findFirst({
    where: {
      userId: req.user.id,
      isClosed: false,
    },
    orderBy: {
      clockInAt: 'desc',
    },
  });

  // Fetch default tax rate once for the whole transaction (not per item)
  const defaultTaxRate = await prisma.taxRate.findFirst({
    where: { isDefault: true, isActive: true },
  });

  // Calculate totals
  let subtotal = 0;
  let totalTax = 0;
  let totalDiscount = 0;

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

  // Validate and calculate
  const itemsWithDetails = items.map((item: any) => {
    const isMisc = !item.productId || item.productId.startsWith('misc-');
    const product = isMisc ? miscProduct : productMap.get(item.productId);

    if (!product) {
      throw new AppError(`Product not found: ${item.productId}`, 404);
    }

    if (!isMisc && product.trackInventory && product.stockQuantity < item.quantity) {
      throw new AppError(`Insufficient stock for ${product.name}`, 400);
    }

    const itemSubtotal = item.price * item.quantity;
    const itemDiscount = item.discount || 0;
    const itemTotal = itemSubtotal - itemDiscount;

    let itemTax = 0;
    if (product.isTaxable && defaultTaxRate) {
      itemTax = (itemTotal * defaultTaxRate.rate) / 100;
    }

    subtotal += itemSubtotal;
    totalDiscount += itemDiscount;
    totalTax += itemTax;

    return {
      productId: product.id,
      sku: isMisc ? 'MISC' : product.sku,
      productName: isMisc ? (item.name || 'Misc Item') : product.name,
      quantity: item.quantity,
      price: item.price,
      discount: itemDiscount,
      tax: itemTax,
      total: itemTotal + itemTax,
      notes: item.notes,
    };
  });

  const total = subtotal - totalDiscount + totalTax;
  const changeDue = amountPaid - total;

  if (amountPaid < total) {
    throw new AppError('Insufficient payment amount', 400);
  }

  // Generate sale number
  const saleNumber = await generateSaleNumber();

  // Create sale with transaction
  const sale = await prisma.$transaction(async (tx) => {
    // Create sale
    const newSale = await tx.sale.create({
      data: {
        saleNumber,
        customerId,
        userId: req.user!.id,
        locationId: req.user!.locationId,
        shiftId: currentShift?.id,
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
      },
      include: {
        items: {
          include: {
            product: true,
          },
        },
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

    // Update inventory (skip misc items)
    for (const item of regularItems) {
      const product = await tx.product.findUnique({
        where: { id: item.productId },
      });

      if (product?.trackInventory) {
        await tx.product.update({
          where: { id: item.productId },
          data: {
            stockQuantity: {
              decrement: item.quantity,
            },
          },
        });

        // Log inventory change
        await tx.inventoryLog.create({
          data: {
            productId: item.productId,
            type: 'SALE',
            quantity: -item.quantity,
            previousQty: product.stockQuantity,
            newQty: product.stockQuantity - item.quantity,
            userId: req.user!.id,
          },
        });
      }
    }

    // Update customer stats and loyalty tier
    if (customerId) {
      const updatedCust = await tx.customer.update({
        where: { id: customerId },
        data: {
          totalSpent: { increment: total },
          visitCount: { increment: 1 },
          loyaltyPoints: { increment: Math.floor(total) }, // 1 point per dollar
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

  if (customerId) where.customerId = customerId;
  if (userId) where.userId = userId;
  if (status) where.status = status;
  if (paymentMethod) where.paymentMethod = paymentMethod;

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
      location: true,
      refunds: true,
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
  const { amount, reason, notes } = req.body;

  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const sale = await prisma.sale.findUnique({
    where: { id },
    include: { items: true },
  });

  if (!sale) {
    throw new AppError('Sale not found', 404);
  }

  // Verify user has access to this sale's location
  if (req.user?.locationId && sale.locationId !== req.user.locationId) {
    throw new AppError('Sale not found', 404);
  }

  if (sale.status === SaleStatus.REFUNDED) {
    throw new AppError('Sale already refunded', 400);
  }

  if (amount > sale.total) {
    throw new AppError('Refund amount exceeds sale total', 400);
  }

  // Update sale and restore inventory
  const refundedSale = await prisma.$transaction(async (tx) => {
    // Create refund record
    await tx.refund.create({
      data: {
        saleId: id,
        amount,
        reason,
        notes,
        refundedBy: req.user!.id,
      },
    });

    // Update sale status
    const updated = await tx.sale.update({
      where: { id },
      data: {
        status: SaleStatus.REFUNDED,
        refundedAt: new Date(),
      },
      include: {
        items: true,
        refunds: true,
      },
    });

    // Restore inventory
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
            notes: `Refund for sale ${sale.saleNumber}`,
            userId: req.user!.id,
          },
        });
      }
    }

    // Update customer stats
    if (sale.customerId) {
      await tx.customer.update({
        where: { id: sale.customerId },
        data: {
          totalSpent: { decrement: amount },
          loyaltyPoints: { decrement: Math.floor(amount) },
        },
      });
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
      details: { saleNumber: sale.saleNumber, refundAmount: amount },
    },
  });

  logger.info(`Sale refunded: ${sale.saleNumber} - Amount: $${amount}`);

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
    include: { items: true },
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

  // Void sale and restore inventory
  const voidedSale = await prisma.$transaction(async (tx) => {
    const updated = await tx.sale.update({
      where: { id },
      data: { status: SaleStatus.VOIDED },
    });

    // Restore inventory
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

    return updated;
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
      // Update sale status
      const updated = await tx.sale.update({
        where: { id: sale.id },
        data: { status: SaleStatus.REFUNDED },
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
          const pointsToDeduct = Math.floor(sale.total);

          await tx.customer.update({
            where: { id: sale.customerId },
            data: {
              loyaltyPoints: Math.max(0, customer.loyaltyPoints - pointsToDeduct),
              totalSpent: Math.max(0, customer.totalSpent - sale.total),
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
