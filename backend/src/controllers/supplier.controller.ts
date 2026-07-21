import { Response } from 'express';
import { asyncHandler, AppError } from '../utils/errorHandler';
import { AuthRequest } from '../types';
import prisma from '../config/database';
import { logger } from '../utils/logger';
import { assertOwnsRecord, assertCanReadRecord, getSharedOrOwnFilter, isSuperAdmin } from '../utils/locationFilter.util';

/**
 * Get all suppliers
 * GET /api/suppliers
 */
export const getSuppliers = asyncHandler(async (req: AuthRequest, res: Response) => {
  const {
    page = '1',
    limit = '20',
    search,
    isActive,
    sortBy = 'name',
    sortOrder = 'asc',
  } = req.query;

  const pageNum = parseInt(page as string);
  const limitNum = parseInt(limit as string);
  const skip = (pageNum - 1) * limitNum;

  // Build where clause
  const where: any = { ...getSharedOrOwnFilter(req, req.query.locationId as string) };

  if (search) {
    where.OR = [
      { name: { contains: search as string, mode: 'insensitive' } },
      { contactName: { contains: search as string, mode: 'insensitive' } },
      { email: { contains: search as string, mode: 'insensitive' } },
    ];
  }

  if (isActive !== undefined) {
    where.isActive = isActive === 'true';
  }

  const [suppliers, total] = await Promise.all([
    prisma.supplier.findMany({
      where,
      include: {
        _count: {
          select: {
            products: true,
            purchaseOrders: true,
          },
        },
      },
      orderBy: { [sortBy as string]: sortOrder },
      skip,
      take: limitNum,
    }),
    prisma.supplier.count({ where }),
  ]);

  res.json({
    success: true,
    data: suppliers,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
    },
  });
});

/**
 * Get supplier by ID
 * GET /api/suppliers/:id
 */
export const getSupplier = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  const supplier = await prisma.supplier.findUnique({
    where: { id },
    include: {
      products: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              sku: true,
              price: true,
              stockQuantity: true,
            },
          },
        },
      },
      purchaseOrders: {
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          _count: {
            select: { items: true },
          },
        },
      },
    },
  });

  if (!supplier) {
    throw new AppError('Supplier not found', 404);
  }
  assertCanReadRecord(req, supplier.locationId, 'Supplier not found');

  res.json({
    success: true,
    data: supplier,
  });
});

/**
 * Create supplier
 * POST /api/suppliers
 */
export const createSupplier = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { name, contactName, email, phone, address, notes, paymentTerms, leadTimeDays, minimumOrder } = req.body;
  // Non-SUPER_ADMIN is always forced to their own store
  const locationId = isSuperAdmin(req) ? (req.body.locationId ?? null) : (req.user!.locationId ?? null);

  const supplier = await prisma.supplier.create({
    data: {
      name,
      contactName,
      email,
      phone,
      address,
      notes,
      paymentTerms,
      leadTimeDays,
      minimumOrder,
      locationId,
    },
  });

  logger.info(`Supplier created: ${supplier.name}`);

  res.status(201).json({
    success: true,
    data: supplier,
    message: 'Supplier created successfully',
  });
});

/**
 * Update supplier
 * PUT /api/suppliers/:id
 */
export const updateSupplier = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { name, contactName, email, phone, address, notes, isActive, paymentTerms, leadTimeDays, minimumOrder } = req.body;

  const existing = await prisma.supplier.findUnique({ where: { id } });
  if (!existing) {
    throw new AppError('Supplier not found', 404);
  }
  assertOwnsRecord(req, existing.locationId);

  const supplier = await prisma.supplier.update({
    where: { id },
    data: {
      name,
      contactName,
      email,
      phone,
      address,
      notes,
      isActive,
      paymentTerms,
      leadTimeDays,
      minimumOrder,
    },
  });

  logger.info(`Supplier updated: ${supplier.name}`);

  res.json({
    success: true,
    data: supplier,
    message: 'Supplier updated successfully',
  });
});

/**
 * Delete supplier
 * DELETE /api/suppliers/:id
 */
export const deleteSupplier = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  const existing = await prisma.supplier.findUnique({
    where: { id },
    include: {
      _count: {
        select: {
          purchaseOrders: true,
        },
      },
    },
  });

  if (!existing) {
    throw new AppError('Supplier not found', 404);
  }
  assertOwnsRecord(req, existing.locationId);

  // Check for active purchase orders
  if (existing._count.purchaseOrders > 0) {
    throw new AppError(
      'Cannot delete supplier with existing purchase orders. Deactivate instead.',
      400
    );
  }

  await prisma.supplier.delete({ where: { id } });

  logger.info(`Supplier deleted: ${existing.name}`);

  res.json({
    success: true,
    message: 'Supplier deleted successfully',
  });
});

/**
 * Link product to supplier
 * POST /api/suppliers/:id/products
 */
