import { Response } from 'express';
import { asyncHandler, AppError } from '../utils/errorHandler';
import { AuthRequest } from '../types';
import prisma from '../config/database';
import { Prisma } from '@prisma/client';
import { logger } from '../utils/logger';

/**
 * Get all products with filtering and pagination
 * GET /api/products
 */
export const getProducts = asyncHandler(async (req: AuthRequest, res: Response) => {
  const {
    page = 1,
    limit = 20,
    search = '',
    categoryId,
    isActive,
    inStock,
    lowStock,
  } = req.query;

  const pageNum = parseInt(page as string);
  const limitNum = parseInt(limit as string);
  const skip = (pageNum - 1) * limitNum;

  // Build filter
  const where: any = {};

  // Filter by user's location (unless SUPER_ADMIN viewing all)
  if (req.user?.locationId) {
    where.locationId = req.user.locationId;
  }

  if (search) {
    where.OR = [
      { name: { contains: search as string, mode: 'insensitive' } },
      { sku: { contains: search as string, mode: 'insensitive' } },
      { barcode: { contains: search as string, mode: 'insensitive' } },
    ];
  }

  if (categoryId) {
    where.categoryId = categoryId as string;
  }

  if (isActive !== undefined) {
    where.isActive = isActive === 'true';
  }

  if (inStock === 'true') {
    where.stockQuantity = { gt: 0 };
  }

  // Get products
  let products;
  let total;

  if (lowStock === 'true') {
    // Prisma doesn't support field-to-field comparison in the where clause natively yet.
    // We can use $queryRaw for this specific case or filter in memory if the dataset is small.
    // Given the context of a POS system, products might be many, but for now let's use a workaround.
    // Another way is to use a fixed threshold if available, or fetch and filter.
    // For now, let's use a common threshold or raw query.
    // Actually, we'll fetch all products that track inventory and then filter.
    const allTrackedProducts = await prisma.product.findMany({
      where: {
        ...where,
        trackInventory: true,
      },
      include: {
        category: {
          select: {
            id: true,
            name: true,
            color: true,
          },
        },
        location: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const lowStockProducts = allTrackedProducts.filter(p => p.stockQuantity <= p.lowStockAlert);
    total = lowStockProducts.length;
    products = lowStockProducts.slice(skip, skip + limitNum);
  } else {
    [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: {
          category: {
            select: {
              id: true,
              name: true,
              color: true,
            },
          },
          location: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        skip,
        take: limitNum,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.product.count({ where }),
    ]);
  }

  res.json({
    success: true,
    data: products,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
    },
  });
});

/**
 * Get single product
 * GET /api/products/:id
 */
export const getProduct = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      category: true,
      variants: true,
      location: true,
      suppliers: {
        include: {
          supplier: true,
        },
      },
    },
  });

  if (!product) {
    throw new AppError('Product not found', 404);
  }

  // Verify user has access to this product's location
  if (req.user?.locationId && product.locationId !== req.user.locationId) {
    throw new AppError('Product not found', 404);
  }

  res.json({
    success: true,
    data: product,
  });
});

/**
 * Create product
 * POST /api/products
 */
export const createProduct = asyncHandler(async (req: AuthRequest, res: Response) => {
  const data = req.body;

  // Check if SKU already exists
  const existingProduct = await prisma.product.findUnique({
    where: { sku: data.sku },
  });

  if (existingProduct) {
    throw new AppError('Product with this SKU already exists', 400);
  }

  // Check barcode uniqueness
  if (data.barcode) {
    const existingBarcode = await prisma.product.findUnique({
      where: { barcode: data.barcode },
    });

    if (existingBarcode) {
      throw new AppError('Product with this barcode already exists', 400);
    }
  }

  // Set locationId from authenticated user
  if (req.user?.locationId) {
    data.locationId = req.user.locationId;
  }

  const product = await prisma.product.create({
    data,
    include: {
      category: true,
    },
  });

  // Log activity
  await prisma.activityLog.create({
    data: {
      userId: req.user?.id,
      action: 'CREATE',
      entity: 'PRODUCT',
      entityId: product.id,
      details: { productName: product.name },
    },
  });

  logger.info(`Product created: ${product.name} (${product.sku})`);

  res.status(201).json({
    success: true,
    data: product,
    message: 'Product created successfully',
  });
});

/**
 * Update product
 * PUT /api/products/:id
 */
