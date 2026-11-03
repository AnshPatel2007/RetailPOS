import { createHash } from 'crypto';
import { z } from 'zod';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import { AppError } from '../utils/errorHandler';
import { assertOwnsRecord } from '../utils/locationFilter.util';
import { cashAmount, lockCurrentDrawer } from './drawer.service';
import { lockInventory } from './inventory.service';
import { requestHash } from './managerApproval.service';
import { lockSale, voidSaleInTransaction } from './saleReversal.service';

const schema = z.object({
  idempotencyKey: z.string().uuid(),
  reason: z.string().trim().min(1).max(500),
  sales: z.array(z.object({ id: z.string().uuid(), expectedAmount: z.number().finite().nonnegative() }).strict()).min(1).max(50),
}).strict();

function memberKey(key: string, saleId: string) {
  const bytes = createHash('sha256').update('bulk-void:' + key + ':' + saleId).digest();
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function bulkVoid(req: AuthRequest) {
  const input = schema.parse(req.body);
  if (new Set(input.sales.map(sale => sale.id)).size !== input.sales.length) throw new AppError('Provide unique sale IDs', 400);
  input.sales.forEach(sale => cashAmount(sale.expectedAmount, 'Sale amount'));
  const sales = [...input.sales].sort((a, b) => a.id.localeCompare(b.id));
  const batchHash = requestHash('POST', '/api/sales/bulk-void', {
    ...input, sales, userId: req.user!.id, locationId: req.user!.locationId,
  });

  return prisma.$transaction(async tx => {
    // Serialize the same batch key even if a caller changes its selected sales.
    await tx.$queryRaw`SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtext(${input.idempotencyKey}))`;
    await lockCurrentDrawer(tx, req, false);
    for (const sale of sales) await lockSale(tx, sale.id);
    const originals = await tx.sale.findMany({ where: { id: { in: sales.map(sale => sale.id) } }, include: { items: true } });
    if (originals.length !== sales.length) throw new AppError('Sale not found', 404);
    originals.forEach(sale => assertOwnsRecord(req, sale.locationId));
    await lockInventory(tx, originals.flatMap(sale => sale.items.map(item => item.productId)));

    const results = [];
    for (const [index, sale] of sales.entries()) {
      // The first immutable event anchors the batch key. Its request hash binds
      // every member and amount, so changing even a later member rejects replay.
      // All events commit together; there can never be a partially saved batch.
      const request = { ...req, user: req.user, params: { id: sale.id }, body: {
        reason: input.reason, expectedAmount: sale.expectedAmount,
        idempotencyKey: index === 0 ? input.idempotencyKey : memberKey(input.idempotencyKey, sale.id),
      } } as unknown as AuthRequest;
      results.push(await voidSaleInTransaction(request, tx, batchHash));
    }
    return { voidedCount: results.length, voidedSales: results, replayed: results.every(sale => sale.replayed) };
  }, { timeout: 30000 });
}
