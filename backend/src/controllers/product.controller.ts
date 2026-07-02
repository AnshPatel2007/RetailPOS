import { Response } from 'express';
import { asyncHandler, AppError } from '../utils/errorHandler';
import { AuthRequest } from '../types';
import prisma from '../config/database';
import { Prisma } from '@prisma/client';
import { logger } from '../utils/logger';
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';

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

  // Check barcode uniqueness if changing
  if (data.barcode && data.barcode !== product.barcode) {
    const existingBarcode = await prisma.product.findUnique({
      where: { barcode: data.barcode },
    });

    if (existingBarcode) {
      throw new AppError('Product with this barcode already exists', 400);
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

  // Wrap in transaction to prevent race conditions
  const updatedProduct = await prisma.$transaction(async (tx) => {
    const product = await tx.product.findUnique({ where: { id } });

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
      throw new AppError(`Insufficient stock. Current: ${previousQty}, adjustment: ${quantity}`, 400);
    }

    // Update product stock
    const updated = await tx.product.update({
      where: { id },
      data: { stockQuantity: newQty },
    });

    // Create inventory log
    await tx.inventoryLog.create({
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

    return updated;
  });

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
  const existingProducts = await prisma.product.findMany({
    where: { ...locationWhere, isActive: true },
    select: { id: true, name: true, sku: true, barcode: true, price: true, cost: true },
    orderBy: { name: 'asc' },
  });

  const productListForContext = existingProducts
    .map(p => `${p.name} (SKU: ${p.sku}${p.barcode ? ', Barcode: ' + p.barcode : ''})`)
    .join('\n');

  const anthropic = new Anthropic({ apiKey });

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
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

    // Enrich with existing product matches
    if (extractedData.items && Array.isArray(extractedData.items)) {
      for (const item of extractedData.items) {
        if (item.matchedProductName) {
          const match = existingProducts.find(
            p => p.name.toLowerCase() === item.matchedProductName.toLowerCase()
          );
          if (match) {
            item.matchedProductId = match.id;
            item.matchedProductSku = match.sku;
            item.existingPrice = match.price;
            item.existingCost = match.cost;
          }
        }
      }
    }

    // Also return the full product list for the frontend to allow manual matching
    extractedData.existingProducts = existingProducts;

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
export const applyReceipt = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { supplier, invoiceNumber, items } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    throw new AppError('No items to apply', 400);
  }

  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  // Find or create supplier
  let supplierId: string | null = null;
  if (supplier) {
    let existingSupplier = await prisma.supplier.findFirst({
      where: { name: { equals: supplier, mode: 'insensitive' } },
    });

    if (!existingSupplier) {
      existingSupplier = await prisma.supplier.create({
        data: { name: supplier },
      });
      logger.info(`Created new supplier: ${supplier}`);
    }

    supplierId = existingSupplier.id;
  }

  const results = await prisma.$transaction(async (tx) => {
    const processed: any[] = [];

    for (const item of items) {
      const {
        matchedProductId,
        name,
        unitQuantity,
        unitCost,
        sku,
        barcode,
        categoryId,
      } = item;

      let product;

      if (matchedProductId) {
        // Update existing product inventory
        product = await tx.product.findUnique({ where: { id: matchedProductId } });
        if (!product) {
          throw new AppError(`Product not found: ${matchedProductId}`, 404);
        }

        const previousQty = product.stockQuantity;
        const newQty = previousQty + (unitQuantity || 0);

        // Update cost if provided
        const updateData: any = { stockQuantity: newQty };
        if (unitCost && unitCost > 0) {
          updateData.cost = unitCost;
        }

        product = await tx.product.update({
          where: { id: matchedProductId },
          data: updateData,
        });

        await tx.inventoryLog.create({
          data: {
            productId: matchedProductId,
            type: 'RECEIVED',
            quantity: unitQuantity || 0,
            previousQty,
            newQty,
            notes: `Receipt scan${invoiceNumber ? ` - Invoice #${invoiceNumber}` : ''}${supplier ? ` from ${supplier}` : ''}`,
            userId: req.user!.id,
          },
        });

        processed.push({ action: 'updated', product: { id: product.id, name: product.name }, addedQty: unitQuantity });
      } else {
        // Create new product
        const newSku = sku || `NEW-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

        const createData: any = {
          sku: newSku,
          name: name || 'Unknown Product',
          stockQuantity: unitQuantity || 0,
          lowStockAlert: 5,
          cost: unitCost || 0,
          price: unitCost ? Math.round(unitCost * 1.3 * 100) / 100 : 0, // Default 30% markup
          isTaxable: true,
          trackInventory: true,
          isActive: true,
        };

        if (barcode) createData.barcode = barcode;
        if (categoryId) createData.categoryId = categoryId;
        if (req.user?.locationId) createData.locationId = req.user.locationId;

        product = await tx.product.create({ data: createData });

        await tx.inventoryLog.create({
          data: {
            productId: product.id,
            type: 'RECEIVED',
            quantity: unitQuantity || 0,
            previousQty: 0,
            newQty: unitQuantity || 0,
            notes: `Initial stock from receipt scan${invoiceNumber ? ` - Invoice #${invoiceNumber}` : ''}${supplier ? ` from ${supplier}` : ''}`,
            userId: req.user!.id,
          },
        });

        // Link to supplier if found
        if (supplierId) {
          await tx.productSupplier.create({
            data: {
              productId: product.id,
              supplierId,
              cost: unitCost || 0,
            },
          });
        }

        processed.push({ action: 'created', product: { id: product.id, name: product.name, sku: newSku }, addedQty: unitQuantity });
      }
    }

    return processed;
  });

  logger.info(`Receipt applied: ${results.length} products processed from ${supplier || 'unknown supplier'}`);

  res.json({
    success: true,
    data: {
      processedCount: results.length,
      items: results,
      supplier,
    },
    message: `${results.length} product(s) processed successfully`,
  });
});