export const updateProduct = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const data = req.body;

  const product = await prisma.product.findUnique({ where: { id } });

  if (!product) {
    throw new AppError('Product not found', 404);
  }

  // Verify user has access to this product's location
  if (req.user?.locationId && product.locationId !== req.user.locationId) {
    throw new AppError('Product not found', 404);
  }

  // Check SKU uniqueness if changing
  if (data.sku && data.sku !== product.sku) {
    const existingSku = await prisma.product.findUnique({
      where: { sku: data.sku },
    });

    if (existingSku) {
      throw new AppError('Product with this SKU already exists', 400);
    }
  }

  const updatedProduct = await prisma.product.update({
    where: { id },
    data,
    include: {
      category: true,
    },
  });

  // Log activity
  await prisma.activityLog.create({
    data: {
      userId: req.user?.id,
      action: 'UPDATE',
      entity: 'PRODUCT',
      entityId: id,
      details: { productName: updatedProduct.name },
    },
  });

  logger.info(`Product updated: ${updatedProduct.name} (${updatedProduct.sku})`);

  res.json({
    success: true,
    data: updatedProduct,
    message: 'Product updated successfully',
  });
});

/**
 * Delete product
 * DELETE /api/products/:id
 */
export const deleteProduct = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  const product = await prisma.product.findUnique({ where: { id } });

  if (!product) {
    throw new AppError('Product not found', 404);
  }

  // Verify user has access to this product's location
  if (req.user?.locationId && product.locationId !== req.user.locationId) {
    throw new AppError('Product not found', 404);
  }

  await prisma.product.delete({ where: { id } });

  // Log activity
  await prisma.activityLog.create({
    data: {
      userId: req.user?.id,
      action: 'DELETE',
      entity: 'PRODUCT',
      entityId: id,
      details: { productName: product.name },
    },
  });

  logger.info(`Product deleted: ${product.name} (${product.sku})`);

  res.json({
    success: true,
    message: 'Product deleted successfully',
  });
});

/**
 * Get low stock products
 * GET /api/products/low-stock
 *
 * Uses a raw SQL query to compare stockQuantity <= lowStockAlert at the DB level,
 * avoiding the previous in-memory filter that loaded all tracked products.
 */
export const getLowStockProducts = asyncHandler(async (req: AuthRequest, res: Response) => {
  const locationId = req.user?.locationId ?? null;

  // Field-to-field comparison requires raw SQL (Prisma ORM doesn't support it in where)
  const locationClause = locationId
    ? Prisma.sql`AND p."locationId" = ${locationId}`
    : Prisma.empty;

  const lowStockProducts = await prisma.$queryRaw<any[]>`
    SELECT
      p.id, p.name, p.sku, p.barcode, p.price, p.cost,
      p."stockQuantity", p."lowStockAlert", p."trackInventory",
      p."isActive", p."locationId", p."categoryId", p."createdAt", p."updatedAt",
      p.image, p.description,
      json_build_object('id', c.id, 'name', c.name) AS category
    FROM products p
    LEFT JOIN categories c ON c.id = p."categoryId"
    WHERE p."trackInventory" = true
      AND p."isActive" = true
      AND p."stockQuantity" <= p."lowStockAlert"
      ${locationClause}
    ORDER BY p."stockQuantity" ASC
  `;

  res.json({
    success: true,
    data: lowStockProducts,
  });
});

/**
 * Adjust inventory
 * POST /api/products/:id/adjust-inventory
 */
export const adjustInventory = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { quantity, type, notes } = req.body;

  const product = await prisma.product.findUnique({ where: { id } });

  if (!product) {
    throw new AppError('Product not found', 404);
  }

  // Verify user has access to this product's location
  if (req.user?.locationId && product.locationId !== req.user.locationId) {
    throw new AppError('Product not found', 404);
  }

  const previousQty = product.stockQuantity;
  const newQty = previousQty + quantity;

  if (newQty < 0) {
    throw new AppError('Insufficient stock', 400);
  }

  // Update product stock
  const updatedProduct = await prisma.product.update({
    where: { id },
    data: { stockQuantity: newQty },
  });

  // Create inventory log
  await prisma.inventoryLog.create({
    data: {
      productId: id,
      type: type || 'ADJUSTMENT',
      quantity,
      previousQty,
      newQty,
      notes,
      userId: req.user?.id,
    },
  });

  logger.info(`Inventory adjusted for ${product.name}: ${previousQty} -> ${newQty}`);

  res.json({
    success: true,
    data: updatedProduct,
    message: 'Inventory adjusted successfully',
  });
});

/**
 * Bulk update stock quantities
 * POST /api/products/bulk-update-stock
 */
