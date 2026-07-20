/**
 * End-of-day digest: a short owner-facing email summarizing today's business.
 *
 * The numbers are computed here; the narrative paragraph is written by Claude
 * when ANTHROPIC_API_KEY is configured, with a plain templated fallback so the
 * digest always sends. Scheduling: startDailyDigestScheduler() fires once per
 * day at DAILY_DIGEST_HOUR (default 21:00 server-local); POST
 * /api/reports/daily-digest/send triggers one on demand.
 */

import Anthropic from '@anthropic-ai/sdk';
import prisma from '../config/database';
import { SaleStatus } from '@prisma/client';
import { sendEmail } from '../utils/email';
import { logger } from '../utils/logger';
import { config } from '../config';

const rc = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => `$${n.toFixed(2)}`;

export interface DigestData {
  date: string;
  revenue: number;
  transactions: number;
  refundAmount: number;
  refundCount: number;
  lastWeekRevenue: number;
  revenueChangePct: number | null;
  promoSavings: number;
  topProducts: { name: string; units: number; revenue: number }[];
  lowStock: { name: string; sku: string; stock: number; threshold: number }[];
}

/** Compute today's numbers plus the same weekday last week for comparison */
export const collectDigestData = async (): Promise<DigestData> => {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const lastWeekStart = new Date(todayStart);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);
  const lastWeekEnd = new Date(lastWeekStart);
  lastWeekEnd.setHours(23, 59, 59, 999);

  const revenueStatuses = { in: [SaleStatus.COMPLETED, SaleStatus.REFUNDED] };

  const [todaySales, todayRefunds, lastWeekSales, lastWeekRefunds, topItems, lowStockProducts, promoAgg] =
    await Promise.all([
      prisma.sale.aggregate({
        where: { status: revenueStatuses, createdAt: { gte: todayStart } },
        _sum: { total: true },
        _count: true,
      }),
      prisma.refund.aggregate({
        where: { createdAt: { gte: todayStart } },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.sale.aggregate({
        where: { status: revenueStatuses, createdAt: { gte: lastWeekStart, lte: lastWeekEnd } },
        _sum: { total: true },
      }),
      prisma.refund.aggregate({
        where: { createdAt: { gte: lastWeekStart, lte: lastWeekEnd } },
        _sum: { amount: true },
      }),
      prisma.saleItem.groupBy({
        by: ['productName'],
        where: { createdAt: { gte: todayStart }, sale: { status: revenueStatuses } },
        _sum: { quantity: true, total: true },
        orderBy: { _sum: { total: 'desc' } },
        take: 5,
      }),
      prisma.$queryRaw<{ name: string; sku: string; stockQuantity: number; lowStockAlert: number }[]>`
        SELECT name, sku, "stockQuantity", "lowStockAlert"
        FROM products
        WHERE "isActive" = true AND "trackInventory" = true
          AND "lowStockAlert" > 0 AND "stockQuantity" <= "lowStockAlert"
        ORDER BY "stockQuantity" ASC
        LIMIT 10
      `,
      prisma.saleItem.aggregate({
        where: { createdAt: { gte: todayStart }, sale: { status: revenueStatuses } },
        _sum: { promotionDiscount: true },
      }),
    ]);

  const revenue = rc((todaySales._sum.total || 0) - (todayRefunds._sum.amount || 0));
  const lastWeekRevenue = rc((lastWeekSales._sum.total || 0) - (lastWeekRefunds._sum.amount || 0));

  return {
    date: todayStart.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }),
    revenue,
    transactions: todaySales._count,
    refundAmount: rc(todayRefunds._sum.amount || 0),
    refundCount: todayRefunds._count,
    lastWeekRevenue,
    revenueChangePct:
      lastWeekRevenue > 0 ? rc(((revenue - lastWeekRevenue) / lastWeekRevenue) * 100) : null,
    promoSavings: rc(promoAgg._sum.promotionDiscount || 0),
    topProducts: topItems.map((i) => ({
      name: i.productName,
      units: i._sum.quantity || 0,
      revenue: rc(i._sum.total || 0),
    })),
    lowStock: lowStockProducts.map((p) => ({
      name: p.name,
      sku: p.sku,
      stock: p.stockQuantity,
      threshold: p.lowStockAlert,
    })),
  };
};

