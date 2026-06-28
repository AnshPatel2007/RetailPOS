import { Response } from 'express';
import { asyncHandler, AppError } from '../utils/errorHandler';
import { AuthRequest } from '../types';
import prisma from '../config/database';
import { logger } from '../utils/logger';

/**
 * Generate unique order number
 */
const generateOrderNumber = async (): Promise<string> => {
  const date = new Date();
  const prefix = `PO${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}`;

  const lastOrder = await prisma.purchaseOrder.findFirst({
    where: {
      orderNumber: { startsWith: prefix },
    },
    orderBy: { orderNumber: 'desc' },
  });

  let sequence = 1;
  if (lastOrder) {
    const lastSequence = parseInt(lastOrder.orderNumber.slice(-4));
    sequence = lastSequence + 1;
  }

  return `${prefix}${String(sequence).padStart(4, '0')}`;
};

/**
 * Get all purchase orders
 * GET /api/purchase-orders
 */
export const getPurchaseOrders = asyncHandler(async (req: AuthRequest, res: Response) => {
  const {
    page = '1',
    limit = '20',
    status,
    supplierId,
    startDate,
    endDate,
    sortBy = 'createdAt',
    sortOrder = 'desc',
  } = req.query;

  const pageNum = parseInt(page as string);
  const limitNum = parseInt(limit as string);
  const skip = (pageNum - 1) * limitNum;

  // Build where clause
  const where: any = {};

  if (status) {
    where.status = status;
  }

  if (supplierId) {
    where.supplierId = supplierId;
  }

  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) {
      where.createdAt.gte = new Date(startDate as string);
    }
    if (endDate) {
      where.createdAt.lte = new Date(endDate as string);
    }
  }

  const [orders, total] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where,
      include: {
        supplier: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
          },
        },
        _count: {
          select: { items: true },
        },
      },
      orderBy: { [sortBy as string]: sortOrder },
      skip,
      take: limitNum,
    }),
    prisma.purchaseOrder.count({ where }),
  ]);

  res.json({
    success: true,
    data: orders,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
    },
  });
});

/**
 * Get purchase order by ID
 * GET /api/purchase-orders/:id
 */
export const getPurchaseOrder = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  const order = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: true,
      items: {
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!order) {
    throw new AppError('Purchase order not found', 404);
  }

  res.json({
    success: true,
    data: order,
  });
});

/**
 * Create purchase order
 * POST /api/purchase-orders
 */
export const createPurchaseOrder = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { supplierId, items, notes, expectedAt } = req.body;

  // Verify supplier exists
  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
  if (!supplier) {
    throw new AppError('Supplier not found', 404);
  }

  // Generate order number
  const orderNumber = await generateOrderNumber();

  // Batch-fetch all products to avoid N+1 queries
  const productIds = items.map((item: any) => item.productId);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, sku: true, name: true },
  });
  const productMap = new Map(products.map(p => [p.id, p]));

  // Verify all products exist
  for (const item of items) {
    if (!productMap.has(item.productId)) {
      throw new AppError(`Product not found: ${item.productId}`, 404);
    }
  }

  // Calculate total
  let totalAmount = 0;
  const orderItems = items.map((item: any) => {
    const product = productMap.get(item.productId)!;
    const itemTotal = item.cost * item.quantity;
    totalAmount += itemTotal;
    return {
      productId: item.productId,
      sku: product.sku,
      productName: product.name,
      quantity: item.quantity,
      cost: item.cost,
      total: itemTotal,
    };
  });

  // Create purchase order with items
  const order = await prisma.purchaseOrder.create({
    data: {
      orderNumber,
      supplierId,
      totalAmount,
      notes,
      expectedAt: expectedAt ? new Date(expectedAt) : null,
      items: {
        create: orderItems,
      },
    },
    include: {
      supplier: {
        select: {
          id: true,
          name: true,
        },
      },
      items: true,
    },
  });

  logger.info(`Purchase order created: ${orderNumber}`);

  res.status(201).json({
    success: true,
    data: order,
    message: 'Purchase order created successfully',
  });
});

/**
 * Update purchase order
 * PUT /api/purchase-orders/:id
 */