export const linkProduct = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { productId, supplierSku, cost, leadTime, minOrder } = req.body;

  // Verify supplier exists
  const supplier = await prisma.supplier.findUnique({ where: { id } });
  if (!supplier) {
    throw new AppError('Supplier not found', 404);
  }
  assertOwnsRecord(req, supplier.locationId);

  // Verify product exists
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) {
    throw new AppError('Product not found', 404);
  }

  // Check if link already exists
  const existing = await prisma.productSupplier.findUnique({
    where: {
      productId_supplierId: {
        productId,
        supplierId: id,
      },
    },
  });

  if (existing) {
    throw new AppError('Product is already linked to this supplier', 400);
  }

  const productSupplier = await prisma.productSupplier.create({
    data: {
      productId,
      supplierId: id,
      supplierSku,
      cost,
      leadTime,
      minOrder,
    },
    include: {
      product: {
        select: {
          id: true,
          name: true,
          sku: true,
        },
      },
    },
  });

  res.status(201).json({
    success: true,
    data: productSupplier,
    message: 'Product linked to supplier successfully',
  });
});

/**
 * Unlink product from supplier
 * DELETE /api/suppliers/:id/products/:productId
 */
export const unlinkProduct = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id, productId } = req.params;

  const supplier = await prisma.supplier.findUnique({ where: { id } });
  if (!supplier) {
    throw new AppError('Supplier not found', 404);
  }
  assertOwnsRecord(req, supplier.locationId);

  const existing = await prisma.productSupplier.findUnique({
    where: {
      productId_supplierId: {
        productId,
        supplierId: id,
      },
    },
  });

  if (!existing) {
    throw new AppError('Product-supplier link not found', 404);
  }

  await prisma.productSupplier.delete({
    where: {
      productId_supplierId: {
        productId,
        supplierId: id,
      },
    },
  });

  res.json({
    success: true,
    message: 'Product unlinked from supplier successfully',
  });
});

/**
 * Update product-supplier link
 * PUT /api/suppliers/:id/products/:productId
 */
export const updateProductLink = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id, productId } = req.params;
  const { supplierSku, cost, leadTime, minOrder } = req.body;

  const supplier = await prisma.supplier.findUnique({ where: { id } });
  if (!supplier) {
    throw new AppError('Supplier not found', 404);
  }
  assertOwnsRecord(req, supplier.locationId);

  const existing = await prisma.productSupplier.findUnique({
    where: {
      productId_supplierId: {
        productId,
        supplierId: id,
      },
    },
  });

  if (!existing) {
    throw new AppError('Product-supplier link not found', 404);
  }

  const productSupplier = await prisma.productSupplier.update({
    where: {
      productId_supplierId: {
        productId,
        supplierId: id,
      },
    },
    data: {
      supplierSku,
      cost,
      leadTime,
      minOrder,
    },
    include: {
      product: {
        select: {
          id: true,
          name: true,
          sku: true,
        },
      },
    },
  });

  res.json({
    success: true,
    data: productSupplier,
    message: 'Product-supplier link updated successfully',
  });
});

/**
 * Get supplier performance metrics
 * GET /api/suppliers/:id/performance
 */
export const getSupplierPerformance = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  const supplier = await prisma.supplier.findUnique({ where: { id } });
  if (!supplier) {
    throw new AppError('Supplier not found', 404);
  }
  assertCanReadRecord(req, supplier.locationId, 'Supplier not found');

  // Get purchase order statistics
  const orders = await prisma.purchaseOrder.findMany({
    where: { supplierId: id },
    select: {
      status: true,
      totalAmount: true,
      orderedAt: true,
      expectedAt: true,
      receivedAt: true,
      createdAt: true,
    },
  });

  const totalOrders = orders.length;
  const completedOrders = orders.filter(o => o.status === 'RECEIVED').length;
  const totalSpent = orders
    .filter(o => o.status === 'RECEIVED')
    .reduce((sum, o) => sum + o.totalAmount, 0);

  // Calculate on-time delivery rate
  let onTimeDeliveries = 0;
  let lateDeliveries = 0;

  orders.forEach(order => {
    if (order.status === 'RECEIVED' && order.expectedAt && order.receivedAt) {
      if (order.receivedAt <= order.expectedAt) {
        onTimeDeliveries++;
      } else {
        lateDeliveries++;
      }
    }
  });

  const onTimeRate = completedOrders > 0
    ? Math.round((onTimeDeliveries / completedOrders) * 100)
    : 0;

  // Get product count
  const productCount = await prisma.productSupplier.count({
    where: { supplierId: id },
  });

  // Calculate average order value
  const avgOrderValue = completedOrders > 0 ? totalSpent / completedOrders : 0;

  res.json({
    success: true,
    data: {
      totalOrders,
      completedOrders,
      pendingOrders: orders.filter(o => o.status === 'PENDING' || o.status === 'ORDERED').length,
      cancelledOrders: orders.filter(o => o.status === 'CANCELLED').length,
      totalSpent,
      avgOrderValue,
      onTimeDeliveryRate: onTimeRate,
      lateDeliveries,
      productCount,
    },
  });
});