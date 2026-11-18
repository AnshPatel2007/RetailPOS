import { EmailDelivery } from '@prisma/client';
import { randomUUID } from 'crypto';
import prisma from '../config/database';
import { sendEmail } from '../utils/email';
import { AppError } from '../utils/errorHandler';
import { logger } from '../utils/logger';

export const deliverySelect = { id: true, recipientEmail: true, subject: true, status: true, attempts: true, errorCode: true, acceptedAt: true, createdAt: true, updatedAt: true } as const;

/** Optional list that narrows who receives the morning brief (OWNER_BRIEF_EMAILS; the older DAILY_DIGEST_EMAILS still works). */
export const briefAllowlist = () => (process.env.OWNER_BRIEF_EMAILS || process.env.DAILY_DIGEST_EMAILS || '').split(',').map(email => email.trim().toLowerCase()).filter(Boolean);

export async function enqueueDigestEmails(locationId: string, key: string, recipients: string[], subject: string, html: string) {
  // Anyone who runs the store as ADMIN (home store or as an owner of its business).
  const owners = await prisma.user.findMany({ where: { isActive: true, email: { in: recipients }, storeAccess: { some: { locationId, role: 'ADMIN', location: { isActive: true } } } }, select: { id: true, email: true } });
  const keys = owners.map(owner => key + ':' + owner.id);
  await prisma.emailDelivery.createMany({ data: owners.map((owner, index) => ({ locationId, recipientId: owner.id, recipientEmail: owner.email, idempotencyKey: keys[index], subject, html })), skipDuplicates: true });
  return prisma.emailDelivery.findMany({ where: { locationId, idempotencyKey: { in: keys } }, select: deliverySelect, orderBy: { createdAt: 'asc' } });
}

/** A crash or lost provider response must not silently resend a possibly accepted message. */
export async function recoverExpiredEmailDeliveries(now = new Date()) {
  return prisma.emailDelivery.updateMany({ where: { status: 'SENDING', leaseExpiresAt: { lte: now } },
    data: { status: 'REVIEW', errorCode: 'DELIVERY_UNKNOWN', leaseToken: null, leaseExpiresAt: null } });
}

export async function processNextEmailDelivery(now = new Date()): Promise<boolean> {
  await recoverExpiredEmailDeliveries(now);
  const leaseToken = randomUUID(), leaseExpiresAt = new Date(now.getTime() + 120000);
  const rows = await prisma.$queryRaw<EmailDelivery[]>`
    UPDATE email_deliveries SET status = 'SENDING', attempts = attempts + 1, "leaseToken" = ${leaseToken}, "leaseExpiresAt" = (${leaseExpiresAt}::timestamptz AT TIME ZONE 'UTC'), "updatedAt" = (${now}::timestamptz AT TIME ZONE 'UTC')
    WHERE id = (SELECT id FROM email_deliveries WHERE status = 'QUEUED' ORDER BY "createdAt", id FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING *`;
  const job = rows[0]; if (!job) return false;
  const finish = (data: Parameters<typeof prisma.emailDelivery.updateMany>[0]['data']) => prisma.emailDelivery.updateMany({ where: { id: job.id, leaseToken, status: 'SENDING' }, data: { ...data, leaseToken: null, leaseExpiresAt: null } });
  const owner = job.recipientId ? await prisma.user.findFirst({ where: { id: job.recipientId, email: job.recipientEmail, isActive: true, storeAccess: { some: { locationId: job.locationId, role: 'ADMIN', location: { isActive: true } } } }, select: { id: true } }) : null;
  const allowlist = briefAllowlist();
  if (!owner || (allowlist.length > 0 && !allowlist.includes(job.recipientEmail.toLowerCase()))) {
    await finish({ status: 'CANCELLED', errorCode: 'RECIPIENT_NO_LONGER_AUTHORIZED' }); return true;
  }
  try {
    await sendEmail({ to: job.recipientEmail, subject: job.subject, html: job.html });
    await finish({ status: 'ACCEPTED', acceptedAt: new Date(), errorCode: null });
  } catch (error) {
    const code = (error as { code?: string })?.code;
    const knownFailure = code === 'NOT_CONFIGURED' || code === 'PROVIDER_REJECTED';
    await finish({ status: knownFailure ? 'FAILED' : 'REVIEW', errorCode: knownFailure ? code : 'DELIVERY_UNKNOWN' });
  }
  return true;
}

export async function retryEmailDelivery(locationId: string, id: string, userId: string, reason: string, confirmedNotDelivered: boolean) {
  return prisma.$transaction(async tx => {
    const job = await tx.emailDelivery.findFirst({ where: { id, locationId } });
    if (!job) throw new AppError('Delivery not found', 404);
    if (!['FAILED', 'REVIEW'].includes(job.status)) throw new AppError('This delivery cannot be retried', 409);
    if (job.status === 'REVIEW' && !confirmedNotDelivered) throw new AppError('Check provider delivery history and confirm no email was delivered before retrying', 409);
    const changed = await tx.emailDelivery.updateMany({ where: { id, locationId, status: job.status }, data: { status: 'QUEUED', errorCode: null, leaseToken: null, leaseExpiresAt: null } });
    if (!changed.count) throw new AppError('Delivery changed. Refresh its status.', 409);
    await tx.activityLog.create({ data: { locationId, userId, action: 'EMAIL_DELIVERY_RETRY', entity: 'EmailDelivery', entityId: id, details: { reason, previousStatus: job.status, confirmedNotDelivered } } });
    return tx.emailDelivery.findUnique({ where: { id }, select: deliverySelect });
  });
}

let running = false;
export function startEmailDeliveryWorker() {
  if (process.env.EMAIL_DELIVERY_WORKER_DISABLED === 'true') return;
  const timer = setInterval(() => {
    if (running) return; running = true;
    void (async () => { for (let i = 0; i < 5; i++) if (!await processNextEmailDelivery()) break; })()
      .catch(() => logger.error('Email delivery worker failed; queued deliveries remain stored'))
      .finally(() => { running = false; });
  }, 5000);
  timer.unref();
}
