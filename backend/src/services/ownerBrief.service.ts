/**
 * Morning brief: a short email to a store's owners about the last complete
 * store day and what needs attention today.
 *
 * Every figure is computed here (the attention list comes from
 * attention.service.ts). The paragraph at the top is written by Claude when
 * ANTHROPIC_API_KEY is configured, and is used only if every number in it is a
 * number the records produced; otherwise a plain template is used, so a brief
 * can always be queued. Scheduling: startOwnerBriefScheduler() sends one per
 * store per day from OWNER_BRIEF_HOUR (default 07:00 store time) when the store
 * keeps "Morning brief email" on; POST /api/reports/daily-digest/send sends one
 * on demand.
 */

import Anthropic from '@anthropic-ai/sdk';
import { AI_MODEL } from '../config/ai';
import prisma from '../config/database';
import { Prisma } from '@prisma/client';
import { AppError } from '../utils/errorHandler';
import { getFinancialMetrics, getProductFinancialMetrics, recordedSaleWhere, CostBasis } from './financialMetrics.service';
import { getReportCalendar, reportCalendar } from './reportDates.service';
import { briefAllowlist, enqueueDigestEmails } from './emailDelivery.service';
import { collectAttention, Severity } from './attention.service';
import { publicStoreSettings } from '../validators/storeSettings.validator';
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger';

const rc = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

export interface BriefData {
  locationId: string;
  storeName: string;
  timezone: string;
  asOf: string;
  /** The store day the brief covers, e.g. "Tuesday, November 10, 2026" and "2026-11-10". */
  date: string;
  day: string;
  weekday: string;
  historyWarning: string | null;
  revenue: number;
  transactions: number | null;
  refundAmount: number;
  refundCount: number;
  voidAmount: number;
  voidCount: number;
  /** The same weekday one week earlier. */
  lastWeekRevenue: number;
  revenueChange: number | null;
  revenueChangePct: number | null;
  grossProfit: number | null;
  grossMargin: number | null;
  profitBasis: CostBasis;
  /** Why the profit is not final, or why it is unavailable. */
  profitNote: string | null;
  promoSavings: number;
  topProducts: { name: string; units: number; revenue: number }[];
  lowStock: { name: string; sku: string; stock: number; threshold: number }[];
  /** What needs attention today, most urgent first (at most seven). */
  attention: { severity: Severity; sentence: string; amount?: number; count?: number }[];
  attentionTotal: number;
}

