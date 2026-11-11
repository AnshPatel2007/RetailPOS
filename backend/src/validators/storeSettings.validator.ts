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
/** Cash handling rules for the store's drawers. */
export const cashControlSettingsSchema = z.object({ blindClose: z.boolean() }).strict();
/**
 * Blind close: a cashier counts the drawer before seeing what it should hold,
 * so the count is a count and not a copy of the expected figure. On unless the
 * owner turns it off. Managers and owners always see the expected amount.
 */
export function blindCloseEnabled(settings: unknown): boolean {
  const saved = settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as Record<string, unknown>).cashControl : undefined;
  const parsed = cashControlSettingsSchema.safeParse(saved);
  return parsed.success ? parsed.data.blindClose : true;
}
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
  cashControl: cashControlSettingsSchema.optional(),
}).strict().refine(body => Object.keys(body).some(key => key !== 'locationId'), 'Choose settings to update') });

/** The store facts and settings a signed-in user of that store may read (same shape as GET /locations/my-settings). */
export function storeSettingsView(location: { id: string; name: string; address: string; city: string; state: string; zipCode: string;
  phone: string; email: string; taxRate: unknown; cardSurchargePercent: unknown; timezone: string; isActive: boolean; settings: unknown; updatedAt: Date }) {
  return { id: location.id, name: location.name, address: location.address, city: location.city, state: location.state, zipCode: location.zipCode,
    phone: location.phone, email: location.email, taxRate: location.taxRate, cardSurchargePercent: location.cardSurchargePercent,
    timezone: location.timezone, isActive: location.isActive, settings: publicStoreSettings(location.settings),
    // When the store was last changed: lets a register ignore an answer older than the one it already holds.
    updatedAt: location.updatedAt };
}

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
    // Always present, so every screen applies the same default.
    cashControl: { blindClose: blindCloseEnabled(saved) },
  };
}
