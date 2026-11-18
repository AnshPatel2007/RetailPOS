import { BackgroundJob, Prisma } from '@prisma/client';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'crypto';
import prisma from '../config/database';
import { AppError } from '../utils/errorHandler';
import { requestHash } from './managerApproval.service';
import { numeric } from '../utils/money';

type JobInput = { idempotencyKey: string; kind: 'WEBHOOK' | 'EMAIL' | 'EXPORT'; locationId?: string | null; requestedBy?: string | null; label: string; payload: unknown };
const secret = () => {
  const value = process.env.JOB_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!value || value.length < 32) throw new AppError('Background job encryption is not configured', 503);
  return createHash('sha256').update('pos-background-jobs-v1:' + value).digest();
};
const context = (job: { kind: string; idempotencyKey: string }) => Buffer.from(job.kind + ':' + job.idempotencyKey);
const seal = (job: JobInput) => {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', secret(), iv); cipher.setAAD(context(job));
  const content = Buffer.concat([cipher.update(JSON.stringify(numeric(job.payload)), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), content.toString('base64')].join('.');
};
export function jobPayload<T = Record<string, any>>(job: Pick<BackgroundJob, 'kind' | 'idempotencyKey' | 'payload'>): T {
  const [version, iv, tag, content] = job.payload.split('.');
  if (version !== 'v1' || !iv || !tag || !content) throw new Error('PAYLOAD_UNREADABLE');
  const cipher = createDecipheriv('aes-256-gcm', secret(), Buffer.from(iv, 'base64')); cipher.setAAD(context(job)); cipher.setAuthTag(Buffer.from(tag, 'base64'));
  return JSON.parse(Buffer.concat([cipher.update(Buffer.from(content, 'base64')), cipher.final()]).toString('utf8'));
}
export const jobSelect = { id: true, kind: true, status: true, label: true, attempts: true, maxAttempts: true, availableAt: true, lastError: true, createdAt: true, finishedAt: true, result: true } as const;
const inputHash = (input: JobInput) => requestHash('JOB', input.kind, { locationId: input.locationId || null, requestedBy: input.requestedBy || null, label: input.label, payload: input.payload });
/** Call inside the originating business transaction. A rolled-back sale has no jobs. */
export async function enqueueJob(tx: Prisma.TransactionClient, input: JobInput) {
  const securityEmail = input.kind === 'EMAIL' && !!input.payload && typeof input.payload === 'object' && (input.payload as {type?:unknown}).type === 'SECURITY';
  if (input.kind !== 'WEBHOOK' && !input.locationId && !securityEmail) throw new AppError('This job requires a store', 400);
  if (JSON.stringify(input.payload).length > 500000) throw new AppError('Job content is too large', 413);
  await tx.backgroundJob.createMany({ data: [{ ...input, locationId: input.locationId || null, requestedBy: input.requestedBy || null, payload: seal(input) }], skipDuplicates: true });
  const job = await tx.backgroundJob.findUniqueOrThrow({ where: { idempotencyKey: input.idempotencyKey } });
  const previous: JobInput = { idempotencyKey: job.idempotencyKey, kind: job.kind as JobInput['kind'], locationId: job.locationId, requestedBy: job.requestedBy, label: job.label, payload: jobPayload(job) };
  if (inputHash(previous) !== inputHash(input)) throw new AppError('This job retry key belongs to a different request', 409);
  return { id: job.id, kind: job.kind, status: job.status, label: job.label, attempts: job.attempts };
}
/** A new immutable manifest owns these keys; its parent operation guards replay. */
export async function enqueueJobManifest(tx: Prisma.TransactionClient, inputs: JobInput[]) {
  for (let start = 0; start < inputs.length; start += 500) await tx.backgroundJob.createMany({ data: inputs.slice(start, start + 500).map(input => ({
    ...input, locationId: input.locationId || null, requestedBy: input.requestedBy || null, payload: seal(input),
  })) });
}
export type JobOutcome = { status: 'COMPLETE' | 'ACCEPTED' | 'RETRY' | 'FAILED' | 'REVIEW' | 'CANCELLED'; code?: string; result?: Prisma.InputJsonValue };
export class JobFailure extends Error {
  constructor(public code: string, public retryable = false, public uncertain = false) { super(code); }
}
const retryAt = (attempt: number, now: Date) => new Date(now.getTime() + Math.min(3600000, 30000 * 2 ** Math.max(0, attempt - 1)));
async function finish(job: BackgroundJob, outcome: JobOutcome, now: Date) {
  const status = outcome.status === 'RETRY' && job.attempts >= job.maxAttempts ? 'FAILED' : outcome.status;
  return prisma.$transaction(async tx => {
    const changed = await tx.backgroundJob.updateMany({ where: { id: job.id, status: 'RUNNING', leaseToken: job.leaseToken }, data: {
      status, lastError: outcome.code || null, leaseToken: null, leaseExpiresAt: null,
      availableAt: status === 'RETRY' ? retryAt(job.attempts, now) : now,
      finishedAt: ['COMPLETE', 'ACCEPTED', 'FAILED', 'CANCELLED'].includes(status) ? now : null,
      ...(outcome.result ? { result: outcome.result } : {}),
    } });
    if (changed.count) await tx.backgroundJobAttempt.create({ data: { jobId: job.id, number: job.attempts,
      startedAt: new Date(job.leaseExpiresAt!.getTime() - 120000), finishedAt: now, outcome: status, code: outcome.code } });
    return changed.count === 1;
  });
}
export async function recoverExpiredJobs(now = new Date()) {
  const expired = await prisma.backgroundJob.findMany({ where: { status: 'RUNNING', leaseExpiresAt: { lte: now } }, orderBy: { leaseExpiresAt: 'asc' }, take: 100 });
  for (const job of expired) await finish(job, { status: job.kind === 'EMAIL' ? 'REVIEW' : 'RETRY', code: 'LEASE_EXPIRED_RESULT_UNKNOWN' }, now);
  return expired.length;
}
export async function processNextBackgroundJob(execute: (job: BackgroundJob) => Promise<JobOutcome>, now = new Date()) {
  await recoverExpiredJobs(now);
  const token = randomUUID(), expiry = new Date(now.getTime() + 120000);
  const [job] = await prisma.$queryRaw<BackgroundJob[]>`UPDATE background_jobs SET status = 'RUNNING', attempts = attempts + 1,
    "leaseToken" = ${token}, "leaseExpiresAt" = (${expiry}::timestamptz AT TIME ZONE 'UTC'), "updatedAt" = (${now}::timestamptz AT TIME ZONE 'UTC')
    WHERE id = (SELECT id FROM background_jobs WHERE status IN ('QUEUED','RETRY') AND "availableAt" <= (${now}::timestamptz AT TIME ZONE 'UTC') AND attempts < "maxAttempts"
      ORDER BY "availableAt", "createdAt", id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`;
  if (!job) return false;
  let outcome: JobOutcome;
  try { outcome = await execute(job); }
  catch (error) {
    outcome = error instanceof JobFailure ? { status: error.uncertain ? 'REVIEW' : error.retryable ? 'RETRY' : 'FAILED', code: error.code }
      : { status: job.kind === 'EMAIL' ? 'REVIEW' : 'RETRY', code: 'EXECUTION_FAILED' };
  }
  await finish(job, outcome, new Date());
  return true;
}
