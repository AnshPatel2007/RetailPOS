import { BackgroundJob, Prisma } from '@prisma/client';
import { promises as fs } from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import prisma from '../config/database';
import { config } from '../config';
import { jobPayload, JobOutcome, JobFailure } from './jobQueue.service';
import { dateCondition, getFinancialMetrics, MetricRange } from './financialMetrics.service';
export type ExportPayload = { type: 'SALES_ACTIVITY' | 'INVENTORY' | 'EXPENSES'; start: string; end: string; timezone: string };
export function exportPath(id: string, artifactKey: string, temporary = false) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new JobFailure('INVALID_EXPORT_ID');
  if (!/^[0-9a-f-]{36}$/i.test(artifactKey)) throw new JobFailure('INVALID_ARTIFACT_ID');
  return path.join(path.resolve(config.upload.uploadDir, 'private', 'jobs'), id + '-' + artifactKey + (temporary ? '.partial' : '.csv'));
}
const csvCell = (value: unknown) => {
  let content = value === null || value === undefined ? '' : value instanceof Date ? value.toISOString() : String(value);
  if (typeof value === 'string' && /^[=+@\-\t\r]/.test(content)) content = "'" + content;
  return '"' + content.replace(/"/g, '""') + '"';
};
export async function generateExportJob(job: BackgroundJob): Promise<JobOutcome> {
  if (!job.locationId || !await prisma.user.findFirst({ where: { id: job.requestedBy || '', locationId: job.locationId, role: 'ADMIN', isActive: true, location: { isActive: true } } })) return { status: 'CANCELLED', code: 'OWNER_NO_LONGER_AUTHORIZED' };
  const payload = jobPayload<ExportPayload>(job), range: MetricRange = { gte: new Date(payload.start), lt: new Date(payload.end) };
  const temporary = exportPath(job.id, job.leaseToken!, true), destination = exportPath(job.id, job.leaseToken!), snapshotAt = new Date();
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const output = await fs.open(temporary, 'w'), hash = createHash('sha256'); let bytes = 0, count = 0, netCents = 0;
  const write = async (cells: unknown[]) => { const content = cells.map(csvCell).join(',') + '\r\n'; hash.update(content); bytes += Buffer.byteLength(content); await output.write(content); };
  try {
    await prisma.$transaction(async tx => {
      if (payload.type === 'SALES_ACTIVITY') {
        await write(['Entry', 'Record ID', 'Sale Number', 'Timestamp UTC', 'Store Date', 'Timezone', 'Payment Method', 'Amount Including Tax', 'Tax', 'Original Cashier']);
        let cursor: { at: Date; id: string; kind: string } | null = null;
        for (;;) {
          const rows: { kind: string; id: string; saleNumber: string; at: Date; method: string; amount: Prisma.Decimal; tax: Prisma.Decimal | null; cashier: string }[] = await tx.$queryRaw(Prisma.sql`
            WITH activity AS (
              SELECT CASE WHEN s."sourceType" = 'DAILY_SUMMARY' THEN 'DAILY_SUMMARY' ELSE 'SALE' END AS kind,s.id,s."saleNumber",s."createdAt" AS at,
                CASE WHEN s."sourceType" = 'DAILY_SUMMARY' THEN 'Card recorded; remainder unspecified' ELSE s."paymentMethod"::text END AS method,s.total AS amount,s.tax,
                CASE WHEN s."sourceType" = 'DAILY_SUMMARY' THEN NULL ELSE s."userId" END AS "userId"
              FROM sales s WHERE s."locationId" = ${job.locationId} AND (s.status IN ('COMPLETED','REFUNDED') OR (s.status = 'VOIDED' AND EXISTS (SELECT 1 FROM sale_voids v WHERE v."saleId" = s.id))) AND ${dateCondition(Prisma.sql`s."createdAt"`, range)}
              UNION ALL SELECT 'REFUND',r.id,s."saleNumber",r."createdAt",COALESCE(r.method::text,'UNAVAILABLE'),-r.amount,-r."taxAmount",s."userId"
              FROM refunds r JOIN sales s ON s.id=r."saleId" WHERE s."locationId" = ${job.locationId} AND s.status IN ('COMPLETED','REFUNDED') AND ${dateCondition(Prisma.sql`r."createdAt"`, range)}
              UNION ALL SELECT 'VOID',v.id,s."saleNumber",v."createdAt",s."paymentMethod"::text,-v.amount,-v."taxAmount",s."userId"
              FROM sale_voids v JOIN sales s ON s.id=v."saleId" WHERE s."locationId" = ${job.locationId} AND ${dateCondition(Prisma.sql`v."createdAt"`, range)}
            ) SELECT a.kind,a.id,a."saleNumber",a.at,a.method,a.amount,a.tax,
                CASE WHEN a.kind = 'DAILY_SUMMARY' THEN 'Not supplied (daily summary)' ELSE COALESCE(u."firstName" || ' ' || u."lastName",'Unavailable') END AS cashier
              FROM activity a LEFT JOIN users u ON u.id=a."userId" WHERE ${cursor ? Prisma.sql`(a.at,a.id,a.kind) > ((${cursor.at}::timestamptz AT TIME ZONE 'UTC'),${cursor.id},${cursor.kind})` : Prisma.sql`TRUE`}
              ORDER BY a.at,a.id,a.kind LIMIT 500`);
          for (const row of rows) { await write([row.kind,row.id,row.saleNumber,row.kind === 'DAILY_SUMMARY' ? null : row.at,row.at.toLocaleDateString('en-CA',{timeZone:payload.timezone}),payload.timezone,row.method,Number(row.amount),row.tax === null ? 'Unavailable' : Number(row.tax),row.cashier]); netCents += Math.round(Number(row.amount) * 100); count++; }
          if (rows.length < 500) break; const last = rows[rows.length - 1]; cursor = { at: last.at, id: last.id, kind: last.kind };
        }
        const metrics = await getFinancialMetrics({ locationId: job.locationId! }, range, tx);
        if (netCents !== Math.round(metrics.netCollected * 100)) throw new JobFailure('EXPORT_RECONCILIATION_FAILED');
      } else if (payload.type === 'INVENTORY') {
        await write(['Product ID','SKU','Name','Current Stock','Current Unit Cost','Current Price','Tracked','Active','Snapshot UTC']);
        let cursor: string | undefined;
        for (;;) {
          const rows = await tx.product.findMany({ where: { locationId: job.locationId, ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: 'asc' }, take: 500,
            select: { id:true,sku:true,name:true,stockQuantity:true,cost:true,price:true,trackInventory:true,isActive:true } });
          for (const row of rows) { await write([row.id,row.sku,row.name,row.stockQuantity,Number(row.cost),Number(row.price),row.trackInventory,row.isActive,snapshotAt]); count++; }
          if (rows.length < 500) break; cursor = rows[rows.length - 1].id;
        }
      } else if (payload.type === 'EXPENSES') {
        await write(['Expense ID','Number','Date UTC','Category','Status','Amount','Description','Source Type','Date Basis']); let cursor: string | undefined;
        for (;;) {
          const rows = await tx.expense.findMany({ where: { locationId: job.locationId, expenseDate: range, ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: 'asc' }, take: 500,
            select: { id:true,expenseNumber:true,expenseDate:true,category:true,status:true,amount:true,description:true,sourceType:true } });
          for (const row of rows) { await write([row.id,row.expenseNumber,row.expenseDate,row.category,row.status,Number(row.amount),row.description,row.sourceType,row.sourceType === 'MONTHLY_SUMMARY' ? 'Month-end recognition; transaction and payment dates not supplied' : 'Recorded expense date']); count++; }
          if (rows.length < 500) break; cursor = rows[rows.length - 1].id;
        }
      } else throw new JobFailure('UNSUPPORTED_EXPORT_TYPE');
    }, { isolationLevel: 'RepeatableRead', timeout: 90000 });
    await output.sync(); await output.close(); await fs.rename(temporary, destination);
    return { status: 'COMPLETE', result: { artifactKey: job.leaseToken!, filename: payload.type.toLowerCase().replace(/_/g, '-') + '.csv', bytes, sha256: hash.digest('hex'), recordCount: count,
      ...(payload.type === 'SALES_ACTIVITY' ? { netCollected: netCents / 100 } : {}), snapshotAt: snapshotAt.toISOString(), timezone: payload.timezone, start: payload.start, endExclusive: payload.end } };
  } catch (error) { await output.close().catch(() => {}); await fs.rm(temporary, { force: true }).catch(() => {}); throw error; }
}
