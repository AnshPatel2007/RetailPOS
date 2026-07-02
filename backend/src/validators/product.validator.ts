import { z } from 'zod';

export const createProductSchema = z.object({
  body: z.object({
    sku: z.string().min(1, 'SKU is required'),
    name: z.string().min(1, 'Product name is required'),
    description: z.string().optional(),
    categoryId: z.string().uuid().optional(),
    cost: z.number().min(0, 'Cost must be 0 or greater'),
    price: z.number().gt(0, 'Price must be greater than 0'),
    compareAtPrice: z.number().min(0).optional(),
    trackInventory: z.boolean().optional(),
    stockQuantity: z.number().int().min(0).optional(),
    lowStockAlert: z.number().int().min(0).optional(),
    barcode: z.string().optional(),
    image: z.string().url().optional(),
    isTaxable: z.boolean().optional(),
    allowBackorder: z.boolean().optional(),
    locationId: z.string().uuid().optional(),
  }),
});

export const updateProductSchema = z.object({
  body: z.object({
    sku: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    categoryId: z.string().uuid().optional().nullable(),
    cost: z.number().min(0).optional(),
    price: z.number().gt(0, 'Price must be greater than 0').optional(),
    compareAtPrice: z.number().min(0).optional().nullable(),
    trackInventory: z.boolean().optional(),
    stockQuantity: z.number().int().min(0).optional(),
    lowStockAlert: z.number().int().min(0).optional(),
    barcode: z.string().optional().nullable(),
    image: z.string().url().optional().nullable(),
    isActive: z.boolean().optional(),
    isTaxable: z.boolean().optional(),
    allowBackorder: z.boolean().optional(),
  }),
});