export const updatePurchaseOrder = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { notes, expectedAt, items } = req.body;

  const existing = await prisma.purchaseOrder.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError('Purchase order not found', 404);
  }

  if (existing.status !== 'PENDING') {
    throw new AppError('Can only update pending orders', 400);
  }

  // If updating items, recalculate total
  let updateData: any = { notes, expectedAt: expectedAt ? new Date(expectedAt) : null };

  if (items && items.length > 0) {
    // Delete existing items and create new ones
    await prisma.purchaseOrderItem.deleteMany({
      where: { purchaseOrderId: id },
    });

    // Batch-fetch all products to avoid N+1 queries
    const productIds = items.map((item: any) => item.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, sku: true, name: true },
    });
    const productMap = new Map(products.map((p: any) => [p.id, p]));

    for (const item of items) {
      if (!productMap.has(item.productId)) {
        throw new AppError(`Product not found: ${item.productId}`, 404);
      }
    }

    let totalAmount = 0;
    const orderItems = items.map((item: any) => {
      const product = productMap.get(item.productId)!;
      const itemTotal = item.cost * item.quantity;
      totalAmount += itemTotal;
      return {
        purchaseOrderId: id,
        productId: item.productId,
        sku: product.sku,
        productName: product.name,
        quantity: item.quantity,
        cost: item.cost,
        total: itemTotal,
      };
    });

    await prisma.purchaseOrderItem.createMany({
      data: orderItems,
    });

    updateData.totalAmount = totalAmount;
  }

  const order = await prisma.purchaseOrder.update({
    where: { id },
    data: updateData,
    include: {
      supplier: true,
      items: true,
    },
  });

  res.json({
    success: true,
    data: order,
    message: 'Purchase order updated successfully',
  });
});

/**
 * Update purchase order status
 * POST /api/purchase-orders/:id/status
 */
export const updateStatus = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { status } = req.body;

  const validStatuses = ['PENDING', 'ORDERED', 'RECEIVED', 'CANCELLED'];
  if (!validStatuses.includes(status)) {
    throw new AppError('Invalid status', 400);
  }

  const existing = await prisma.purchaseOrder.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError('Purchase order not found', 404);
  }

  const updateData: any = { status };

  if (status === 'ORDERED') {
    updateData.orderedAt = new Date();
  } else if (status === 'RECEIVED') {
    updateData.receivedAt = new Date();
  }

  const order = await prisma.purchaseOrder.update({
    where: { id },
    data: updateData,
    include: {
      supplier: true,
    },
  });

  logger.info(`Purchase order ${order.orderNumber} status updated to ${status}`);

  res.json({
    success: true,
    data: order,
    message: `Purchase order marked as ${status.toLowerCase()}`,
  });
});

/**
 * Receive purchase order (update inventory)
 * POST /api/purchase-orders/:id/receive
 */
export const receivePurchaseOrder = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { receivedItems } = req.body;

  const order = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: { items: true },
  });

  if (!order) {
    throw new AppError('Purchase order not found', 404);
  }

  if (order.status === 'RECEIVED') {
    throw new AppError('Order has already been received', 400);
  }

  if (order.status === 'CANCELLED') {
    throw new AppError('Cannot receive a cancelled order', 400);
  }

  // Process each received item
  const inventoryUpdates = [];
  const variances = [];

  for (const item of order.items) {
    const received = receivedItems?.find((r: any) => r.productId === item.productId);
    const receivedQty = received?.quantity ?? item.quantity;
    const variance = receivedQty - item.quantity;

    if (variance !== 0) {
      variances.push({
        productId: item.productId,
        productName: item.productName,
        ordered: item.quantity,
        received: receivedQty,
        variance,
      });
    }

    // Update product stock
    const product = await prisma.product.findUnique({
      where: { id: item.productId },
    });

    if (product) {
      const previousQty = product.stockQuantity;
      const newQty = previousQty + receivedQty;

      inventoryUpdates.push(
        prisma.product.update({
          where: { id: item.productId },
          data: { stockQuantity: newQty },
        })
      );

      // Create inventory log
      inventoryUpdates.push(
        prisma.inventoryLog.create({
          data: {
            productId: item.productId,
            type: 'PURCHASE',
            quantity: receivedQty,
            previousQty,
            newQty,
            notes: `Received from PO: ${order.orderNumber}`,
            userId: req.user?.id,
          },
        })
      );
    }
  }

  // Execute all updates in a transaction
  await prisma.$transaction([
    ...inventoryUpdates,
    prisma.purchaseOrder.update({
      where: { id },
      data: {
        status: 'RECEIVED',
        receivedAt: new Date(),
      },
    }),
  ]);

  logger.info(`Purchase order ${order.orderNumber} received`);

  res.json({
    success: true,
    message: 'Purchase order received and inventory updated',
    data: {
      orderNumber: order.orderNumber,
      variances: variances.length > 0 ? variances : null,
    },
  });
});

