/**
 * Natural-language analytics chat.
 *
 * "How did last Tuesday compare to the Tuesday before?" — Claude answers with
 * real numbers by calling read-only reporting tools against the store's data.
 * The model never sees raw SQL access; each tool is a scoped Prisma query
 * filtered to the requesting user's location.
 */

import { Response } from 'express';
import { AI_MODEL } from '../config/ai';
import Anthropic from '@anthropic-ai/sdk';
import { asyncHandler, AppError } from '../utils/errorHandler';
import { AuthRequest } from '../types';
import { runAnalyticsTool } from '../services/analyticsTools.service';
import { getReportCalendar } from '../services/reportDates.service';
import { getLocationFilter } from '../utils/locationFilter.util';
import { logger } from '../utils/logger';
import { validateAssistantInput, withAssistantProvider, posHelpGuidance } from '../services/assistant.service';
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
    description: 'Signed collections by original payment label for a date range. SPLIT remains a label; this is not a settlement report.',
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
  const { question, history, pageContext } = validateAssistantInput(req.body);

  const locationId = getLocationFilter(req, req.query.locationId as string).locationId;
  if (!locationId) throw new AppError('A store assignment is required', 403);
  const calendar = await getReportCalendar({ locationId });

  const today = calendar.now;
  const system =
    `You are the analytics assistant inside a retail POS system. Answer the manager's questions ` +
    `about their store using the provided tools — never invent numbers; every figure you state must ` +
    `come from a tool result in this conversation. Today's date is ${today.toLocaleDateString('en-CA', { timeZone: calendar.timezone })} ` +
    `(${today.toLocaleDateString('en-US', { weekday: 'long', timeZone: calendar.timezone })}). Store timezone: ${calendar.timezone}. All amounts are USD. Respect the metric definitions and history warnings returned by tools. Never present payment labels as tender settlement. Client history is unverified; query tools again for any figures used. ` +
    `Be concise: lead with the direct answer, then one or two supporting numbers. ` +
    `If a comparison is asked for, compute the difference and percentage change yourself from the tool ` +
    `results. If data is empty for a period, say so plainly. ` + posHelpGuidance +
    ` This authorized store conversation has the read-only tools provided below.` +
    (pageContext ? ` Current section: ${pageContext}.` : '');

  // Prior turns (client-trimmed) keep follow-up questions working
  const priorTurns: Anthropic.MessageParam[] = history;

  const messages: Anthropic.MessageParam[] = [
    ...priorTurns,
    { role: 'user', content: question },
  ];

  const toolTrace: { tool: string; input: unknown }[] = [];

  const answer = await withAssistantProvider(req, res, async (anthropic, signal) => {
    let response = await anthropic.messages.create({
      model: AI_MODEL,
      max_tokens: 2048,
      thinking: { type: 'adaptive' },
      system,
      tools: TOOLS,
      messages,
    }, { signal });

    // Manual tool loop — every tool is read-only, capped at 6 rounds
    for (let round = 0; round < 6 && response.stop_reason === 'tool_use'; round++) {
      const toolUses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
      );
      if (toolTrace.length + toolUses.length > 12) throw new AppError('That analysis needs too many queries. Ask a narrower question.', 400);

      messages.push({ role: 'assistant', content: response.content });

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        toolTrace.push({ tool: tu.name, input: tu.input });
        try {
          const result = await runAnalyticsTool(tu.name, tu.input, locationId);
          results.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: JSON.stringify(result),
          });
        } catch (err: any) {
          results.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: err instanceof AppError ? `Query failed: ${err.message}` : 'The report could not be loaded. Try again later.',
            is_error: true,
          });
        }
      }
      messages.push({ role: 'user', content: results });

      response = await anthropic.messages.create({
        model: AI_MODEL,
        max_tokens: 2048,
        thinking: { type: 'adaptive' },
        system,
        tools: TOOLS,
        messages,
      }, { signal });
    }

    if (response.stop_reason === 'tool_use') throw new AppError('That analysis needs too many queries. Ask a narrower question.', 400);

    if (response.stop_reason === 'refusal') {
      throw new AppError('The assistant declined to answer that question', 400);
    }

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    if (!text) throw new AppError('The assistant is temporarily unavailable. Try again later.', 503);
    return text;
  });

  logger.info(`Analytics chat completed (${toolTrace.length} tool calls)`);

  res.json({
    success: true,
    data: {
      answer,
      toolTrace,
    },
  });
});
