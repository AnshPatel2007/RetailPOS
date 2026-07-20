/**
 * Natural-language analytics chat.
 *
 * "How did last Tuesday compare to the Tuesday before?" — Claude answers with
 * real numbers by calling read-only reporting tools against the store's data.
 * The model never sees raw SQL access; each tool is a scoped Prisma query
 * filtered to the requesting user's location.
 */

import { Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { asyncHandler, AppError } from '../utils/errorHandler';
import { AuthRequest } from '../types';
import prisma from '../config/database';
import { logger } from '../utils/logger';
import { SaleStatus } from '@prisma/client';

const rc = (n: number) => Math.round(n * 100) / 100;
const REVENUE_STATUSES = { in: [SaleStatus.COMPLETED, SaleStatus.REFUNDED] };

/** Parse "YYYY-MM-DD" into a local-day range */
const dayRange = (startDate: string, endDate?: string) => {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate || startDate}T23:59:59.999`);
  return { gte: start, lte: end };
};

// ---- Read-only tools the model can call -------------------------------------

const runTool = async (
  name: string,
  input: any,
  locationId: string | null
): Promise<unknown> => {
  const locFilter = locationId ? { locationId } : {};

  switch (name) {
    case 'get_sales_summary': {
      const range = dayRange(input.startDate, input.endDate);
      const [sales, refunds] = await Promise.all([
        prisma.sale.aggregate({
          where: { status: REVENUE_STATUSES, createdAt: range, ...locFilter },
          _sum: { total: true, tax: true, discount: true, surcharge: true },
          _count: true,
        }),
        prisma.refund.aggregate({
          where: { createdAt: range },
          _sum: { amount: true },
          _count: true,
        }),
      ]);
      const gross = sales._sum.total || 0;
      const refunded = refunds._sum.amount || 0;
      return {
        period: { startDate: input.startDate, endDate: input.endDate || input.startDate },
        netRevenue: rc(gross - refunded),
        grossSales: rc(gross),
        transactions: sales._count,
        averageOrderValue: sales._count > 0 ? rc(gross / sales._count) : 0,
        taxCollected: rc(sales._sum.tax || 0),
        discountsGiven: rc(sales._sum.discount || 0),
        cardSurcharges: rc(sales._sum.surcharge || 0),
        refunds: { count: refunds._count, amount: rc(refunded) },
      };
    }

    case 'get_top_products': {
      const range = dayRange(input.startDate, input.endDate);
      const rows = await prisma.saleItem.groupBy({
        by: ['productName'],
        where: { createdAt: range, sale: { status: REVENUE_STATUSES, ...locFilter } },
        _sum: { quantity: true, total: true },
        orderBy: { _sum: { total: 'desc' } },
        take: Math.min(input.limit || 10, 25),
      });
      return rows.map((r) => ({
        product: r.productName,
        unitsSold: r._sum.quantity || 0,
        revenue: rc(r._sum.total || 0),
      }));
    }

    case 'get_tender_breakdown': {
      const range = dayRange(input.startDate, input.endDate);
      const rows = await prisma.salePayment.groupBy({
        by: ['paymentMethod'],
        where: { sale: { status: REVENUE_STATUSES, createdAt: range, ...locFilter } },
        _sum: { amount: true },
        _count: true,
      });
      return rows.map((r) => ({
        tender: r.paymentMethod,
        payments: r._count,
        amount: rc(r._sum.amount || 0),
      }));
    }

    case 'get_hourly_sales': {
      const range = dayRange(input.date);
      const sales = await prisma.sale.findMany({
        where: { status: REVENUE_STATUSES, createdAt: range, ...locFilter },
        select: { total: true, createdAt: true },
      });
      const byHour: Record<number, { transactions: number; revenue: number }> = {};
      for (const s of sales) {
        const h = new Date(s.createdAt).getHours();
        if (!byHour[h]) byHour[h] = { transactions: 0, revenue: 0 };
        byHour[h].transactions++;
        byHour[h].revenue += s.total;
      }
      return Object.entries(byHour)
        .map(([hour, d]) => ({ hour: Number(hour), transactions: d.transactions, revenue: rc(d.revenue) }))
        .sort((a, b) => a.hour - b.hour);
    }

    case 'get_employee_sales': {
      const range = dayRange(input.startDate, input.endDate);
      const sales = await prisma.sale.groupBy({
        by: ['userId'],
        where: { status: REVENUE_STATUSES, createdAt: range, ...locFilter },
        _sum: { total: true },
        _count: true,
      });
      const users = await prisma.user.findMany({
        where: { id: { in: sales.map((s) => s.userId) } },
        select: { id: true, firstName: true, lastName: true },
      });
      const nameMap = new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`]));
      return sales
        .map((s) => ({
          employee: nameMap.get(s.userId) || 'Unknown',
          transactions: s._count,
          revenue: rc(s._sum.total || 0),
        }))
        .sort((a, b) => b.revenue - a.revenue);
    }

    case 'get_inventory_alerts': {
      const [lowStock, deadValue] = await Promise.all([
        prisma.$queryRaw<{ name: string; sku: string; stockQuantity: number; lowStockAlert: number }[]>`
          SELECT name, sku, "stockQuantity", "lowStockAlert"
          FROM products
          WHERE "isActive" = true AND "trackInventory" = true
            AND "lowStockAlert" > 0 AND "stockQuantity" <= "lowStockAlert"
          ORDER BY "stockQuantity" ASC LIMIT 15
        `,
        prisma.product.aggregate({
          where: { isActive: true, trackInventory: true, stockQuantity: { gt: 0 }, ...(locationId ? { locationId } : {}) },
          _sum: { stockQuantity: true },
          _count: true,
        }),
      ]);
      return {
        lowStock: lowStock.map((p) => ({ name: p.name, sku: p.sku, stock: p.stockQuantity, threshold: p.lowStockAlert })),
        activeTrackedProducts: deadValue._count,
        totalUnitsOnHand: deadValue._sum.stockQuantity || 0,
      };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
};

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_sales_summary',
    description:
      'Revenue, transactions, average order value, tax, discounts, and refunds for a date range. Call this for any question about how sales went. Dates are inclusive local days.',
    input_schema: {
      type: 'object',
      properties: {
        startDate: { type: 'string', description: 'YYYY-MM-DD' },
        endDate: { type: 'string', description: 'YYYY-MM-DD; omit for a single day' },
      },
      required: ['startDate'],
    },
  },
  {
    name: 'get_top_products',
    description: 'Best-selling products by revenue for a date range, with units sold.',
    input_schema: {
      type: 'object',
      properties: {
        startDate: { type: 'string', description: 'YYYY-MM-DD' },
        endDate: { type: 'string', description: 'YYYY-MM-DD; omit for a single day' },
        limit: { type: 'integer', description: 'Max products, default 10' },
      },
      required: ['startDate'],
    },
  },
  {
    name: 'get_tender_breakdown',
    description: 'How customers paid (cash, card, EBT, gift card...) for a date range.',
    input_schema: {
      type: 'object',
      properties: {
        startDate: { type: 'string', description: 'YYYY-MM-DD' },
        endDate: { type: 'string', description: 'YYYY-MM-DD; omit for a single day' },
      },
      required: ['startDate'],
    },
  },
  {
    name: 'get_hourly_sales',
    description: 'Sales by hour of day for one date. Call this for busiest-time questions.',
    input_schema: {
      type: 'object',
      properties: { date: { type: 'string', description: 'YYYY-MM-DD' } },
      required: ['date'],
    },
  },
  {
    name: 'get_employee_sales',
    description: 'Per-employee revenue and transaction counts for a date range.',
    input_schema: {
      type: 'object',
      properties: {
        startDate: { type: 'string', description: 'YYYY-MM-DD' },
        endDate: { type: 'string', description: 'YYYY-MM-DD; omit for a single day' },
      },
      required: ['startDate'],
    },
  },
  {
    name: 'get_inventory_alerts',
    description: 'Current low-stock products and overall on-hand counts. No date needed.',
    input_schema: { type: 'object', properties: {} },
  },
];

