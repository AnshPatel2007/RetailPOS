import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { getReportRange } from '../services/reportDates.service';
import { getLocationFilter } from '../utils/locationFilter.util';
import { nextDocumentNumber } from '../services/documentNumber.service';
import { Response } from 'express';
import { asyncHandler, AppError } from '../utils/errorHandler';
import { AuthRequest } from '../types';
import prisma from '../config/database';
import { logger } from '../utils/logger';
import { orderLine, roundToCases } from '../services/purchaseOrderLines';
import { assertCanReadRecord, getSharedOrOwnFilter, resolveWriteLocation } from '../utils/locationFilter.util';
import { loadReorderPlan } from '../services/reorder.service';

/**
 * Generate unique order number
 */
const generateOrderNumber = async (_locationId: string | null): Promise<string> => nextDocumentNumber('PO');

/**
 * Get all purchase orders
 * GET /api/purchase-orders
 */
export const getPurchaseOrders = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { page: pageNum, limit: limitNum, status, supplierId, startDate, endDate, search, sortBy, sortOrder } = z.object({
    page: z.coerce.number().int().min(1).max(10000).default(1), limit: z.coerce.number().int().min(1).max(100).default(20),
    status: z.enum(['PENDING', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED']).optional(), supplierId: z.string().optional(),
    search: z.string().trim().max(200).optional(), startDate: z.string().optional(), endDate: z.string().optional(),
    sortBy: z.enum(['createdAt', 'expectedAt', 'orderNumber', 'totalAmount', 'status']).default('createdAt'), sortOrder: z.enum(['asc', 'desc']).default('desc'),
  }).parse(req.query);
  const skip = (pageNum - 1) * limitNum;

  // Build where clause
  const where: any = { ...getSharedOrOwnFilter(req, req.query.locationId as string) };

  if (status) {
    where.status = status;
  }

  if (supplierId) {
    where.supplierId = supplierId;
  }

  if (search) where.OR = [{ orderNumber: { contains: search, mode: 'insensitive' } }, { supplier: { name: { contains: search, mode: 'insensitive' } } }];
  if (startDate || endDate) where.createdAt = (await getReportRange(getLocationFilter(req, req.query.locationId as string), startDate, endDate)).range;

  const [orders, total] = await prisma.$transaction(async tx => Promise.all([
    tx.purchaseOrder.findMany({
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
      orderBy: [{ [sortBy]: sortOrder }, { id: sortOrder }],
      skip,
      take: limitNum,
    }),
    tx.purchaseOrder.count({ where }),
  ]), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });

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
      receipts: { orderBy: { createdAt: 'desc' }, include: { items: true }, take: 100 },
      items: {
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!order) {
    throw new AppError('Purchase order not found', 404);
  }
  assertCanReadRecord(req, order.locationId, 'Purchase order not found');

  // Store packs let a delivered case be counted as unopened packs on receipt.
  const units = await prisma.productSellingUnit.findMany({ where: { productId: { in: order.items.map(item => item.productId) }, isActive: true },
    select: { id: true, productId: true, name: true, unitsPerPackage: true } });
  res.json({
    success: true,
    data: { ...order, items: order.items.map(item => ({ ...item,
      sellingUnits: units.filter(unit => unit.productId === item.productId).map(({ productId: _productId, ...unit }) => unit) })) },
  });
});

/**
 * Create purchase order
 * POST /api/purchase-orders
 */
export const createPurchaseOrder = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { supplierId, items, notes, expectedAt } = req.body;
  const locationId = resolveWriteLocation(req);

  // Verify supplier exists and is usable from this store (shared or own)
  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
  if (!supplier) {
    throw new AppError('Supplier not found', 404);
  }
  assertCanReadRecord(req, supplier.locationId, 'Supplier not found');
  if (supplier.isActive === false) throw new AppError('Select an active supplier', 400);

  // Generate order number
  const orderNumber = await generateOrderNumber(locationId);

  // Batch-fetch all products to avoid N+1 queries
  const productIds = items.map((item: any) => item.productId);
  if (new Set(productIds).size !== productIds.length) throw new AppError('Combine duplicate products into one order line', 400);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, locationId, isActive: true, sku: { not: 'MISC-001' } },
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
    const line = orderLine(item);
    totalAmount += line.total;
    return {
      productId: item.productId,
      sku: product.sku,
      productName: product.name,
      ...line,
    };
  });

  // Create purchase order with items
  const order = await prisma.purchaseOrder.create({
    data: {
      orderNumber,
      supplierId,
      totalAmount: Math.round(totalAmount * 100) / 100,
      notes,
      locationId,
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

export { updatePurchaseOrder, updateStatus, receivePurchaseOrder, cancelPurchaseOrder, deletePurchaseOrder } from './purchaseWorkflow.controller';

/**
 * Auto-generate purchase orders for low stock items
 * POST /api/purchase-orders/auto-generate
 */
export const autoGeneratePurchaseOrders = asyncHandler(async (req: AuthRequest, res: Response) => {
  const locationId = resolveWriteLocation(req);

  // Find products below reorder point
  const allActiveProducts = await prisma.product.findMany({
    where: {
      isActive: true,
      trackInventory: true,
      sku: { not: 'MISC-001' },
      ...(locationId ? { locationId } : {}),
    },
    include: {
      suppliers: {
        where: { supplier: { locationId, isActive: true } },
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

    // Restock to 2x the low stock alert, in whole supplier cases
    const orderQty = roundToCases((product.lowStockAlert * 2) - product.stockQuantity, preferredSupplier.packSize, preferredSupplier.minOrder);
    const unitCost = Number(preferredSupplier.cost ?? product.cost);

    supplierOrders.get(supplierId)!.push({
      productId: product.id,
      sku: product.sku,
      productName: product.name,
      ...orderLine({ quantity: orderQty, cost: unitCost, packSize: preferredSupplier.packSize,
        packCost: preferredSupplier.packCost == null ? null : Number(preferredSupplier.packCost) }),
    });
  }

  // Create purchase orders
  const createdOrders = [];

  for (const [supplierId, items] of supplierOrders) {
    const orderNumber = await generateOrderNumber(locationId);
    const totalAmount = Math.round(items.reduce((sum, item) => sum + item.total, 0) * 100) / 100;

    const order = await prisma.purchaseOrder.create({
      data: {
        orderNumber,
        supplierId,
        totalAmount,
        notes: 'Auto-generated for low stock items',
        locationId,
        items: {
          create: items,
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
 * Suggested purchase orders, grouped by supplier (services/reorderPlan.ts).
 * Suppliers with delivery days plan to the delivery after next; others keep
 * two weeks of cover. GET /api/purchase-orders/suggested
 */
export const getSuggestedOrders = asyncHandler(async (req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await loadReorderPlan(getSharedOrOwnFilter(req, req.query.locationId as string)) });
});
