import { ADJUSTMENT_REASONS } from './inventoryAdjustment.controller';
import { costKindForReason } from '../services/stockReasons';
import { assertSellingIdentifiersAvailable, packagingSummary, projectSellingUnit } from '../services/productSellingUnit.service';
import { Response } from 'express';
import { asyncHandler, AppError } from '../utils/errorHandler';
import { AuthRequest } from '../types';
import prisma from '../config/database';
import { Prisma } from '@prisma/client';
import { logger } from '../utils/logger';
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { assertOwnsRecord, getLocationFilter } from '../utils/locationFilter.util';
import { lockInventory, moveInventory } from '../services/inventory.service';
import { valueProducts } from '../services/inventoryValueRead.service';
import { barcodeVariants } from '../utils/barcode';
import { can } from '../policies/capabilities';

/**
 * A product may only be moved into a category the caller's store owns. Keeping
 * the category it already has is always allowed, so products filed under an
 * older category with no store (created before stores existed) stay editable.
 */
async function validateProductCategory(req: AuthRequest, categoryId?: string | null, currentCategoryId?: string | null) {
  if (!categoryId || categoryId === currentCategoryId) return;
  const category = await prisma.category.findUnique({ where: { id: categoryId } });
  if (!category) throw new AppError('Category not found', 404);
  assertOwnsRecord(req, category.locationId);
}

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
    trackInventory,
    ids,
    includeSellingUnits,
    excludeVarietyPacks,
    updatedSince,
  } = req.query;
  // The register asks for packs too (a 12-pack is its own tile and barcode);
  // inventory screens list each product once with its packs nested.
  const withPacks = includeSellingUnits === 'true';
  const requestedIds = ids ? String(ids).split(',').filter(Boolean) : null;
  // Register catalog sync: only products (or their packs) changed since the last
  // sync, including ones archived since then, so the register can drop them.
  // The time is read before querying, so a change made during this request is
  // picked up by the next sync.
  const serverTime = new Date();
  const since = typeof updatedSince === 'string' && updatedSince ? new Date(updatedSince) : null;
  if (since && !Number.isFinite(since.getTime())) throw new AppError('updatedSince must be a date', 400);

  const pageNum = Math.max(1, parseInt(page as string) || 1);
  const limitNum = Math.min(1000, Math.max(1, parseInt(limit as string) || 20));
  const skip = (pageNum - 1) * limitNum;

  // Build filter
  const locationScope = getLocationFilter(req, req.query.locationId as string);
  const where: any = { ...locationScope, sku: { not: 'MISC-001' } };
  const conditions: any[] = [];

  if (search) {
    where.OR = [
      { name: { contains: search as string, mode: 'insensitive' } },
      { sku: { contains: search as string, mode: 'insensitive' } },
      { barcode: { contains: search as string, mode: 'insensitive' } },
      // Scanning a pack barcode finds the product it belongs to.
      { sellingUnits: { some: { OR: [
        { barcode: { contains: search as string, mode: 'insensitive' } },
        { sku: { contains: search as string, mode: 'insensitive' } },
        { name: { contains: search as string, mode: 'insensitive' } },
      ] } } },
    ];
  }

  if (categoryId) {
    where.categoryId = categoryId as string;
  }

  // Fetch a specific set of products (comma-separated ids)
  if (requestedIds) {
    // An id may be a pack's id; it resolves to the product it belongs to.
    conditions.push({ OR: [{ id: { in: requestedIds } }, { sellingUnits: { some: { id: { in: requestedIds } } } }] });
  }
  if (since) conditions.push({ OR: [{ updatedAt: { gte: since } }, { sellingUnits: { some: { updatedAt: { gte: since } } } }] });
  if (conditions.length) where.AND = conditions;

  // A sync must also see archived rows, so it ignores the active filter.
  if (isActive !== undefined && !since) {
    where.isActive = isActive === 'true';
  }
  if (trackInventory !== undefined) where.trackInventory = trackInventory === 'true';
  // Inventory > Single items: variety packs are listed under Packs instead.
  if (excludeVarietyPacks === 'true') where.bundleComponents = { none: {} };

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
        sellingUnits: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const lowStockProducts = allTrackedProducts.filter(p => p.stockQuantity > 0 && p.stockQuantity <= p.lowStockAlert);
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
          sellingUnits: true,
        },
        skip,
        take: limitNum,
        // The id keeps pages stable when several products share a creation time.
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      }),
      prisma.product.count({ where }),
    ]);
  }

  const valued = await valueProducts(prisma, products);
  const rows = valued.flatMap(product => {
    const base = packagingSummary(product);
    // A sync also gets archived packs (isActive false) so the register drops them.
    const units = withPacks ? product.sellingUnits.filter(unit => since || unit.isActive || requestedIds?.includes(unit.id)) : [];
    return [
      ...(!requestedIds || requestedIds.includes(product.id) ? [base] : []),
      ...units.filter(unit => !requestedIds || requestedIds.includes(unit.id)).map(unit => projectSellingUnit(product, unit)),
    ];
  });

  // How many sellable rows (products and packs) the store has, so a register can
  // tell when its copy is missing rows a "changed since" sync cannot report
  // (a product deleted outright) and download everything again.
  let activeTotal: number | undefined;
  if (since) {
    const active = { ...locationScope, isActive: true, sku: { not: 'MISC-001' } };
    const [activeProducts, activePacks] = await Promise.all([
      prisma.product.count({ where: active }),
      prisma.productSellingUnit.count({ where: { isActive: true, product: active } }),
    ]);
    activeTotal = activeProducts + activePacks;
  }

  res.json({
    success: true,
    data: rows,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
    },
    serverTime: serverTime.toISOString(),
    ...(activeTotal !== undefined ? { activeTotal } : {}),
  });
});