/** The last complete store day, compared with the same weekday a week earlier. */
export const collectBriefData = async (locationId: string, now = new Date()): Promise<BriefData> => {
  if (!locationId) throw new AppError('A store assignment is required', 403);
  const store = await prisma.location.findUnique({ where: { id: locationId }, select: { name: true, isActive: true } });
  if (!store?.isActive) throw new AppError('An active store is required', 403);
  const scope = { locationId }, calendar = await getReportCalendar(scope, now);
  const range = { gte: calendar.day(-1), lt: calendar.day() };
  const previous = { gte: calendar.day(-8), lt: calendar.day(-7) };
  const figures = await prisma.$transaction(async tx => Promise.all([
    getFinancialMetrics(scope, range, tx),
    getFinancialMetrics(scope, previous, tx),
    getProductFinancialMetrics(scope, range, tx),
    tx.product.findMany({ where: { locationId, isActive: true, trackInventory: true, sku: { not: 'MISC-001' },
      OR: [{ stockQuantity: { lte: 0 } }, { stockQuantity: { lte: prisma.product.fields.lowStockAlert } }] },
      select: { name: true, sku: true, stockQuantity: true, lowStockAlert: true }, orderBy: [{ stockQuantity: 'asc' }, { id: 'asc' }], take: 10 }),
    tx.saleItem.aggregate({ where: { sale: { locationId, ...recordedSaleWhere, createdAt: range } }, _sum: { promotionDiscount: true } }),
  ]), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15000 });
  const [day, before, products, lowStock, promotion] = figures;
  const attention = await collectAttention(locationId, now, 'ADMIN');
  const allocationMissing = products.some(p => p.incompleteReturns) || Math.abs(products.reduce((total, p) => total + p.revenue, 0) - day.netCollected) > 0.005;
  const historyWarning = day.historyWarning || before.historyWarning || (allocationMissing ? 'Some historical returns lack product allocations; product rankings may be incomplete.' : null);
  const comparable = before.netCollected > 0 && !historyWarning;
  const local = (options: Intl.DateTimeFormatOptions) => range.gte.toLocaleDateString('en-US', { timeZone: calendar.timezone, ...options });
  return { locationId, storeName: store.name, timezone: calendar.timezone, asOf: now.toISOString(), historyWarning,
    date: local({ weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }), day: range.gte.toLocaleDateString('en-CA', { timeZone: calendar.timezone }),
    weekday: local({ weekday: 'long' }),
    revenue: day.netCollected, transactions: day.transactions, refundAmount: day.refunds, refundCount: day.refundCount,
    voidAmount: day.voids, voidCount: day.voidCount, lastWeekRevenue: before.netCollected,
    revenueChange: comparable ? rc(day.netCollected - before.netCollected) : null,
    revenueChangePct: comparable ? rc((day.netCollected - before.netCollected) / before.netCollected * 100) : null,
    grossProfit: day.grossProfit, grossMargin: day.grossMargin, profitBasis: day.costBasis,
    profitNote: day.grossProfit === null ? day.unavailableReason : day.provisionalReason,
    promoSavings: Number(promotion._sum.promotionDiscount || 0),
    topProducts: products.sort((a, b) => b.revenue - a.revenue || a.productId.localeCompare(b.productId)).slice(0, 5)
      .map(p => ({ name: p.productName, units: p.quantitySold, revenue: p.revenue })),
    lowStock: lowStock.map(p => ({ name: p.name, sku: p.sku, stock: p.stockQuantity, threshold: p.lowStockAlert })),
    attention: attention.items.slice(0, 7).map(item => ({ severity: item.severity, sentence: item.sentence,
      ...(item.amount === undefined ? {} : { amount: item.amount }), ...(item.count === undefined ? {} : { count: item.count }) })),
    attentionTotal: attention.items.length,
  };
};

/** Plain-English narrative without AI: always available. */
export const templateNarrative = (d: BriefData): string => {
  const parts: string[] = [];
  const trend = d.revenueChangePct === null ? ''
    : `, ${d.revenueChangePct >= 0 ? 'up' : 'down'} ${Math.abs(d.revenueChangePct)}% on the ${d.weekday} before`;
  parts.push(`On ${d.weekday} the store took in ${money(d.revenue)} after refunds across ${d.transactions === null ? 'an unknown number of' : d.transactions} ${d.transactions === 1 ? 'sale' : 'sales'}${trend}.`);
  if (d.grossProfit !== null) parts.push(`Gross profit was ${money(d.grossProfit)}${d.grossMargin === null ? '' : ` (${d.grossMargin}% of sales before tax)`}${d.profitBasis === 'PROVISIONAL' ? ', not final yet' : ''}.`);
  else if (d.revenue > 0 && d.profitNote) parts.push(`Profit is unavailable: ${d.profitNote}`);
  if (d.topProducts.length > 0) parts.push(`Top seller: ${d.topProducts[0].name} (${d.topProducts[0].units} units, ${money(d.topProducts[0].revenue)}).`);
  if (d.refundCount > 0) parts.push(`${d.refundCount} refund${d.refundCount > 1 ? 's' : ''} totaling ${money(d.refundAmount)}.`);
  if (d.voidCount) parts.push(`${d.voidCount} void${d.voidCount > 1 ? 's' : ''} totaling ${money(d.voidAmount)}.`);
  parts.push(d.attentionTotal ? `${d.attentionTotal} ${d.attentionTotal === 1 ? 'thing needs' : 'things need'} attention today.` : 'Nothing needs attention today.');
  if (d.historyWarning) parts.push(d.historyWarning);
  return parts.join(' ');
};

const numberPattern = /\d[\d,]*(?:\.\d+)?/g;
const numeric = (token: string) => Number(token.replace(/,/g, ''));
/**
 * True when every number written in `text` is a number the records produced:
 * a value in `data`, or one printed inside its sentences and dates, allowing
 * the usual rounding (to cents, to one decimal, to a whole number). An invented
 * or recomputed figure fails the check and the template is used instead.
 */