/** Plain-English narrative without AI — always available */
const templateNarrative = (d: DigestData): string => {
  const parts: string[] = [];
  const trend =
    d.revenueChangePct === null
      ? ''
      : d.revenueChangePct >= 0
        ? `, up ${d.revenueChangePct}% vs last ${d.date.split(',')[0]}`
        : `, down ${Math.abs(d.revenueChangePct)}% vs last ${d.date.split(',')[0]}`;
  parts.push(`Today closed at ${money(d.revenue)} across ${d.transactions} transactions${trend}.`);
  if (d.topProducts.length > 0) {
    parts.push(`Top seller: ${d.topProducts[0].name} (${d.topProducts[0].units} units, ${money(d.topProducts[0].revenue)}).`);
  }
  if (d.refundCount > 0) {
    parts.push(`${d.refundCount} refund${d.refundCount > 1 ? 's' : ''} totaling ${money(d.refundAmount)}.`);
  }
  if (d.lowStock.length > 0) {
    parts.push(`${d.lowStock.length} product${d.lowStock.length > 1 ? 's are' : ' is'} at or below the low-stock threshold.`);
  }
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
  } catch (err: any) {
    logger.warn(`Daily digest: Claude narrative failed, using template (${err?.message || err})`);
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
        <td style="padding:4px 0;text-align:right;">${p.units} sold</td>
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
      <p style="margin:0 0 16px;font-size:12px;color:#888;">${esc(config.app.name || 'POS System')}</p>

      <p style="font-size:14px;line-height:1.6;background:#f6f5ff;border-left:3px solid #6c5ce7;padding:12px 14px;border-radius:0 8px 8px 0;">
        ${esc(narrative)}
      </p>

      <table style="width:100%;border-collapse:separate;border-spacing:8px;margin:8px -8px 16px;">
        <tr>
          ${stat('Revenue', money(d.revenue))}
          ${stat('Transactions', String(d.transactions))}
          ${stat('vs last week', trendText)}
          ${stat('Refunds', d.refundCount > 0 ? `-${money(d.refundAmount)}` : '$0.00')}
        </tr>
      </table>

      ${d.promoSavings > 0 ? `<p style="font-size:12px;color:#666;margin:0 0 16px;">Promotions gave customers ${money(d.promoSavings)} in savings today.</p>` : ''}

      ${d.topProducts.length > 0 ? `
      <h3 style="font-size:14px;margin:16px 0 6px;color:#111;">Top sellers</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">${topRows}</table>` : ''}

      ${d.lowStock.length > 0 ? `
      <h3 style="font-size:14px;margin:16px 0 6px;color:#b45309;">Low stock — reorder soon</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">${lowStockRows}</table>` : ''}
    </div>
    <p style="text-align:center;font-size:11px;color:#999;margin-top:12px;">
      Automated daily digest · sent by your POS at close of day
    </p>
  </div>
  </body></html>`;
};

/** Resolve recipients: DAILY_DIGEST_EMAILS env, else all active admin emails */
const resolveRecipients = async (): Promise<string[]> => {
  const fromEnv = (process.env.DAILY_DIGEST_EMAILS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (fromEnv.length > 0) return fromEnv;

  const admins = await prisma.user.findMany({
    where: { role: { in: ['SUPER_ADMIN', 'ADMIN'] }, isActive: true },
    select: { email: true },
  });
  return admins.map((a) => a.email);
};

export const sendDailyDigest = async (): Promise<{
  narrative: string;
  ai: boolean;
  recipients: string[];
  data: DigestData;
}> => {
  const data = await collectDigestData();
  const { text: narrative, ai } = await composeNarrative(data);
  const recipients = await resolveRecipients();

  if (recipients.length === 0) {
    logger.warn('Daily digest: no recipients configured (set DAILY_DIGEST_EMAILS or add admin users)');
    return { narrative, ai, recipients: [], data };
  }

  const html = buildDigestHtml(data, narrative);
  await sendEmail({
    to: recipients.join(', '),
    subject: `📊 End of Day: ${money(data.revenue)} · ${data.transactions} sales — ${data.date}`,
    html,
  });

  logger.info(`Daily digest sent to ${recipients.length} recipient(s) (${ai ? 'AI' : 'template'} narrative)`);
  return { narrative, ai, recipients, data };
};

let lastSentDate: string | null = null;

/**
 * Fire the digest once per day at DAILY_DIGEST_HOUR (0–23, default 21).
 * Checked every minute; in-memory guard prevents double sends. Disabled when
 * DAILY_DIGEST_DISABLED=true.
 */
export const startDailyDigestScheduler = (): void => {
  if (process.env.DAILY_DIGEST_DISABLED === 'true') {
    logger.info('Daily digest scheduler disabled (DAILY_DIGEST_DISABLED=true)');
    return;
  }
  const hour = Math.min(23, Math.max(0, parseInt(process.env.DAILY_DIGEST_HOUR || '21', 10) || 21));

  setInterval(() => {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    if (now.getHours() === hour && lastSentDate !== today) {
      lastSentDate = today;
      sendDailyDigest().catch((err) => {
        logger.error('Daily digest failed:', err);
      });
    }
  }, 60 * 1000);

  logger.info(`Daily digest scheduler started (sends at ${hour}:00 server time)`);
};
