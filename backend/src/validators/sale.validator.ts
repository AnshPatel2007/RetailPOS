import { z } from 'zod';

const saleItemSchema = z.object({
  productId: z.string().min(1, 'Product ID is required'),
  quantity: z.number().int().min(1, 'Quantity must be at least 1'),
  price: z.number().min(0, 'Price must be 0 or greater'),
  discount: z.number().min(0).optional(),
  notes: z.string().optional(),
  name: z.string().optional(),
});

export const createSaleSchema = z.object({
  body: z.object({
    customerId: z.string().uuid().optional(),
    items: z.array(saleItemSchema).min(1, 'At least one item is required'),
    paymentMethod: z.enum(['CASH', 'CARD', 'GIFT_CARD', 'STORE_CREDIT', 'OTHER']),
    amountPaid: z.number().min(0, 'Amount paid must be 0 or greater'),
    notes: z.string().optional(),
    receiptEmail: z.string().email().optional(),
  }),
});

export const refundSaleSchema = z.object({
  body: z.object({
    amount: z.number().min(0, 'Refund amount must be greater than 0'),
    reason: z.string().min(1, 'Refund reason is required'),
    notes: z.string().optional(),
  }),
});