export function narrativeNumbersSupported(text: string, data: unknown): boolean {
  const allowed = new Set<number>();
  const allow = (value: number) => { if (Number.isFinite(value)) for (const digits of [0, 1, 2]) allowed.add(Number(Math.abs(value).toFixed(digits))); };
  const walk = (value: unknown): void => {
    if (typeof value === 'number') allow(value);
    // Machine dates (2026-11-09, timestamps) are skipped: their parts are not figures, and the
    // same day is also present written out ("Monday, November 9, 2026").
    else if (typeof value === 'string') { if (!/^\d{4}-\d{2}-\d{2}/.test(value)) for (const token of value.match(numberPattern) || []) allow(numeric(token)); }
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  walk(data);
  return (text.match(numberPattern) || []).every(token => allowed.has(Number(numeric(token).toFixed(2))));
}

/** Claude-written narrative when an API key is configured and its numbers check out; template otherwise. */
const composeNarrative = async (d: BriefData): Promise<{ text: string; ai: boolean }> => {
  const template = { text: templateNarrative(d), ai: false };
  if (!process.env.ANTHROPIC_API_KEY) return template;
  try {
    const anthropic = new Anthropic();
    const response = await anthropic.messages.create({
      model: AI_MODEL,
      max_tokens: 1024,
      thinking: { type: 'adaptive' },
      system:
        'You write a morning brief for a small retail store owner about the last complete store day. ' +
        'Three to five plain sentences, warm but factual, using only the data provided. ' +
        'Write every number as digits exactly as it appears in the data; never add, subtract, average or estimate a new number. ' +
        'Revenue means net collections including tax, after dated refunds and voids; the comparison is the same weekday one week earlier. ' +
        'If profitBasis is PROVISIONAL say the profit is not final; if grossProfit is null say profit is unavailable and why, never an estimate. ' +
        'Lead with how the day went, mention what stands out, and end with the single most useful thing to do today, ' +
        'taken from the attention list when it has one. Include history warnings. No greetings, no sign-off, no markdown.',
      messages: [{ role: 'user', content: `Write the morning brief from this data:\n${JSON.stringify(d, null, 2)}` }],
    });
    if (response.stop_reason === 'refusal') return template;
    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || !('text' in textBlock) || !textBlock.text.trim()) return template;
    const text = textBlock.text.trim();
    if (!narrativeNumbersSupported(text, d)) {
      logger.warn('Morning brief: the written summary used a number that is not in the store data; using the template');
      return template;
    }
    return { text, ai: true };
  } catch {
    logger.warn('Morning brief: narrative provider unavailable; using template');
    return template;
  }
};

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** One store's brief as a card; a page holds one card, or one per store for an owner of several. */
const briefCard = (d: BriefData, narrative: string, heading: string): string => {
  const stat = (label: string, value: string, note = '') =>
    `<td style="padding:12px;text-align:center;background:#f8f8fb;border-radius:8px;">
       <div style="font-size:20px;font-weight:bold;color:#111;">${value}</div>
       <div style="font-size:11px;color:#666;margin-top:2px;">${label}${note ? `<br>${note}` : ''}</div>
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
        <td style="padding:3px 0;text-align:right;color:${p.stock <= 0 ? '#c00' : '#b45309'};font-weight:bold;">
          ${p.stock} left
        </td>
      </tr>`
    )
    .join('');

  const tone: Record<Severity, string> = { high: '#c00', medium: '#b45309', low: '#666' };
  const attentionRows = d.attention
    .map(item => `<li style="margin:0 0 6px;"><span style="color:${tone[item.severity]};font-weight:bold;">&#9679;</span> ${esc(item.sentence)}</li>`)
    .join('');

  const trendText =
    d.revenueChangePct === null
      ? '—'
      : `${d.revenueChangePct >= 0 ? '▲' : '▼'} ${Math.abs(d.revenueChangePct)}%`;

  return `<div style="background:#fff;border-radius:12px;padding:24px;margin-bottom:16px;">
      <h2 style="margin:0 0 2px;color:#111;">${esc(heading)}</h2>
      <p style="margin:0 0 16px;font-size:12px;color:#888;">${esc(d.storeName)} | ${esc(d.timezone)} | the whole store day</p>

      <p style="font-size:14px;line-height:1.6;background:#f6f5ff;border-left:3px solid #6c5ce7;padding:12px 14px;border-radius:0 8px 8px 0;">
        ${esc(narrative)}
      </p>

      ${d.historyWarning ? `<p style="color:#b45309;">${esc(d.historyWarning)}</p>` : ''}
      <table style="width:100%;border-collapse:separate;border-spacing:8px;margin:8px -8px 16px;">
        <tr>
          ${stat('Sales after refunds', money(d.revenue))}
          ${stat('Sales', d.transactions === null ? 'Unavailable' : String(d.transactions))}
          ${stat(`vs ${esc(d.weekday)} before`, trendText)}
          ${stat('Gross profit', d.grossProfit === null ? 'Unavailable' : money(d.grossProfit), d.profitBasis === 'PROVISIONAL' ? 'not final' : '')}
        </tr>
      </table>
      ${d.profitNote ? `<p style="font-size:12px;color:#666;margin:0 0 16px;">${esc(d.profitNote)}</p>` : ''}

      <h3 style="font-size:14px;margin:16px 0 6px;color:#111;">Needs attention today</h3>
      ${d.attention.length > 0
        ? `<ul style="list-style:none;padding:0;margin:0;font-size:13px;line-height:1.5;">${attentionRows}</ul>${d.attentionTotal > d.attention.length ? `<p style="font-size:12px;color:#666;margin:6px 0 0;">And ${d.attentionTotal - d.attention.length} more on the Dashboard.</p>` : ''}`
        : '<p style="font-size:13px;margin:0;">Nothing needs attention right now.</p>'}

      ${d.promoSavings > 0 ? `<p style="font-size:12px;color:#666;margin:16px 0 0;">Sales included ${money(d.promoSavings)} in promotional savings before any returns.</p>` : ''}

      ${d.topProducts.length > 0 ? `
      <h3 style="font-size:14px;margin:16px 0 6px;color:#111;">Top sellers</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">${topRows}</table>` : ''}

      ${d.lowStock.length > 0 ? `
      <h3 style="font-size:14px;margin:16px 0 6px;color:#b45309;">Low stock — reorder soon</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">${lowStockRows}</table>` : ''}
    </div>`;
};

const briefPage = (body: string): string => `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#333;margin:0;padding:0;background:#f1f1f4;">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px;">
    ${body}
    <p style="text-align:center;font-size:11px;color:#999;margin-top:12px;">
      Automated morning brief · sales include tax; returns and voids count on the day they happen
    </p>
  </div>
  </body></html>`;

const buildBriefHtml = (d: BriefData, narrative: string): string => briefPage(briefCard(d, narrative, `Morning brief — ${d.date}`));

/** An owner of several stores: one email, one section per store, each about that store's last complete day. */
const buildOwnerBriefHtml = (sections: { data: BriefData; narrative: string }[]): string => briefPage(
  `<h1 style="font-size:20px;margin:0 0 12px;color:#111;">Morning brief — your ${sections.length} stores</h1>` +
  sections.map(section => briefCard(section.data, section.narrative, `${section.data.storeName} — ${section.data.date}`)).join(''));

/**
 * Who gets a store's brief: everyone who runs it as ADMIN, the owners of its business
 * included. With `ownersGetTheirOwn`, owners of more than one store are left out: the
 * scheduler sends them a single email covering all their stores instead.
 * A global recipient override may narrow delivery, never grant another store access.
 */
export const resolveBriefRecipients = async (locationId: string, ownersGetTheirOwn = false): Promise<string[]> => {
  if (!locationId) throw new AppError('A store assignment is required', 403);
  const admins = await prisma.user.findMany({
    where: { isActive: true, storeAccess: { some: { locationId, role: 'ADMIN', location: { isActive: true } } },
      ...(ownersGetTheirOwn ? { NOT: { id: { in: await multiStoreOwnerIds() } } } : {}) },
    select: { email: true },
  });
  const allowlist = briefAllowlist();
  return [...new Set(admins.map(admin => admin.email))].filter(email => !allowlist.length || allowlist.includes(email.toLowerCase()));
};

/** Active owners whose businesses have more than one active store, with those stores. */
async function multiStoreOwners() {
  const owners = await prisma.organizationOwner.findMany({
    where: { user: { isActive: true, role: 'ADMIN', locationId: { not: null } } },
    select: { userId: true, user: { select: { email: true, locationId: true, location: { select: { timezone: true, isActive: true } } } },
      organization: { select: { locations: { where: { isActive: true }, select: { id: true, name: true, settings: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }] } } } },
  });
  const byOwner = new Map<string, { userId: string; email: string; homeLocationId: string; timezone: string; homeActive: boolean; stores: { id: string; name: string; settings: Prisma.JsonValue }[] }>();
  for (const owner of owners) {
    const entry = byOwner.get(owner.userId) ?? { userId: owner.userId, email: owner.user.email, homeLocationId: owner.user.locationId!,
      timezone: owner.user.location?.timezone || 'UTC', homeActive: owner.user.location?.isActive !== false, stores: [] };
    entry.stores.push(...owner.organization.locations);
    byOwner.set(owner.userId, entry);
  }
  return [...byOwner.values()].filter(owner => owner.stores.length > 1);
}
const multiStoreOwnerIds = async () => (await multiStoreOwners()).map(owner => owner.userId);

/**
 * One morning brief for an owner of several stores: a section per store that keeps the
 * brief on, each about that store's own last complete day. Queued to the owner through
 * their home store; `requestKey` keeps it to one email per owner per day.
 */
export const sendOwnerCombinedBrief = async (owner: Awaited<ReturnType<typeof multiStoreOwners>>[number], requestKey: string, now = new Date()) => {
  const allowlist = briefAllowlist();
  if (!owner.homeActive || (allowlist.length && !allowlist.includes(owner.email.toLowerCase()))) return [];
  const stores = owner.stores.filter(store => publicStoreSettings(store.settings).notificationSettings?.endOfDayReports !== false);
  if (!stores.length) return [];
  const sections = [];
  for (const store of stores) {
    const data = await collectBriefData(store.id, now);
    sections.push({ data, narrative: (await composeNarrative(data)).text });
  }
  const total = sections.reduce((sum, section) => rc(sum + section.data.revenue), 0);
  return enqueueDigestEmails(owner.homeLocationId, 'brief-owner:' + owner.userId + ':' + requestKey, [owner.email],
    `Morning brief for your ${sections.length} stores: ${money(total)} | ${sections[0].data.date}`, buildOwnerBriefHtml(sections));
};

/**
 * Queue one brief per owner. The same `requestKey` never queues a second email
 * for the same owner: the scheduler passes the store date, "Send brief now" its
 * own request id.
 */
export const sendOwnerBrief = async (locationId: string, requestKey: string = randomUUID(), now = new Date(), options: { ownersGetTheirOwn?: boolean } = {}): Promise<{
  deliveries: Awaited<ReturnType<typeof enqueueDigestEmails>>;
  narrative: string;
  ai: boolean;
  recipients: string[];
  data: BriefData;
}> => {
  const data = await collectBriefData(locationId, now);
  const recipients = await resolveBriefRecipients(locationId, options.ownersGetTheirOwn);
  const { text: narrative, ai } = recipients.length ? await composeNarrative(data) : { text: templateNarrative(data), ai: false };

  if (recipients.length === 0) {
    logger.warn('Morning brief: no eligible owner recipients for this store');
    return { narrative, ai, recipients: [], data, deliveries: [] };
  }

  const html = buildBriefHtml(data, narrative);
  const deliveries = await enqueueDigestEmails(locationId, 'brief:' + locationId + ':' + requestKey, recipients,
    data.storeName + ' morning brief: ' + money(data.revenue) + ' | ' + data.date, html);
  logger.info(`Morning brief queued: ${deliveries.length} owner deliveries`);
  return { narrative, ai, recipients, data, deliveries };
};

/** Hour of the store's day (0-23) from which the brief may go out. */
export const briefHour = () => {
  const configured = [process.env.OWNER_BRIEF_HOUR, process.env.DAILY_DIGEST_HOUR].find(value => value !== undefined && value.trim() !== '');
  const hour = Number(configured);
  return configured !== undefined && Number.isInteger(hour) ? Math.min(23, Math.max(0, hour)) : 7;
};

// Saves a query a minute once a store's brief is known to be handled; the database decides, not this map.
const handled = new Map<string, string>();

/**
 * One pass of the schedule: for every active store whose local time is inside
 * the morning window, queue today's brief unless one is already recorded.
 * The window runs from the brief hour to noon (at least an hour), so a server
 * that was down at 07:00 still sends the brief when it comes back that morning.
 */
export async function runOwnerBriefSchedule(now = new Date()) {
  const hour = briefHour(), lastHour = Math.max(hour + 1, 12);
  const stores = await prisma.location.findMany({ where: { isActive: true }, select: { id: true, timezone: true, settings: true } });
  let queued = 0;
  for (const store of stores) {
    try {
      const calendar = reportCalendar(store.timezone, now);
      const today = calendar.day().toLocaleDateString('en-CA', { timeZone: store.timezone });
      const localHour = Number(now.toLocaleString('en-US', { timeZone: store.timezone, hour: 'numeric', hourCycle: 'h23' }));
      if (localHour < hour || localHour >= lastHour || handled.get(store.id) === today) continue;
      handled.set(store.id, today);
      // "Morning brief email" in Settings > Notifications; on unless the owner turned it off.
      if (publicStoreSettings(store.settings).notificationSettings?.endOfDayReports === false) continue;
      // The database, not this process, remembers that today's brief went out (restarts, several servers).
      const key = 'brief:' + store.id + ':' + today;
      if (await prisma.emailDelivery.count({ where: { locationId: store.id, idempotencyKey: { startsWith: key + ':' } } })) continue;
      const result = await sendOwnerBrief(store.id, today, now, { ownersGetTheirOwn: true });
      queued += result.deliveries.length;
    } catch {
      handled.delete(store.id);
      logger.error('Morning brief failed for a store; delivery requires review');
    }
  }
  // Owners of several stores: one email each, in the morning window of their home store.
  for (const owner of await multiStoreOwners()) {
    const handledKey = 'owner:' + owner.userId;
    try {
      const today = reportCalendar(owner.timezone, now).day().toLocaleDateString('en-CA', { timeZone: owner.timezone });
      const localHour = Number(now.toLocaleString('en-US', { timeZone: owner.timezone, hour: 'numeric', hourCycle: 'h23' }));
      if (localHour < hour || localHour >= lastHour || handled.get(handledKey) === today) continue;
      handled.set(handledKey, today);
      const key = 'brief-owner:' + owner.userId + ':' + today;
      if (await prisma.emailDelivery.count({ where: { idempotencyKey: { startsWith: key + ':' } } })) continue;
      queued += (await sendOwnerCombinedBrief(owner, today, now)).length;
    } catch {
      handled.delete(handledKey);
      logger.error('Morning brief failed for an owner of several stores; delivery requires review');
    }
  }
  return queued;
}
/** For tests: forget which stores this process has already handled today. */
export const resetOwnerBriefSchedule = () => handled.clear();

let schedulerRunning = false;

/** Checked every minute. Disabled when OWNER_BRIEF_DISABLED=true (or the older DAILY_DIGEST_DISABLED=true). */
export const startOwnerBriefScheduler = (): void => {
  if (process.env.OWNER_BRIEF_DISABLED === 'true' || process.env.DAILY_DIGEST_DISABLED === 'true') {
    logger.info('Morning brief scheduler disabled (OWNER_BRIEF_DISABLED=true)');
    return;
  }
  setInterval(() => {
    if (schedulerRunning) return;
    schedulerRunning = true;
    void runOwnerBriefSchedule().catch(() => logger.error('Morning brief scheduler failed')).finally(() => { schedulerRunning = false; });
  }, 60 * 1000);
  logger.info(`Morning brief scheduler started (sends from ${briefHour()}:00 in each store timezone)`);
};