export const bulkUpdateStock = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { updates } = req.body; // Array of { productId, quantity, type, notes }

  if (!Array.isArray(updates) || updates.length === 0) {
    throw new AppError('Updates array is required', 400);
  }

  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const results = await prisma.$transaction(async (tx) => {
    const updated = [];

    for (const update of updates) {
      const { productId, quantity, type, notes } = update;

      if (!productId || quantity === undefined) {
        throw new AppError('Product ID and quantity are required for each update', 400);
      }

      const product = await tx.product.findUnique({
        where: { id: productId },
      });

      if (!product) {
        throw new AppError(`Product not found: ${productId}`, 404);
      }

      // Verify user has access to this product's location
      if (req.user?.locationId && product.locationId !== req.user.locationId) {
        throw new AppError(`Product not found: ${productId}`, 404);
      }

      if (!product.trackInventory) {
        continue; // Skip products that don't track inventory
      }

      const previousQty = product.stockQuantity;
      const newQty = type === 'set' ? quantity : previousQty + quantity;

      const updatedProduct = await tx.product.update({
        where: { id: productId },
        data: { stockQuantity: Math.max(0, newQty) },
      });

      await tx.inventoryLog.create({
        data: {
          productId,
          type: type || 'ADJUSTMENT',
          quantity: Math.abs(newQty - previousQty),
          previousQty,
          newQty: Math.max(0, newQty),
          notes: notes || 'Bulk stock adjustment',
          userId: req.user!.id,
        },
      });

      updated.push(updatedProduct);
      logger.info(`Bulk stock update for ${product.name}: ${previousQty} -> ${Math.max(0, newQty)}`);
    }

    return updated;
  });

  res.json({
    success: true,
    data: {
      updatedCount: results.length,
      products: results,
    },
    message: `${results.length} product(s) updated successfully`,
  });
});

/**
 * Bulk update prices
 * POST /api/products/bulk-update-price
 */
export const bulkUpdatePrice = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { productIds, priceUpdate, costUpdate } = req.body;

  if (!Array.isArray(productIds) || productIds.length === 0) {
    throw new AppError('Product IDs array is required', 400);
  }

  if (!priceUpdate && !costUpdate) {
    throw new AppError('At least one of priceUpdate or costUpdate is required', 400);
  }

  const updateData: any = {};
  if (priceUpdate !== undefined) updateData.price = parseFloat(priceUpdate);
  if (costUpdate !== undefined) updateData.cost = parseFloat(costUpdate);

  // Build where clause with location filter
  const where: any = {
    id: { in: productIds },
  };
  if (req.user?.locationId) {
    where.locationId = req.user.locationId;
  }

  const updatedProducts = await prisma.product.updateMany({
    where,
    data: updateData,
  });

  logger.info(`Bulk price update for ${updatedProducts.count} products`);

  res.json({
    success: true,
    data: {
      updatedCount: updatedProducts.count,
    },
    message: `${updatedProducts.count} product(s) updated successfully`,
  });
});

/**
 * Bulk update category
 * POST /api/products/bulk-update-category
 */
export const bulkUpdateCategory = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { productIds, categoryId } = req.body;

  if (!Array.isArray(productIds) || productIds.length === 0) {
    throw new AppError('Product IDs array is required', 400);
  }

  if (!categoryId) {
    throw new AppError('Category ID is required', 400);
  }

  // Verify category exists
  const category = await prisma.category.findUnique({
    where: { id: categoryId },
  });

  if (!category) {
    throw new AppError('Category not found', 404);
  }

  // Build where clause with location filter
  const where: any = {
    id: { in: productIds },
  };
  if (req.user?.locationId) {
    where.locationId = req.user.locationId;
  }

  const updatedProducts = await prisma.product.updateMany({
    where,
    data: {
      categoryId,
    },
  });

  logger.info(`Bulk category update for ${updatedProducts.count} products to ${category.name}`);

  res.json({
    success: true,
    data: {
      updatedCount: updatedProducts.count,
      categoryName: category.name,
    },
    message: `${updatedProducts.count} product(s) moved to ${category.name}`,
  });
});

/**
 * Bulk activate/deactivate products
 * POST /api/products/bulk-toggle-active
 */
export const bulkToggleActive = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { productIds, isActive } = req.body;

  if (!Array.isArray(productIds) || productIds.length === 0) {
    throw new AppError('Product IDs array is required', 400);
  }

  if (typeof isActive !== 'boolean') {
    throw new AppError('isActive must be a boolean', 400);
  }

  // Build where clause with location filter
  const where: any = {
    id: { in: productIds },
  };
  if (req.user?.locationId) {
    where.locationId = req.user.locationId;
  }

  const updatedProducts = await prisma.product.updateMany({
    where,
    data: {
      isActive,
    },
  });

  logger.info(`Bulk ${isActive ? 'activated' : 'deactivated'} ${updatedProducts.count} products`);

  res.json({
    success: true,
    data: {
      updatedCount: updatedProducts.count,
      isActive,
    },
    message: `${updatedProducts.count} product(s) ${isActive ? 'activated' : 'deactivated'}`,
  });
});
