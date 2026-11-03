/**
 * End-of-day digest: a short owner-facing email summarizing today's business.
 *
 * The numbers are computed here; the narrative paragraph is written by Claude
 * when ANTHROPIC_API_KEY is configured, with a plain templated fallback so the
 * digest can be queued without an AI provider. Scheduling: startDailyDigestScheduler() fires once per
 * day at DAILY_DIGEST_HOUR (default 21:00 store-local); POST
 * /api/reports/daily-digest/send triggers one on demand.
 */

import Anthropic from '@anthropic-ai/sdk';
import prisma from '../config/database';
import { Prisma } from '@prisma/client';
import { AppError } from '../utils/errorHandler';
import { getFinancialMetrics, getProductFinancialMetrics, recordedSaleWhere } from './financialMetrics.service';
import { getReportCalendar, reportCalendar } from './reportDates.service';
import { enqueueDigestEmails } from './emailDelivery.service';
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger';

const rc = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => `$${n.toFixed(2)}`;

export interface DigestData {
  locationId: string;
  storeName: string;
  timezone: string;
  asOf: string;
  historyWarning: string | null;
  voidAmount: number;
  voidCount: number;
  date: string;
  revenue: number;
  transactions: number | null;
  refundAmount: number;
  refundCount: number;
  lastWeekRevenue: number;
  revenueChangePct: number | null;
  promoSavings: number;
  topProducts: { name: string; units: number; revenue: number }[];
  lowStock: { name: string; sku: string; stock: number; threshold: number }[];
}

