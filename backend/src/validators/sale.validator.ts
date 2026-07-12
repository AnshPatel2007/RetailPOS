import { z } from 'zod';

const saleItemSchema = z.object({
  productId: z.string().min(1, 'Product ID is required'),
  quantity: z.number().int().min(1, 'Quantity must be at least 1'),
  price: z.number().min(0, 'Price must be 0 or greater'),
  discount: z.number().min(0, 'Discount cannot be negative').optional(),
  priceOverride: z.boolean().optional(),
  notes: z.string().optional(),
  name: z.string().max(200).optional(),
}).refine(data => {
  if (data.discount && data.discount > data.price * data.quantity) {
    return false;
  }
  return true;
}, { message: 'Discount cannot exceed item total' });

const paymentEntrySchema = z.object({
  paymentMethod: z.enum(['CASH', 'CARD', 'GIFT_CARD', 'STORE_CREDIT', 'OTHER']),
  amount: z.number().min(0.01, 'Payment amount must be greater than 0'),
  reference: z.string().optional(),
});

export const createSaleSchema = z.object({
  body: z.object({
    customerId: z.string().uuid().optional(),
    items: z.array(saleItemSchema).min(1, 'At least one item is required'),
    paymentMethod: z.enum(['CASH', 'CARD', 'GIFT_CARD', 'STORE_CREDIT', 'OTHER']),
    amountPaid: z.number().min(0, 'Amount paid must be 0 or greater'),
    payments: z.array(paymentEntrySchema).optional(), // Split payment support
    pointsRedeemed: z.number().int().min(0).optional(), // Loyalty points to redeem
    notes: z.string().optional(),
    receiptEmail: z.string().email().optional(),
    idempotencyKey: z.string().uuid().optional(),
  }),
});

const refundItemSchema = z.object({
  saleItemId: z.string().min(1, 'Sale item ID is required'),
  quantity: z.number().int().min(1, 'Refund quantity must be at least 1'),
});

export const refundSaleSchema = z.object({
  body: z.object({
    // Amount is required for money-only refunds; when items are provided the
    // server computes the amount from the item lines instead
    amount: z.number().min(0.01, 'Refund amount must be greater than 0').optional(),
    reason: z.string().min(1, 'Refund reason is required'),
    notes: z.string().optional(),
    items: z.array(refundItemSchema).optional(),
    restock: z.boolean().optional(), // restock returned items (default true, item refunds only)
    refundMethod: z.enum(['CASH', 'CARD', 'GIFT_CARD', 'STORE_CREDIT']).optional(),
    reference: z.string().optional(), // gift card code when refundMethod = GIFT_CARD
  }).refine(
    (data) => data.amount !== undefined || (data.items && data.items.length > 0),
    { message: 'Either a refund amount or refund items must be provided' }
  ),
});
