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
  paymentMethod: z.enum(['CASH', 'CARD', 'GIFT_CARD', 'STORE_CREDIT', 'EBT', 'HOUSE_ACCOUNT', 'OTHER']),
  // A fully redeemed purchase may have a zero cash settlement. The pricing
  // transaction rejects zero entries whenever an amount is still due.
  amount: z.number().finite().min(0, 'Payment amount cannot be negative').multipleOf(0.01, 'Payment amounts must use whole cents'),
  reference: z.string().optional(),
});

const ageVerificationSchema = z.object({
  method: z.enum(['ID_SCAN', 'MANUAL_DOB', 'VISUAL']),
  birthDate: z.string().optional(), // ISO date; required server-side for ID_SCAN / MANUAL_DOB
});

export const createSaleSchema = z.object({
  body: z.object({
    customerId: z.string().uuid().optional(),
    items: z.array(saleItemSchema).min(1, 'At least one item is required'),
    paymentMethod: z.enum(['CASH', 'CARD', 'GIFT_CARD', 'STORE_CREDIT', 'EBT', 'HOUSE_ACCOUNT', 'OTHER']),
    amountPaid: z.number().finite().min(0, 'Amount paid must be 0 or greater').multipleOf(0.01, 'Amount paid must use whole cents'),
    payments: z.array(paymentEntrySchema).max(20).optional(), // Successive payments for the same sale
    pointsRedeemed: z.number().int().min(0).optional(), // Loyalty points to redeem
    ageVerification: ageVerificationSchema.optional(), // required when cart has age-restricted items
    notes: z.string().optional(),
    receiptEmail: z.string().email().optional(),
    idempotencyKey: z.string().uuid().optional(),
    offlineCreatedAt: z.string().datetime().optional(),
    offlineShiftId: z.string().uuid().optional(),
    expectedShiftId: z.string().uuid().optional(),
    expectedTotal: z.number().finite().min(0).optional(),
  }),
});

const refundItemSchema = z.object({
  saleItemId: z.string().min(1, 'Sale item ID is required'),
  quantity: z.number().int().min(1, 'Refund quantity must be at least 1'),
  restockAsSealed: z.boolean().optional(),
});

export const refundSaleSchema = z.object({
  body: z.object({
    idempotencyKey: z.string().uuid().optional(),
    expectedAmount: z.number().finite().min(0).multipleOf(0.01).optional(),
    // Amount is required for money-only refunds; when items are provided the
    // server computes the amount from the item lines instead
    amount: z.number().finite().min(0.01, 'Refund amount must be greater than 0').multipleOf(0.01).optional(),
    reason: z.string().trim().min(1, 'Refund reason is required').max(500),
    notes: z.string().max(2000).optional(),
    items: z.array(refundItemSchema).max(500).optional(),
    restock: z.boolean().optional(), // restock returned items (default true, item refunds only)
    refundMethod: z.enum(['CASH', 'CARD', 'GIFT_CARD', 'STORE_CREDIT', 'HOUSE_ACCOUNT']).optional(),
    reference: z.string().trim().max(150).optional(),
    refundTenders: z.array(z.object({ sourcePaymentId: z.string().min(1).max(100),
      method: z.enum(['CASH', 'CARD', 'GIFT_CARD', 'STORE_CREDIT', 'HOUSE_ACCOUNT']),
      amount: z.number().finite().positive().multipleOf(0.01), reference: z.string().trim().max(150).optional(),
    }).strict()).max(20).optional(),
  }).refine(
    (data) => data.amount !== undefined || (data.items && data.items.length > 0),
    { message: 'Either a refund amount or refund items must be provided' }
  ),
});

export const quoteSaleSchema = z.object({ body: z.object({
  items: z.array(saleItemSchema).min(1).max(500),
  customerId: z.string().uuid().optional(),
  pointsRedeemed: z.number().int().min(0).optional(),
  paymentMethod: paymentEntrySchema.shape.paymentMethod.optional(),
  payments: z.array(paymentEntrySchema).max(20).optional(),
}) });