/** Store-day activity through now, compared with equal elapsed time a week ago. */
export const collectDigestData = async (locationId: string, now = new Date()): Promise<DigestData> => {
  if (!locationId) throw new AppError('A store assignment is required', 403);
  const store = await prisma.location.findUnique({ where: { id: locationId }, select: { name: true, isActive: true } });
  if (!store?.isActive) throw new AppError('An active store is required', 403);
  const scope = { locationId }, calendar = await getReportCalendar(scope, now);
  const range = { gte: calendar.day(), lte: now };
  const previousStart = calendar.day(-7);
  const previousEnd = new Date(Math.min(calendar.day(-6).getTime() - 1, previousStart.getTime() + now.getTime() - range.gte.getTime()));
  return prisma.$transaction(async tx => {
    const [today, previous, products, lowStock, promotion] = await Promise.all([
      getFinancialMetrics(scope, range, tx),
      getFinancialMetrics(scope, { gte: previousStart, lte: previousEnd }, tx),
      getProductFinancialMetrics(scope, range, tx),
      tx.product.findMany({ where: { locationId, isActive: true, trackInventory: true, sku: { not: 'MISC-001' },
        OR: [{ stockQuantity: { lte: 0 } }, { stockQuantity: { lte: prisma.product.fields.lowStockAlert } }] },
        select: { name: true, sku: true, stockQuantity: true, lowStockAlert: true }, orderBy: [{ stockQuantity: 'asc' }, { id: 'asc' }], take: 10 }),
      tx.saleItem.aggregate({ where: { sale: { locationId, ...recordedSaleWhere, createdAt: range } }, _sum: { promotionDiscount: true } }),
    ]);
    const allocationMissing = products.some(p => p.incompleteReturns) || Math.abs(products.reduce((total, p) => total + p.revenue, 0) - today.netCollected) > 0.005;
    const historyWarning = today.historyWarning || previous.historyWarning || (allocationMissing ? 'Some historical returns lack product allocations; product rankings may be incomplete.' : null);
    return { locationId, storeName: store.name, timezone: calendar.timezone, asOf: now.toISOString(), historyWarning,
      date: now.toLocaleDateString('en-US', { timeZone: calendar.timezone, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
      revenue: today.netCollected, transactions: today.transactions, refundAmount: today.refunds, refundCount: today.refundCount,
      voidAmount: today.voids, voidCount: today.voidCount, lastWeekRevenue: previous.netCollected,
      revenueChangePct: previous.netCollected > 0 && !historyWarning ? rc((today.netCollected - previous.netCollected) / previous.netCollected * 100) : null,
      promoSavings: Number(promotion._sum.promotionDiscount || 0),
      topProducts: products.sort((a, b) => b.revenue - a.revenue || a.productId.localeCompare(b.productId)).slice(0, 5)
        .map(p => ({ name: p.productName, units: p.quantitySold, revenue: p.revenue })),
      lowStock: lowStock.map(p => ({ name: p.name, sku: p.sku, stock: p.stockQuantity, threshold: p.lowStockAlert })),
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 });
};

/** Plain-English narrative without AI — always available */
const templateNarrative = (d: DigestData): string => {
  const parts: string[] = [];
  const trend =
    d.revenueChangePct === null
      ? ''
      : d.revenueChangePct >= 0
        ? `, up ${d.revenueChangePct}% vs the same elapsed period last ${d.date.split(',')[0]}`
        : `, down ${Math.abs(d.revenueChangePct)}% vs last ${d.date.split(',')[0]}`;
  parts.push(`Net collections so far are ${money(d.revenue)} across ${d.transactions === null ? 'an unknown number of' : d.transactions} transactions${trend}.`);
  if (d.topProducts.length > 0) {
    parts.push(`Top seller: ${d.topProducts[0].name} (${d.topProducts[0].units} units, ${money(d.topProducts[0].revenue)}).`);
  }
  if (d.refundCount > 0) {
    parts.push(`${d.refundCount} refund${d.refundCount > 1 ? 's' : ''} totaling ${money(d.refundAmount)}.`);
  }
  if (d.lowStock.length > 0) {
    parts.push(`${d.lowStock.length} product${d.lowStock.length > 1 ? 's are' : ' is'} at or below the low-stock threshold.`);
  }
  if (d.voidCount) parts.push(`${d.voidCount} void reversals totaling ${money(d.voidAmount)}.`);
  if (d.historyWarning) parts.push(d.historyWarning);
  return parts.join(' ');
};

/** Claude-written narrative when an API key is configured; template otherwise */
const composeNarrative = async (d: DigestData): Promise<{ text: string; ai: boolean }> => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { text: templateNarrative(d), ai: false };
  }

  try {
    const anthropic = new Anthropic();
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1024,
      thinking: { type: 'adaptive' },
      system:
        'You write end-of-day summaries for a small retail store owner. ' +
        'Three to four plain sentences, warm but factual, using only the data provided. ' +
        'Revenue here means net collections including tax, after dated refunds and voids; comparison is equal elapsed time, not full days. Include history warnings and describe data as through asOf, never a closed day. ' +
        'Lead with how the day went, mention what stands out (a trend, a top seller, ' +
        'anything unusual like heavy refunds), and end with the single most useful ' +
        'action for tomorrow if one is warranted. No greetings, no sign-off, no markdown.',
      messages: [
        {
          role: 'user',
          content: `Write today's digest from this data:\n${JSON.stringify(d, null, 2)}`,
        },
      ],
    });

    if (response.stop_reason === 'refusal') {
      return { text: templateNarrative(d), ai: false };
    }
    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || !('text' in textBlock) || !textBlock.text.trim()) {
      return { text: templateNarrative(d), ai: false };
    }
    return { text: textBlock.text.trim(), ai: true };
  } catch {
    logger.warn('Daily digest: narrative provider unavailable; using template');
    return { text: templateNarrative(d), ai: false };
  }
};

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const buildDigestHtml = (d: DigestData, narrative: string): string => {
  const stat = (label: string, value: string) =>
    `<td style="padding:12px;text-align:center;background:#f8f8fb;border-radius:8px;">
       <div style="font-size:20px;font-weight:bold;color:#111;">${value}</div>
       <div style="font-size:11px;color:#666;margin-top:2px;">${label}</div>
     </td>`;

  const topRows = d.topProducts
    .map(
      (p, i) => `<tr>
        <td style="padding:4px 0;color:#666;">${i + 1}.</td>
        <td style="padding:4px 8px;">${esc(p.name)}</td>
        <td style="padding:4px 0;text-align:right;">${p.units} net units</td>
        <td style="padding:4px 0 4px 12px;text-align:right;font-weight:bold;">${money(p.revenue)}</td>
      </tr>`
    )
    .join('');

  const lowStockRows = d.lowStock
    .map(
      (p) => `<tr>
        <td style="padding:3px 8px 3px 0;">${esc(p.name)}</td>
        <td style="padding:3px 8px;color:#666;">${esc(p.sku)}</td>
        <td style="padding:3px 0;text-align:right;color:${p.stock === 0 ? '#c00' : '#b45309'};font-weight:bold;">
          ${p.stock} left
        </td>
      </tr>`
    )
    .join('');

  const trendText =
    d.revenueChangePct === null
      ? '—'
      : `${d.revenueChangePct >= 0 ? '▲' : '▼'} ${Math.abs(d.revenueChangePct)}%`;

  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#333;margin:0;padding:0;background:#f1f1f4;">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px;">
    <div style="background:#fff;border-radius:12px;padding:24px;">
      <h2 style="margin:0 0 2px;color:#111;">End of Day — ${esc(d.date)}</h2>
      <p style="margin:0 0 16px;font-size:12px;color:#888;">${esc(d.storeName)} | ${esc(d.timezone)} | as of ${esc(d.asOf)}</p>

      <p style="font-size:14px;line-height:1.6;background:#f6f5ff;border-left:3px solid #6c5ce7;padding:12px 14px;border-radius:0 8px 8px 0;">
        ${esc(narrative)}
      </p>

      ${d.historyWarning ? `<p style="color:#b45309;">${esc(d.historyWarning)}</p>` : ''}
      <table style="width:100%;border-collapse:separate;border-spacing:8px;margin:8px -8px 16px;">
        <tr>
          ${stat('Net collected', money(d.revenue))}
          ${stat('Transactions', d.transactions === null ? 'Unavailable' : String(d.transactions))}
          ${stat('vs last week', trendText)}
          ${stat('Refunds', d.refundCount > 0 ? `-${money(d.refundAmount)}` : '$0.00')}
        </tr>
      </table>

      ${d.promoSavings > 0 ? `<p style="font-size:12px;color:#666;margin:0 0 16px;">Original sales included ${money(d.promoSavings)} in promotional savings before any returns.</p>` : ''}

      ${d.topProducts.length > 0 ? `
      <h3 style="font-size:14px;margin:16px 0 6px;color:#111;">Top sellers</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">${topRows}</table>` : ''}

      ${d.lowStock.length > 0 ? `
      <h3 style="font-size:14px;margin:16px 0 6px;color:#b45309;">Low stock — reorder soon</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">${lowStockRows}</table>` : ''}
    </div>
    <p style="text-align:center;font-size:11px;color:#999;margin-top:12px;">
      Automated daily digest · collections include tax; returns and voids use their reversal dates
    </p>
  </div>
  </body></html>`;
};

/** A global recipient override may narrow delivery, never grant another store access. */
export const resolveDigestRecipients = async (locationId: string): Promise<string[]> => {
  if (!locationId) throw new AppError('A store assignment is required', 403);
  const admins = await prisma.user.findMany({ where: { locationId, role: 'ADMIN', isActive: true, location: { isActive: true } }, select: { email: true } });
  const allowlist = (process.env.DAILY_DIGEST_EMAILS || '').split(',').map(email => email.trim().toLowerCase()).filter(Boolean);
  return [...new Set(admins.map(admin => admin.email))].filter(email => !allowlist.length || allowlist.includes(email.toLowerCase()));
};

export const sendDailyDigest = async (locationId: string, requestKey: string = randomUUID()): Promise<{
  deliveries: Awaited<ReturnType<typeof enqueueDigestEmails>>;
  narrative: string;
  ai: boolean;
  recipients: string[];
  data: DigestData;
}> => {
  const data = await collectDigestData(locationId);
  const recipients = await resolveDigestRecipients(locationId);
  const { text: narrative, ai } = recipients.length ? await composeNarrative(data) : { text: templateNarrative(data), ai: false };

  if (recipients.length === 0) {
    logger.warn('Daily digest: no eligible owner recipients for this store');
    return { narrative, ai, recipients: [], data, deliveries: [] };
  }

  const html = buildDigestHtml(data, narrative);
  const deliveries = await enqueueDigestEmails(locationId, 'digest:' + locationId + ':' + requestKey, recipients,
    data.storeName + ' daily summary: ' + money(data.revenue) + ' | ' + data.date, html);
  logger.info(`Daily digest queued: ${deliveries.length} owner deliveries`);
  return { narrative, ai, recipients, data, deliveries };
};

const lastSentDate = new Map<string, string>();
let schedulerRunning = false;

/**
 * Fire the digest once per day at DAILY_DIGEST_HOUR (0–23, default 21).
 * Checked every minute; database keys deduplicate each store/day/recipient across restarts. Disabled when
 * DAILY_DIGEST_DISABLED=true.
 */
export const startDailyDigestScheduler = (): void => {
  if (process.env.DAILY_DIGEST_DISABLED === 'true') {
    logger.info('Daily digest scheduler disabled (DAILY_DIGEST_DISABLED=true)');
    return;
  }
  const hour = Math.min(23, Math.max(0, Number.isInteger(Number(process.env.DAILY_DIGEST_HOUR)) ? Number(process.env.DAILY_DIGEST_HOUR) : 21));

  setInterval(() => {
    if (schedulerRunning) return;
    schedulerRunning = true;
    void (async () => {
      const now = new Date();
      const stores = await prisma.location.findMany({ where: { isActive: true }, select: { id: true, timezone: true } });
      for (const store of stores) {
        try {
          const calendar = reportCalendar(store.timezone, now);
          const today = calendar.day().toISOString();
          const localHour = Number(now.toLocaleString('en-US', { timeZone: store.timezone, hour: 'numeric', hourCycle: 'h23' }));
          if (localHour !== hour || lastSentDate.get(store.id) === today) continue;
          await sendDailyDigest(store.id, 'scheduled:' + today);
          lastSentDate.set(store.id, today);
        } catch { logger.error('Daily digest failed for a store; delivery requires review'); }
      }
    })().catch(() => logger.error('Daily digest scheduler failed')).finally(() => { schedulerRunning = false; });
  }, 60 * 1000);
  logger.info(`Daily digest scheduler started (sends at ${hour}:00 in each store timezone)`);
};
