/**
 * Developer settings: API keys and webhook endpoints (admin only).
 * Keys and webhook secrets are shown exactly once, at creation.
 */

import { Response } from 'express';
import crypto from 'crypto';
import { asyncHandler, AppError } from '../utils/errorHandler';
import { AuthRequest } from '../types';
import prisma from '../config/database';
import { logger } from '../utils/logger';
import { hashApiKey } from '../middleware/apiKeyAuth';
import { WEBHOOK_EVENTS, sendTestWebhook } from '../services/webhook.service';

// ─── API keys ───

export const listApiKeys = asyncHandler(async (_req: AuthRequest, res: Response) => {
  const keys = await prisma.apiKey.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, name: true, prefix: true, isActive: true,
      lastUsedAt: true, createdAt: true, revokedAt: true,
    },
  });
  res.json({ success: true, data: keys });
});

export const createApiKey = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { name } = req.body;
  if (!name || !String(name).trim()) {
    throw new AppError('Give the key a name (e.g. "Website integration")', 400);
  }

  const key = `pos_${crypto.randomBytes(24).toString('hex')}`;
  const record = await prisma.apiKey.create({
    data: {
      name: String(name).trim(),
      keyHash: hashApiKey(key),
      prefix: key.slice(0, 12),
      createdBy: req.user!.id,
    },
  });

  await prisma.activityLog.create({
    data: {
      userId: req.user!.id,
      action: 'CREATE',
      entity: 'API_KEY',
      entityId: record.id,
      details: { name: record.name },
    },
  });

  logger.info(`API key created: ${record.name} (${record.prefix}…)`);
  res.status(201).json({
    success: true,
    data: { ...record, key }, // full key — this is the only time it's ever returned
    message: 'Copy the key now — it will not be shown again',
  });
});

export const revokeApiKey = asyncHandler(async (req: AuthRequest, res: Response) => {
  const existing = await prisma.apiKey.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new AppError('API key not found', 404);

  await prisma.apiKey.update({
    where: { id: req.params.id },
    data: { isActive: false, revokedAt: new Date() },
  });

  await prisma.activityLog.create({
    data: {
      userId: req.user!.id,
      action: 'REVOKE',
      entity: 'API_KEY',
      entityId: req.params.id,
      details: { name: existing.name },
    },
  });

  logger.info(`API key revoked: ${existing.name}`);
  res.json({ success: true, message: `Key "${existing.name}" revoked` });
});

// ─── Webhooks ───

export const listWebhooks = asyncHandler(async (_req: AuthRequest, res: Response) => {
  const endpoints = await prisma.webhookEndpoint.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, url: true, events: true, isActive: true,
      failCount: true, lastStatus: true, lastDeliveryAt: true, createdAt: true,
    },
  });
  res.json({ success: true, data: endpoints, availableEvents: WEBHOOK_EVENTS });
});

export const createWebhook = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { url, events } = req.body;

  if (!url || !/^https?:\/\/.+/.test(String(url))) {
    throw new AppError('A valid http(s) URL is required', 400);
  }
  const eventList: string[] = Array.isArray(events) ? events.map(String) : [];
  const invalid = eventList.filter((e) => !(WEBHOOK_EVENTS as readonly string[]).includes(e));
  if (eventList.length === 0 || invalid.length > 0) {
    throw new AppError(`Subscribe to at least one of: ${WEBHOOK_EVENTS.join(', ')}`, 400);
  }

  const secret = `whsec_${crypto.randomBytes(24).toString('hex')}`;
  const endpoint = await prisma.webhookEndpoint.create({
    data: { url: String(url), events: eventList, secret, createdBy: req.user!.id },
  });

  logger.info(`Webhook endpoint added: ${endpoint.url} (${eventList.join(', ')})`);
  res.status(201).json({
    success: true,
    data: { ...endpoint }, // includes the secret — only time it's returned
    message: 'Copy the signing secret now — it will not be shown again',
  });
});

export const updateWebhook = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { events, isActive, url } = req.body;
  const existing = await prisma.webhookEndpoint.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new AppError('Webhook endpoint not found', 404);

  const data: any = {};
  if (url !== undefined) {
    if (!/^https?:\/\/.+/.test(String(url))) throw new AppError('Invalid URL', 400);
    data.url = String(url);
  }
  if (events !== undefined) {
    const eventList: string[] = Array.isArray(events) ? events.map(String) : [];
    const invalid = eventList.filter((e) => !(WEBHOOK_EVENTS as readonly string[]).includes(e));
    if (eventList.length === 0 || invalid.length > 0) {
      throw new AppError(`Subscribe to at least one of: ${WEBHOOK_EVENTS.join(', ')}`, 400);
    }
    data.events = eventList;
  }
  if (isActive !== undefined) {
    data.isActive = Boolean(isActive);
    if (data.isActive) data.failCount = 0; // re-enabling resets the failure streak
  }

  const endpoint = await prisma.webhookEndpoint.update({
    where: { id: req.params.id },
    data,
    select: {
      id: true, url: true, events: true, isActive: true,
      failCount: true, lastStatus: true, lastDeliveryAt: true, createdAt: true,
    },
  });
  res.json({ success: true, data: endpoint, message: 'Webhook updated' });
});

export const deleteWebhook = asyncHandler(async (req: AuthRequest, res: Response) => {
  const existing = await prisma.webhookEndpoint.findUnique({ where: { id: req.params.id } });
  if (!existing) throw new AppError('Webhook endpoint not found', 404);

  await prisma.webhookEndpoint.delete({ where: { id: req.params.id } });
  res.json({ success: true, message: 'Webhook endpoint deleted' });
});

export const testWebhook = asyncHandler(async (req: AuthRequest, res: Response) => {
  const result = await sendTestWebhook(req.params.id);
  res.json({
    success: true,
    data: result,
    message: result.delivered
      ? `Ping delivered (HTTP ${result.status})`
      : `Delivery failed${result.status ? ` (HTTP ${result.status})` : ' (network error or timeout)'}`,
  });
});
