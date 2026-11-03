import { z } from 'zod';

const amount = z.number().finite().nonnegative().max(999999999.99).refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 0.00001);
const sale = z.object({ id: z.string().uuid(), expectedAmount: amount }).strict();
const pendingSchema = z.object({
  payload: z.object({ idempotencyKey: z.string().uuid(), reason: z.string().min(1).max(500).refine(value => !!value.trim()), sales: z.array(sale).min(1).max(50) }).strict(),
  labels: z.record(z.string().min(1)),
  externalReversal: z.boolean().optional(),
}).strict().refine(value => new Set(value.payload.sales.map(sale => sale.id)).size === value.payload.sales.length
  && value.payload.sales.every(sale => !!value.labels[sale.id]));

export type PendingBulkVoid = z.infer<typeof pendingSchema>;
export type BulkVoidRequest = PendingBulkVoid['payload'];
export const bulkVoidStorageKey = (userId: string, locationId: string) => `pos-pending-bulk-void:${locationId}:${userId}`;

export function readPendingBulkVoid(key: string): PendingBulkVoid | null {
  const value = localStorage.getItem(key);
  if (value === null) return null;
  return pendingSchema.parse(JSON.parse(value));
}
