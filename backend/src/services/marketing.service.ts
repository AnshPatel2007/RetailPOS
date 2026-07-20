/**
 * Customer marketing: birthday emails and segment campaigns.
 *
 * Only opted-in customers (emailMarketing: true) with an email address are
 * ever contacted. Birthday sends are guarded to once per year per customer.
 */

import prisma from '../config/database';
import { sendEmail } from '../utils/email';
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
export const sendBirthdayEmails = async (): Promise<number> => {
  const today = new Date();
  const month = today.getMonth() + 1;
  const day = today.getDate();
  const year = today.getFullYear();

  const candidates = await prisma.$queryRaw<
    { id: string; firstName: string; email: string; lastBirthdayEmailAt: Date | null }[]
  >`
    SELECT id, "firstName", email, "lastBirthdayEmailAt"
    FROM customers
    WHERE "emailMarketing" = true
      AND email IS NOT NULL
      AND "isActive" = true
      AND "birthDate" IS NOT NULL
      AND EXTRACT(MONTH FROM "birthDate") = ${month}
      AND EXTRACT(DAY FROM "birthDate") = ${day}
  `;

  const due = candidates.filter(
    (c) => !c.lastBirthdayEmailAt || new Date(c.lastBirthdayEmailAt).getFullYear() < year
  );

  const perk =
    process.env.BIRTHDAY_PERK_TEXT ||
    'Come in today and mention this email for a birthday treat on us!';

  let sent = 0;
  for (const c of due) {
    try {
      await sendEmail({
        to: c.email,
        subject: `🎂 Happy Birthday, ${c.firstName}!`,
        html: wrapEmail(
          `Happy Birthday, ${esc(c.firstName)}! 🎉`,
          `<p style="font-size:15px;line-height:1.6;">We hope you have a wonderful day.</p>
           <p style="font-size:15px;line-height:1.6;background:#f6f5ff;border-left:3px solid #6c5ce7;padding:12px 14px;border-radius:0 8px 8px 0;">
             ${esc(perk)}
           </p>`
        ),
      });
      await prisma.customer.update({
        where: { id: c.id },
        data: { lastBirthdayEmailAt: new Date() },
      });
      sent++;
    } catch (err: any) {
      logger.warn(`Birthday email to ${c.email} failed: ${err?.message || err}`);
    }
  }

  if (sent > 0) logger.info(`Birthday emails sent: ${sent}`);
  return sent;
};

export type CampaignSegment = 'all' | 'lapsed30' | 'lapsed60' | 'top20' | `tag:${string}`;

/** Resolve a segment to its opted-in recipients */
export const resolveSegment = async (
  segment: string
): Promise<{ id: string; firstName: string; email: string }[]> => {
  const optedIn = { emailMarketing: true, isActive: true, email: { not: null } } as const;

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

  const customers = await prisma.customer.findMany({
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
export const sendCampaign = async (
  segment: string,
  subject: string,
  message: string
): Promise<{ matched: number; sent: number; failed: number }> => {
  const recipients = await resolveSegment(segment);
  let sent = 0;
  let failed = 0;

  for (const r of recipients) {
    const personal = (s: string) => s.replace(/\{firstName\}/g, r.firstName);
    try {
      await sendEmail({
        to: r.email,
        subject: personal(subject),
        html: wrapEmail(
          esc(personal(subject)),
          `<p style="font-size:15px;line-height:1.6;white-space:pre-wrap;">${esc(personal(message))}</p>`
        ),
      });
      sent++;
    } catch {
      failed++;
    }
  }

  logger.info(`Campaign "${subject}" → segment ${segment}: ${sent} sent, ${failed} failed of ${recipients.length}`);
  return { matched: recipients.length, sent, failed };
};

let lastBirthdayRun: string | null = null;

/** Daily birthday check at BIRTHDAY_EMAIL_HOUR (default 9:00 server time) */
export const startMarketingScheduler = (): void => {
  if (process.env.BIRTHDAY_EMAILS_DISABLED === 'true') {
    logger.info('Birthday email scheduler disabled');
    return;
  }
  const hour = Math.min(23, Math.max(0, parseInt(process.env.BIRTHDAY_EMAIL_HOUR || '9', 10) || 9));

  setInterval(() => {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    if (now.getHours() === hour && lastBirthdayRun !== today) {
      lastBirthdayRun = today;
      sendBirthdayEmails().catch((err) => logger.error('Birthday emails failed:', err));
    }
  }, 60 * 1000);

  logger.info(`Birthday email scheduler started (runs at ${hour}:00 server time)`);
};
