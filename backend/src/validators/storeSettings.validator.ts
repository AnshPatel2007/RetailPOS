import { z } from 'zod';

const text = (max: number) => z.string().max(max);
export const receiptSettingsSchema = z.object({
  header: text(1000), footer: text(1000), showAddress: z.boolean(), showTaxBreakdown: z.boolean(),
}).strict();
export const paymentSettingsSchema = z.object({
  cash: z.boolean(), card: z.boolean(), giftCard: z.boolean(), storeCredit: z.boolean(),
}).strict();
export const notificationSettingsSchema = z.object({
  lowStockAlerts: z.boolean(), endOfDayReports: z.boolean(), emailNotifications: z.boolean(),
  notificationEmail: z.union([z.literal(''), z.string().email().max(254)]),
}).strict();
export const updateStoreSettingsSchema = z.object({ body: z.object({
  locationId: z.string().min(1).optional().nullable(),
  storeInfo: z.object({
    storeName: z.string().trim().min(1).max(150).optional(),
    address: text(300).optional(), city: text(100).optional(), state: text(100).optional(), phone: text(40).optional(),
    taxRate: z.number().finite().min(0).max(100).multipleOf(0.0001).optional(),
  }).strict().optional(),
  receiptSettings: receiptSettingsSchema.optional(),
  paymentMethods: paymentSettingsSchema.refine(methods => Object.values(methods).some(Boolean), 'Enable at least one payment method').optional(),
  notificationSettings: notificationSettingsSchema.optional(),
}).strict().refine(body => Object.keys(body).some(key => key !== 'locationId'), 'Choose settings to update') });

/** Only supported operational settings leave the API, never arbitrary JSON. */
export function publicStoreSettings(value: unknown) {
  const saved = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const receipt = receiptSettingsSchema.safeParse(saved.receiptSettings);
  const payments = paymentSettingsSchema.safeParse(saved.paymentMethods);
  const notifications = notificationSettingsSchema.safeParse(saved.notificationSettings);
  return {
    ...(receipt.success ? { receiptSettings: receipt.data } : {}),
    ...(payments.success ? { paymentMethods: payments.data } : {}),
    ...(notifications.success ? { notificationSettings: notifications.data } : {}),
  };
}
