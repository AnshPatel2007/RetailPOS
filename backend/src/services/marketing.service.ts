/**
 * Customer marketing: birthday emails and segment campaigns.
 *
 * Only opted-in customers (emailMarketing: true) with an email address are
 * ever contacted. Birthday sends are guarded to once per year per customer.
 */

import prisma from '../config/database';
import { AuthRequest } from '../types';
import { Prisma } from '@prisma/client';
import { queueEmail } from './queuedEmail.service';
import { enqueueJobManifest } from './jobQueue.service';
import { recordOperation } from './operationReceipt.service';
import { getReportCalendar } from './reportDates.service';
import { logger } from '../utils/logger';
import { config } from '../config';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const wrapEmail = (title: string, bodyHtml: string): string => `<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;color:#333;margin:0;padding:0;background:#f1f1f4;">
  <div style="max-width:520px;margin:0 auto;padding:24px 16px;">
    <div style="background:#fff;border-radius:12px;padding:28px;">
      <h2 style="margin:0 0 16px;color:#111;">${title}</h2>
      ${bodyHtml}
      <p style="margin:24px 0 0;font-size:13px;color:#555;">— ${esc(config.app.name || 'Your local store')}</p>
    </div>
    <p style="text-align:center;font-size:11px;color:#999;margin-top:12px;">
      You're receiving this because you opted into emails at ${esc(config.app.name || 'our store')}.
    </p>
  </div>
</body></html>`;

/**
 * Send birthday emails to opted-in customers whose birthday is today.
 * One per customer per year (lastBirthdayEmailAt guard).
 */
export const sendBirthdayEmails = async (now = new Date(), onlyDueHour = false): Promise<number> => {
  const stores = await prisma.location.findMany({ where: { isActive: true }, select: { id:true } }); let queued = 0;
  const hour = Math.min(23, Math.max(0, Number(process.env.BIRTHDAY_EMAIL_HOUR || 9)));
  for (const store of stores) {
    const calendar = await getReportCalendar({ locationId: store.id }, now);
    if (onlyDueHour && Number(new Intl.DateTimeFormat('en-US', { timeZone: calendar.timezone, hour:'numeric', hourCycle:'h23' }).format(now)) !== hour) continue;
    const candidates = await prisma.$queryRaw<{ id:string; firstName:string; email:string; lastBirthdayEmailAt:Date|null }[]>      `SELECT id,"firstName",email,"lastBirthdayEmailAt" FROM customers WHERE "locationId" = ${store.id} AND "emailMarketing" = true AND "isActive" = true AND email IS NOT NULL
        AND EXTRACT(MONTH FROM "birthDate") = ${calendar.month} AND EXTRACT(DAY FROM "birthDate") = ${calendar.dayOfMonth}`;
    for (const customer of candidates) {
      if (customer.lastBirthdayEmailAt && Number(customer.lastBirthdayEmailAt.toLocaleDateString('en-CA', {timeZone:calendar.timezone}).slice(0,4)) >= calendar.year) continue;
      const key = 'birthday:' + store.id + ':' + customer.id + ':' + calendar.year;
      const added = await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtext(${key}))`;
        if (await tx.backgroundJob.findUnique({where:{idempotencyKey:'email:'+key},select:{id:true}})) return false;
        const perk = process.env.BIRTHDAY_PERK_TEXT || 'Visit us today. We hope you have a wonderful birthday.';
        await queueEmail(tx, store.id, null, key, {type:'BIRTHDAY',recipientId:customer.id,to:customer.email,year:calendar.year,
          subject:'Happy Birthday, '+customer.firstName+'!',html:wrapEmail('Happy Birthday, '+esc(customer.firstName)+'!', '<p>'+esc(perk)+'</p>')}); return true;
      });
      if (added) queued++;
    }
  }
  return queued;
};

export type CampaignSegment = 'all' | 'lapsed30' | 'lapsed60' | 'top20' | `tag:${string}`;

/** Resolve a segment to its opted-in recipients */
export const resolveSegment = async (
  segment: string,
  locationId: string,
  db: Pick<Prisma.TransactionClient, 'customer'> = prisma
): Promise<{ id: string; firstName: string; email: string }[]> => {
  if (!locationId) throw new Error('Campaigns require an assigned store');
  const optedIn = { locationId, emailMarketing: true, isActive: true, email: { not: null } } as const;

  const daysAgo = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d;
  };

  let where: any = { ...optedIn };
  let take: number | undefined;
  let orderBy: any;

  if (segment === 'all') {
    // just opted-in
  } else if (segment === 'lapsed30' || segment === 'lapsed60') {
    const cutoff = daysAgo(segment === 'lapsed30' ? 30 : 60);
    where = { ...optedIn, OR: [{ lastVisitAt: { lt: cutoff } }, { lastVisitAt: null }] };
  } else if (segment === 'top20') {
    orderBy = { totalSpent: 'desc' as const };
    take = 20;
  } else if (segment.startsWith('tag:')) {
    const tag = segment.slice(4).trim().toLowerCase();
    if (!tag) return [];
    where = { ...optedIn, tags: { has: tag } };
  } else {
    return [];
  }

  const customers = await db.customer.findMany({
    where,
    orderBy,
    take,
    select: { id: true, firstName: true, email: true },
  });
  return customers.filter((c): c is { id: string; firstName: string; email: string } => !!c.email);
};

/**
 * Send a campaign email to a segment. Plain-text message becomes a simple
 * branded HTML email; {firstName} in subject/message is personalized.
 */
export const sendCampaign = async (req: AuthRequest, segment: string, subject: string, message: string, key: string) =>
  recordOperation(req, 'CAMPAIGN_QUEUED', segment, key, { segment, subject, message }, async tx => {
    const recipients = await resolveSegment(segment, req.user!.locationId!, tx);
    const jobs = recipients.map(recipient => {
      const personal = (value: string) => value.replace(/\{firstName\}/g, recipient.firstName);
      return { kind: 'EMAIL' as const, idempotencyKey: 'campaign:' + key + ':' + recipient.id, locationId: req.user!.locationId!, requestedBy: req.user!.id,
        label: 'MARKETING', payload: { type: 'MARKETING', recipientId: recipient.id, to: recipient.email, subject: personal(subject),
          html: wrapEmail(esc(personal(subject)), '<p style="white-space:pre-wrap">' + esc(personal(message)) + '</p>') } };
    });
    await enqueueJobManifest(tx, jobs);
    return { matched: recipients.length, queued: jobs.length, sent: 0, failed: 0, campaignId: key };
  });



/** Daily birthday check at BIRTHDAY_EMAIL_HOUR (default 9:00 server time) */
export const startMarketingScheduler = (): void => {
  if (process.env.BIRTHDAY_EMAILS_DISABLED === 'true') return;
  let running = false;
  const timer = setInterval(() => { if (running) return; running = true;
    void sendBirthdayEmails(new Date(), true).catch(() => logger.error('Birthday enqueue failed; durable keys allow retry')).finally(() => {running=false;});
  }, 60000); timer.unref();
};
