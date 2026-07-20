/**
 * Webhook delivery: POSTs signed event payloads to subscribed endpoints.
 *
 * Deliveries are fire-and-forget (never block a sale), signed with
 * HMAC-SHA256 (`X-Webhook-Signature: sha256=<hex>` over the raw body), and
 * endpoints auto-disable after 20 consecutive failures.
 */

import crypto from 'crypto';
import prisma from '../config/database';
import { logger } from '../utils/logger';

export const WEBHOOK_EVENTS = ['sale.completed', 'sale.refunded', 'product.low_stock'] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

const MAX_CONSECUTIVE_FAILURES = 20;
const DELIVERY_TIMEOUT_MS = 5000;

export const signWebhookPayload = (secret: string, body: string): string =>
  `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;

const deliver = async (
  endpoint: { id: string; url: string; secret: string; failCount: number },
  body: string
): Promise<void> => {
  let status: number | null = null;
  let ok = false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
    const resp = await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': signWebhookPayload(endpoint.secret, body),
        'User-Agent': 'RetailPOS-Webhooks/1.0',
      },
      body,
      signal: controller.signal,
    });
    clearTimeout(timer);
    status = resp.status;
    ok = resp.ok;
  } catch {
    ok = false; // network error / timeout
  }

  const newFailCount = ok ? 0 : endpoint.failCount + 1;
  await prisma.webhookEndpoint
    .update({
      where: { id: endpoint.id },
      data: {
        failCount: newFailCount,
        lastStatus: status,
        lastDeliveryAt: new Date(),
        // Auto-disable a dead endpoint rather than hammering it forever
        ...(newFailCount >= MAX_CONSECUTIVE_FAILURES ? { isActive: false } : {}),
      },
    })
    .catch(() => {});

  if (!ok) {
    logger.warn(
      `Webhook delivery failed (${status ?? 'network error'}) → ${endpoint.url}` +
        (newFailCount >= MAX_CONSECUTIVE_FAILURES ? ' — endpoint auto-disabled' : '')
    );
  }
};

/**
 * Emit an event to every active endpoint subscribed to it.
 * Fire-and-forget: call without awaiting from hot paths.
 */
export const emitWebhook = async (event: WebhookEvent, data: unknown): Promise<void> => {
  try {
    const endpoints = await prisma.webhookEndpoint.findMany({
      where: { isActive: true, events: { has: event } },
    });
    if (endpoints.length === 0) return;

    const body = JSON.stringify({
      id: crypto.randomUUID(),
      event,
      createdAt: new Date().toISOString(),
      data,
    });

    await Promise.allSettled(endpoints.map((e) => deliver(e, body)));
  } catch (err: any) {
    logger.warn(`Webhook emit failed for ${event}: ${err?.message || err}`);
  }
};

/** Send a ping event to one endpoint (used by the "Test" button) */
export const sendTestWebhook = async (endpointId: string): Promise<{ delivered: boolean; status: number | null }> => {
  const endpoint = await prisma.webhookEndpoint.findUnique({ where: { id: endpointId } });
  if (!endpoint) return { delivered: false, status: null };

  const body = JSON.stringify({
    id: crypto.randomUUID(),
    event: 'ping',
    createdAt: new Date().toISOString(),
    data: { message: 'Webhook test from your POS' },
  });
  await deliver(endpoint, body);

  const after = await prisma.webhookEndpoint.findUnique({ where: { id: endpointId } });
  return { delivered: after?.failCount === 0, status: after?.lastStatus ?? null };
};