/**
 * Exact barcode lookup for scanning: the register (when its own copy has no
 * match) and receiving. UPC/EAN forms of one code match each other. Supplier
 * case barcodes are for receiving and are only returned to managers.
 * GET /api/products/resolve-barcode?code=
 */
export const resolveBarcode = asyncHandler(async (req: AuthRequest, res: Response) => {
  const code = typeof req.query.code === 'string' ? req.query.code.trim() : '';
  if (!code || code.length > 100) throw new AppError('Scan or type a barcode', 400);
  const { locationId } = getLocationFilter(req, req.query.locationId as string);
  if (!locationId) throw new AppError('Select a store to look up barcodes', 400);
  const variants = barcodeVariants(code);
  const include = { category: { select: { id: true, name: true, color: true } }, sellingUnits: true } as const;
  const sellable = { locationId, isActive: true, sku: { not: 'MISC-001' } };
  const [products, packs, cases] = await Promise.all([
    prisma.product.findMany({ where: { ...sellable, barcode: { in: variants } }, include, orderBy: { id: 'asc' } }),
    prisma.productSellingUnit.findMany({ where: { locationId, isActive: true, barcode: { in: variants }, product: sellable },
      include: { product: { include } }, orderBy: { id: 'asc' } }),
    can(req.user?.role, 'inventory.read')
      ? prisma.productSupplier.findMany({ where: { packBarcode: { in: variants }, product: sellable, supplier: { locationId } },
        include: { supplier: { select: { id: true, name: true } }, product: { include } }, orderBy: { id: 'asc' } })
      : Promise.resolve([]),
  ]);
  const valued = new Map((await valueProducts(prisma, [...products, ...packs.map(pack => pack.product), ...cases.map(link => link.product)]))
    .map(product => [product.id, product]));
  const matches = [
    ...products.map(product => ({ kind: 'PRODUCT' as const, product: packagingSummary(valued.get(product.id)!) })),
    ...packs.map(pack => ({ kind: 'PACK' as const, product: projectSellingUnit(valued.get(pack.product.id)!, pack) })),
    ...cases.map(link => ({ kind: 'SUPPLIER_CASE' as const, product: packagingSummary(valued.get(link.product.id)!),
      supplierCase: { supplierId: link.supplier.id, supplierName: link.supplier.name, packSize: link.packSize,
        packCost: link.packCost === null ? null : Number(link.packCost) } })),
  ];
  res.json({ success: true, data: { code, matches } });
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
    data: (await valueProducts(prisma, [product]))[0],
  });
});