/**
 * Cancel purchase order
 * POST /api/purchase-orders/:id/cancel
 */
export const cancelPurchaseOrder = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { reason } = req.body;

  const existing = await prisma.purchaseOrder.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError('Purchase order not found', 404);
  }

  if (existing.status === 'RECEIVED') {
    throw new AppError('Cannot cancel a received order', 400);
  }

  if (existing.status === 'CANCELLED') {
    throw new AppError('Order is already cancelled', 400);
  }

  const order = await prisma.purchaseOrder.update({
    where: { id },
    data: {
      status: 'CANCELLED',
      notes: reason ? `${existing.notes || ''}\nCancelled: ${reason}`.trim() : existing.notes,
    },
  });

  logger.info(`Purchase order ${order.orderNumber} cancelled`);

  res.json({
    success: true,
    data: order,
    message: 'Purchase order cancelled',
  });
});

/**
 * Auto-generate purchase orders for low stock items
 * POST /api/purchase-orders/auto-generate
 */
export const autoGeneratePurchaseOrders = asyncHandler(async (_req: AuthRequest, res: Response) => {
  // Find products below reorder point
  const allActiveProducts = await prisma.product.findMany({
    where: {
      isActive: true,
      trackInventory: true,
    },
    include: {
      suppliers: {
        include: {
          supplier: true,
        },
        orderBy: {
          cost: 'asc',
        },
      },
    },
  });

  const lowStockProducts = allActiveProducts.filter(p => p.stockQuantity <= p.lowStockAlert);

  if (lowStockProducts.length === 0) {
    res.json({
      success: true,
      message: 'No products need reordering',
      data: { ordersCreated: 0 },
    });
    return;
  }

  // Group products by preferred supplier (lowest cost)
  const supplierOrders: Map<string, any[]> = new Map();

  for (const product of lowStockProducts) {
    if (product.suppliers.length === 0) continue;

    const preferredSupplier = product.suppliers[0];
    const supplierId = preferredSupplier.supplierId;

    if (!supplierOrders.has(supplierId)) {
      supplierOrders.set(supplierId, []);
    }

    // Calculate order quantity (restock to 2x low stock alert)
    const orderQty = Math.max(
      preferredSupplier.minOrder || 1,
      (product.lowStockAlert * 2) - product.stockQuantity
    );

    supplierOrders.get(supplierId)!.push({
      productId: product.id,
      sku: product.sku,
      productName: product.name,
      quantity: orderQty,
      cost: preferredSupplier.cost || product.cost,
    });
  }

  // Create purchase orders
  const createdOrders = [];

  for (const [supplierId, items] of supplierOrders) {
    const orderNumber = await generateOrderNumber();
    const totalAmount = items.reduce((sum, item) => sum + (item.cost * item.quantity), 0);

    const order = await prisma.purchaseOrder.create({
      data: {
        orderNumber,
        supplierId,
        totalAmount,
        notes: 'Auto-generated for low stock items',
        items: {
          create: items.map(item => ({
            productId: item.productId,
            sku: item.sku,
            productName: item.productName,
            quantity: item.quantity,
            cost: item.cost,
            total: item.cost * item.quantity,
          })),
        },
      },
      include: {
        supplier: {
          select: { name: true },
        },
        _count: {
          select: { items: true },
        },
      },
    });

    createdOrders.push(order);
    logger.info(`Auto-generated purchase order: ${orderNumber}`);
  }

  res.json({
    success: true,
    message: `Created ${createdOrders.length} purchase order(s)`,
    data: {
      ordersCreated: createdOrders.length,
      orders: createdOrders,
    },
  });
});

/**
 * Delete purchase order
 * DELETE /api/purchase-orders/:id
 */
export const deletePurchaseOrder = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  const existing = await prisma.purchaseOrder.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError('Purchase order not found', 404);
  }

  if (existing.status === 'RECEIVED') {
    throw new AppError('Cannot delete a received order', 400);
  }

  await prisma.purchaseOrder.delete({ where: { id } });

  logger.info(`Purchase order ${existing.orderNumber} deleted`);

  res.json({
    success: true,
    message: 'Purchase order deleted successfully',
  });
});