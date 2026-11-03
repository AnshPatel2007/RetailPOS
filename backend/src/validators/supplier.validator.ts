import { z } from 'zod';

export const createSupplierSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Supplier name is required'),
    contactName: z.string().optional(),
    email: z.string().email('Invalid email').optional().nullable(),
    phone: z.string().optional().nullable(),
    address: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    paymentTerms: z.string().optional().nullable(),
    leadTimeDays: z.number().int().min(0).optional().nullable(),
    minimumOrder: z.number().min(0).optional().nullable(),
  }),
});

export const updateSupplierSchema = z.object({
  body: z.object({
    name: z.string().min(1).optional(),
    contactName: z.string().optional().nullable(),
    email: z.string().email('Invalid email').optional().nullable(),
    phone: z.string().optional().nullable(),
    address: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    isActive: z.boolean().optional(),
    paymentTerms: z.string().optional().nullable(),
    leadTimeDays: z.number().int().min(0).optional().nullable(),
    minimumOrder: z.number().min(0).optional().nullable(),
  }),
});

export const linkProductSchema = z.object({
  body: z.object({
    productId: z.string().uuid('Invalid product ID'),
    supplierSku: z.string().optional().nullable(),
    cost: z.number().min(0, 'Cost must be non-negative').optional().nullable(),
    leadTime: z.number().int().min(0).optional().nullable(),
    minOrder: z.number().int().min(1).optional().nullable(),
    // How the supplier sells it, e.g. a case of 24 for $36.00.
    packSize: z.number().int().min(1).max(100000).optional(),
    packCost: z.number().min(0).optional().nullable(),
    packBarcode: z.string().trim().max(100).optional().nullable(),
  }),
});

export const updateProductLinkSchema = z.object({
  body: z.object({
    supplierSku: z.string().optional().nullable(),
    cost: z.number().min(0, 'Cost must be non-negative').optional().nullable(),
    leadTime: z.number().int().min(0).optional().nullable(),
    minOrder: z.number().int().min(1).optional().nullable(),
    // How the supplier sells it, e.g. a case of 24 for $36.00.
    packSize: z.number().int().min(1).max(100000).optional(),
    packCost: z.number().min(0).optional().nullable(),
    packBarcode: z.string().trim().max(100).optional().nullable(),
  }),
});

export const createPurchaseOrderSchema = z.object({
  body: z.object({
    supplierId: z.string().uuid('Invalid supplier ID'),
    items: z.array(z.object({
      productId: z.string().uuid('Invalid product ID'),
      quantity: z.number().int().min(1, 'Quantity must be at least 1'),
      cost: z.number().min(0, 'Cost must be non-negative'),
      // Ordered in supplier cases: quantity = packQuantity x packSize (units).
      packSize: z.number().int().min(1).max(100000).optional(),
      packQuantity: z.number().int().min(1).optional().nullable(),
      packCost: z.number().min(0).optional().nullable(),
    })).min(1, 'At least one item is required'),
    notes: z.string().optional().nullable(),
    expectedAt: z.string().optional().nullable(),
  }),
});

export const updatePurchaseOrderSchema = z.object({
  body: z.object({
    notes: z.string().optional().nullable(),
    expectedAt: z.string().optional().nullable(),
    items: z.array(z.object({
      productId: z.string().uuid('Invalid product ID'),
      quantity: z.number().int().min(1, 'Quantity must be at least 1'),
      cost: z.number().min(0, 'Cost must be non-negative'),
      // Ordered in supplier cases: quantity = packQuantity x packSize (units).
      packSize: z.number().int().min(1).max(100000).optional(),
      packQuantity: z.number().int().min(1).optional().nullable(),
      packCost: z.number().min(0).optional().nullable(),
    })).optional(),
  }),
});

export const updateStatusSchema = z.object({
  body: z.object({
    status: z.enum(['PENDING', 'ORDERED', 'RECEIVED', 'CANCELLED']),
  }),
});

export const receivePurchaseOrderSchema = z.object({
  body: z.object({
    invoiceNumber: z.string().trim().min(1).max(100).optional(),
    invoiceDate: z.string().datetime().optional(),
    freight: z.number().finite().min(0).max(1000000).default(0),
    acquisitionTax: z.number().finite().min(0).max(1000000).default(0),
    invoiceDiscount: z.number().finite().min(0).max(1000000).default(0),
    receivedItems: z.array(z.object({
      unitCost: z.number().finite().min(0).max(1000000).optional(),
      zeroCostConfirmed: z.boolean().default(false),
      packSize: z.number().int().min(1).max(100000).default(1),
      packQuantity: z.number().int().min(0).max(1000000).optional(),
      sellingUnitId: z.string().uuid().optional(),
      receivedPackageQuantity: z.number().int().min(0).max(1000000).optional(),
      lineDiscount: z.number().finite().min(0).max(1000000).default(0),
      productId: z.string().min(1).optional(),
      purchaseOrderItemId: z.string().min(1).optional(),
      quantity: z.number().int().min(0).max(2147483647),
      damagedQty: z.number().int().min(0).max(2147483647).default(0),
      rejectedQty: z.number().int().min(0).max(2147483647).default(0),
    }).refine(item => !!item.productId || !!item.purchaseOrderItemId, { message: 'Select an order item' })).max(1000).optional(),
    idempotencyKey: z.string().uuid().optional(),
    finalDelivery: z.boolean().default(false),
    notes: z.string().trim().max(2000).optional(),
  }),
});