/**
 * Create product
 * POST /api/products
 */
export const createProduct = asyncHandler(async (req: AuthRequest, res: Response) => {
  const data = req.body;

  // Set locationId from authenticated user (non-SUPER_ADMIN always scoped to
  // their own store; SUPER_ADMIN may leave it unset for a chain-wide product)
  if (req.user?.locationId) {
    data.locationId = req.user.locationId;
  }
  const targetLocationId = data.locationId ?? null;
  await validateProductCategory(req, data.categoryId);

  // Check if SKU already exists — SKU is unique per-store, not globally
  const existingProduct = await prisma.product.findFirst({
    where: { sku: data.sku, locationId: targetLocationId },
  });

  if (existingProduct) {
    throw new AppError('Product with this SKU already exists', 400);
  }

  // Check barcode uniqueness (same per-store scope)
  if (data.barcode) {
    const existingBarcode = await prisma.product.findFirst({
      where: { barcode: data.barcode, locationId: targetLocationId },
    });

    if (existingBarcode) {
      throw new AppError('Product with this barcode already exists', 400);
    }
  }
  // A pack (e.g. a 12-pack) may already use this barcode or SKU.
  await assertSellingIdentifiersAvailable(prisma, { locationId: targetLocationId, barcode: data.barcode || null, sku: data.sku || null });

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
      locationId: req.user?.locationId ?? null,
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
  const { expectedStockVersion, stockAdjustmentReason, stockAdjustmentNotes, ...data } = req.body;

  const product = await prisma.product.findUnique({ where: { id } });

  if (!product) {
    throw new AppError('Product not found', 404);
  }

  // Verify user has access to this product's location
  if (req.user?.locationId && product.locationId !== req.user.locationId) {
    throw new AppError('Product not found', 404);
  }
  await validateProductCategory(req, data.categoryId, product.categoryId);

  // Check SKU uniqueness if changing — scoped to the product's own store
  if (data.sku && data.sku !== product.sku) {
    const existingSku = await prisma.product.findFirst({
      where: { sku: data.sku, locationId: product.locationId },
    });

    if (existingSku) {
      throw new AppError('Product with this SKU already exists', 400);
    }
  }

  // Check barcode uniqueness if changing (same per-store scope)
  if (data.barcode && data.barcode !== product.barcode) {
    const existingBarcode = await prisma.product.findFirst({
      where: { barcode: data.barcode, locationId: product.locationId },
    });

    if (existingBarcode) {
      throw new AppError('Product with this barcode already exists', 400);
    }
  }
  // A pack (e.g. a 12-pack) may already use this barcode or SKU.
  await assertSellingIdentifiersAvailable(prisma, { locationId: product.locationId,
    barcode: data.barcode && data.barcode !== product.barcode ? data.barcode : null, sku: data.sku && data.sku !== product.sku ? data.sku : null });

  const updateFields = { ...data };
  delete updateFields.stockQuantity;
  const updatedProduct = await prisma.$transaction(async tx => {
    await lockInventory(tx, [id]);
    const current = await tx.product.findUniqueOrThrow({ where: { id } });
    assertOwnsRecord(req, current.locationId);
    if (data.trackInventory !== undefined && data.trackInventory !== current.trackInventory &&
      (current.stockQuantity !== 0 || await tx.inventoryValueEntry.count({ where: { productId: id } })))
      throw new AppError('Stock tracking cannot change after inventory activity. Archive this product and create a separate product with the intended tracking setting.', 409);
    const updated = await tx.product.update({ where: { id }, data: updateFields, include: { category: true } });
    if (data.stockQuantity === undefined || data.stockQuantity === current.stockQuantity) return updated;
    if (expectedStockVersion === undefined) throw new AppError('Refresh the product before changing its stock quantity', 409);
    if (!(ADJUSTMENT_REASONS as readonly string[]).includes(stockAdjustmentReason)) throw new AppError('Select a reason for this stock change', 400);
    if (stockAdjustmentReason === 'OTHER' && !stockAdjustmentNotes?.trim()) throw new AppError('Describe the reason when choosing Other', 400);
    const moved = await moveInventory(tx, { productId: id, locationId: req.user!.locationId!, userId: req.user!.id, type: stockAdjustmentReason, costKind: costKindForReason(stockAdjustmentReason, data.stockQuantity - current.stockQuantity, 'ADJUSTMENT'), setQuantity: data.stockQuantity, expectedVersion: expectedStockVersion, notes: stockAdjustmentNotes?.trim() || 'Product edit' });
    return { ...updated, stockQuantity: moved.stockQuantity, stockVersion: moved.stockVersion };
  });

  // Log activity with change details
  const changes: Record<string, { from: any; to: any }> = {};
  if (data.price !== undefined && data.price !== Number(product.price)) {
    changes.price = { from: product.price, to: data.price };
  }
  if (data.cost !== undefined && data.cost !== Number(product.cost)) {
    changes.cost = { from: product.cost, to: data.cost };
  }
  if (data.stockQuantity !== undefined && data.stockQuantity !== product.stockQuantity) {
    changes.stockQuantity = { from: product.stockQuantity, to: data.stockQuantity };
  }

  await prisma.activityLog.create({
    data: {
      userId: req.user?.id,
      action: Object.keys(changes).includes('price') ? 'PRICE_CHANGE' : 'UPDATE',
      entity: 'PRODUCT',
      entityId: id,
      details: { productName: updatedProduct.name, sku: updatedProduct.sku, changes },
      locationId: req.user?.locationId ?? null,
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

  await prisma.$transaction(async tx => {
    await lockInventory(tx, [id]);
    if (await tx.inventoryValueEntry.count({ where: { productId: id } })) throw new AppError('This product has inventory cost history. Archive it to preserve its records.', 409);
    if (await tx.productBundleComponent.count({ where: { componentProductId: id } })) throw new AppError('This product is inside a variety pack. Remove it from the pack first.', 409);
    await tx.product.delete({ where: { id } });
  });

  // Log activity
  await prisma.activityLog.create({
    data: {
      userId: req.user?.id,
      action: 'DELETE',
      entity: 'PRODUCT',
      entityId: id,
      details: { productName: product.name },
      locationId: req.user?.locationId ?? null,
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
  const { locationId } = getLocationFilter(req, req.query.locationId as string);

  // Field-to-field comparison requires raw SQL (Prisma ORM doesn't support it in where)
  const locationClause = locationId
    ? Prisma.sql`AND p."locationId" = ${locationId}`
    : Prisma.sql`AND p."locationId" IS NOT NULL`;

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
      AND p.sku <> 'MISC-001'
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
 * Aggregate product stats for the inventory dashboard cards
 * GET /api/products/stats
 */
export const getProductStats = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { locationId } = getLocationFilter(req, req.query.locationId as string);
  const [stats] = await prisma.$queryRaw<{ totalProducts: number; lowStockCount: number; outOfStockCount: number; unvaluedCount: number; inventoryValue: number | null }[]>(Prisma.sql`
    SELECT COUNT(*)::int AS "totalProducts",
      -- In-stock items without a known cost; while any exist the total value is unknown.
      COUNT(*) FILTER (WHERE "trackInventory" AND "stockQuantity" > 0 AND v.value IS NULL)::int AS "unvaluedCount",
      COUNT(*) FILTER (WHERE "trackInventory" AND "stockQuantity" > 0 AND "stockQuantity" <= "lowStockAlert")::int AS "lowStockCount",
      COUNT(*) FILTER (WHERE "trackInventory" AND "stockQuantity" <= 0)::int AS "outOfStockCount",
      CASE WHEN COUNT(*) FILTER (WHERE "trackInventory" AND "stockQuantity" > 0 AND v.value IS NULL) > 0 THEN NULL
        ELSE COALESCE(SUM(v.value) FILTER (WHERE "trackInventory"),0)::float END AS "inventoryValue"
    FROM products p LEFT JOIN inventory_valuations v ON v."productId" = p.id WHERE "isActive" AND sku <> 'MISC-001'
      AND ${locationId ? Prisma.sql`p."locationId" = ${locationId}` : Prisma.sql`p."locationId" IS NOT NULL`}
  `);

  res.json({
    success: true,
    data: {
      ...stats,
      inventoryValue: stats.inventoryValue === null ? null : Math.round(stats.inventoryValue * 100) / 100,
    },
  });
});

export { adjustInventory, bulkUpdateStock } from './inventoryAdjustment.controller';

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
  assertOwnsRecord(req, category.locationId);

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

/**
 * Scan a supplier receipt/invoice image and extract product data
 * POST /api/products/scan-receipt
 */
export const scanReceipt = asyncHandler(async (req: AuthRequest, res: Response) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new AppError('Receipt scanning is not configured. Please set ANTHROPIC_API_KEY in your environment.', 500);
  }

  const file = req.file;
  if (!file) {
    throw new AppError('No receipt image uploaded', 400);
  }

  // Read the file and convert to base64
  const imageBuffer = fs.readFileSync(file.path);
  const base64Image = imageBuffer.toString('base64');

  // Determine media type
  const mimeMap: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
  };
  const ext = path.extname(file.originalname).toLowerCase();
  const mediaType = mimeMap[ext] || 'image/jpeg';

  // Also fetch existing products so Claude can try to match names
  const locationWhere: any = {};
  if (req.user?.locationId) {
    locationWhere.locationId = req.user.locationId;
  }
  const catalog = await prisma.product.findMany({
    where: { ...locationWhere, isActive: true },
    select: { id: true, name: true, sku: true, barcode: true, price: true, cost: true,
      sellingUnits: { where: { isActive: true }, select: { id: true, name: true, barcode: true, unitsPerPackage: true } } },
    orderBy: { name: 'asc' },
  });
  const existingProducts = catalog.map(({ sellingUnits: _units, ...product }) => product);
  // Packs (e.g. "Marlboro Red Carton", 10 packs) are bought as a unit; their lines land on the single.
  const existingPacks = catalog.flatMap(product => product.sellingUnits.map(unit => ({
    sellingUnitId: unit.id, name: unit.name, barcode: unit.barcode, unitsPerPackage: unit.unitsPerPackage,
    productId: product.id, productName: product.name, productSku: product.sku, price: product.price, cost: product.cost })));

  const productListForContext = [
    ...existingProducts.map(p => `${p.name} (SKU: ${p.sku}${p.barcode ? ', Barcode: ' + p.barcode : ''})`),
    ...existingPacks.map(pack => `${pack.name} (pack of ${pack.unitsPerPackage} x ${pack.productName}, Barcode: ${pack.barcode})`),
  ].join('\n');

  const anthropic = new Anthropic({ apiKey });

  const response = await anthropic.messages.create({
    // claude-sonnet-4-20250514 was retired June 2026 — this endpoint 404'd until
    // the migration to Opus 4.8. Structured outputs also guarantee parseable JSON.
    model: 'claude-opus-4-8',
    max_tokens: 4096,
    thinking: { type: 'adaptive' },
    output_config: {
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            supplier: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            invoiceNumber: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            invoiceDate: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  quantity: { type: 'number' },
                  packSize: { type: 'number' },
                  unitQuantity: { type: 'number' },
                  unitCost: { type: 'number' },
                  totalCost: { type: 'number' },
                  barcode: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                  matchedProductName: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                },
                required: ['name', 'quantity', 'packSize', 'unitQuantity', 'unitCost', 'totalCost', 'barcode', 'matchedProductName'],
                additionalProperties: false,
              },
            },
          },
          required: ['supplier', 'invoiceNumber', 'invoiceDate', 'items'],
          additionalProperties: false,
        },
      },
    },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
              data: base64Image,
            },
          },
          {
            type: 'text',
            text: `You are a POS system assistant. Analyze this supplier receipt/invoice image and extract all product information.

Return ONLY valid JSON (no markdown, no code fences) in this exact format:
{
  "supplier": "Company/Supplier name from the receipt",
  "invoiceNumber": "Invoice/receipt number if visible, or null",
  "invoiceDate": "Date on the receipt if visible (YYYY-MM-DD), or null",
  "items": [
    {
      "name": "Product name exactly as shown",
      "quantity": 1,
      "packSize": 1,
      "unitQuantity": 1,
      "unitCost": 0.00,
      "totalCost": 0.00,
      "barcode": "barcode if visible, or null",
      "matchedProductName": "name of best matching existing product or null"
    }
  ]
}

IMPORTANT rules for quantities:
- "quantity" = number of cases/packs/cartons received (what's on the receipt)
- "packSize" = number of individual units per case/pack (e.g., a carton of cigarettes has 10 packs, a case of soda has 24 cans)
- "unitQuantity" = quantity × packSize = total individual units to add to inventory
- If the receipt says "2 x Marlboro Red (10pk)" that means quantity=2, packSize=10, unitQuantity=20
- If pack size is not specified, assume packSize=1
- Extract unit costs if visible. unitCost should be per individual unit (totalCost / unitQuantity)
- Entries listed below as "pack of N x Product" are cases/cartons of that product: when a line is one of them, use its exact name in matchedProductName and set packSize to N

Here are the existing products in the system. Try to match receipt items to these:
${productListForContext}

If an item closely matches an existing product, put the existing product name in "matchedProductName". Otherwise set it to null.`,
          },
        ],
      },
    ],
  });

  // Clean up uploaded file
  fs.unlinkSync(file.path);

  // Extract the text response
  const textContent = response.content.find(c => c.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new AppError('Failed to analyze receipt image', 500);
  }

  try {
    // Parse the JSON response - strip any markdown fences if present
    let jsonText = textContent.text.trim();
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }
    const extractedData = JSON.parse(jsonText);

    // Enrich with existing product matches: a pack (by barcode or name) lands on its single
    // with the pack's size, so a $100 carton of 10 makes each single $10.
    if (extractedData.items && Array.isArray(extractedData.items)) {
      for (const item of extractedData.items) {
        const wanted = typeof item.matchedProductName === 'string' ? item.matchedProductName.toLowerCase() : null;
        const pack = existingPacks.find(candidate => (item.barcode && candidate.barcode === item.barcode) || (wanted && candidate.name.toLowerCase() === wanted));
        const match = pack ? null : existingProducts.find(p => (item.barcode && p.barcode === item.barcode) || (wanted && p.name.toLowerCase() === wanted));
        if (pack) {
          item.matchedProductId = pack.productId;
          item.matchedProductSku = pack.productSku;
          item.matchedProductName = pack.productName;
          item.sellingUnitId = pack.sellingUnitId;
          item.packName = pack.name;
          item.packSize = pack.unitsPerPackage;
          item.unitQuantity = item.quantity * pack.unitsPerPackage;
          if (item.totalCost > 0 && item.unitQuantity > 0) item.unitCost = Math.round(item.totalCost / item.unitQuantity * 10000) / 10000;
          item.existingPrice = pack.price;
          item.existingCost = pack.cost;
        } else if (match) {
          item.matchedProductId = match.id;
          item.matchedProductSku = match.sku;
          item.existingPrice = match.price;
          item.existingCost = match.cost;
        }
      }
    }

    // Also return the full product and pack lists for the frontend to allow manual matching
    extractedData.existingProducts = existingProducts;
    extractedData.existingPacks = existingPacks;

    logger.info(`Receipt scanned: ${extractedData.supplier || 'Unknown'}, ${extractedData.items?.length || 0} items extracted`);

    res.json({
      success: true,
      data: extractedData,
    });
  } catch (parseError) {
    logger.error('Failed to parse receipt scan response:', textContent.text);
    throw new AppError('Failed to parse receipt data. Please try again with a clearer image.', 500);
  }
});

/**
 * Apply scanned receipt data - create/update products and adjust inventory
 * POST /api/products/apply-receipt
 */
export const applyReceipt = asyncHandler(async () => {
  throw new AppError('Review the receipt import and apply its saved preview. Refresh the app to continue.', 428);
});