/**
 * Ask the store's data a question in plain English
 * POST /api/analytics/chat  { question, history?: [{role, content}] }
 */
export const analyticsChat = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { question, history } = req.body;

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new AppError('AI chat requires ANTHROPIC_API_KEY to be configured on the server', 400);
  }
  if (!question || !String(question).trim()) {
    throw new AppError('Ask a question', 400);
  }

  const locationId = req.user?.locationId ?? null;
  const anthropic = new Anthropic();

  const today = new Date();
  const system =
    `You are the analytics assistant inside a retail POS system. Answer the manager's questions ` +
    `about their store using the provided tools — never invent numbers; every figure you state must ` +
    `come from a tool result in this conversation. Today's date is ${today.toISOString().slice(0, 10)} ` +
    `(${today.toLocaleDateString('en-US', { weekday: 'long' })}). All amounts are USD. ` +
    `Be concise: lead with the direct answer, then one or two supporting numbers. ` +
    `If a comparison is asked for, compute the difference and percentage change yourself from the tool ` +
    `results. If data is empty for a period, say so plainly.`;

  // Prior turns (client-trimmed) keep follow-up questions working
  const priorTurns: Anthropic.MessageParam[] = Array.isArray(history)
    ? history.slice(-10).map((m: any) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: String(m.content || '').slice(0, 4000),
      }))
    : [];

  const messages: Anthropic.MessageParam[] = [
    ...priorTurns,
    { role: 'user', content: String(question).slice(0, 2000) },
  ];

  const toolTrace: { tool: string; input: unknown }[] = [];

  let response = await anthropic.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 2048,
    thinking: { type: 'adaptive' },
    system,
    tools: TOOLS,
    messages,
  });

  // Manual tool loop — every tool is read-only, capped at 6 rounds
  for (let round = 0; round < 6 && response.stop_reason === 'tool_use'; round++) {
    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
    );

    messages.push({ role: 'assistant', content: response.content });

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      toolTrace.push({ tool: tu.name, input: tu.input });
      try {
        const result = await runTool(tu.name, tu.input, locationId);
        results.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: JSON.stringify(result),
        });
      } catch (err: any) {
        results.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: `Query failed: ${err?.message || 'unknown error'}`,
          is_error: true,
        });
      }
    }
    messages.push({ role: 'user', content: results });

    response = await anthropic.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 2048,
      thinking: { type: 'adaptive' },
      system,
      tools: TOOLS,
      messages,
    });
  }

  if (response.stop_reason === 'refusal') {
    throw new AppError('The assistant declined to answer that question', 400);
  }

  const answer = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

  logger.info(`Analytics chat: "${String(question).slice(0, 80)}" (${toolTrace.length} tool calls)`);

  res.json({
    success: true,
    data: {
      answer: answer || 'I could not produce an answer — try rephrasing the question.',
      toolTrace,
    },
  });
});
