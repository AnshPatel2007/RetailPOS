import crypto from 'crypto';
import https from 'https';
import { lookup } from 'dns/promises';
import * as ipaddr from 'ipaddr.js';
import { Prisma, BackgroundJob } from '@prisma/client';
import prisma from '../config/database';
import { numeric } from '../utils/money';
import { enqueueJob, jobPayload, JobFailure, JobOutcome } from './jobQueue.service';
import { AppError } from '../utils/errorHandler';

export const WEBHOOK_EVENTS = ['sale.completed', 'sale.refunded', 'product.low_stock'] as const;
export type WebhookEvent = typeof WEBHOOK_EVENTS[number];
export const signWebhookPayload = (secret: string, body: string) => `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
export function validateWebhookUrl(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new AppError('A public HTTPS webhook URL is required', 400); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443')) throw new AppError('A public HTTPS webhook URL on port 443 is required', 400);
  return url;
}
/** The event and its subscriber deliveries are committed with the sale/refund. */
export async function queueWebhook(tx: Prisma.TransactionClient, event: WebhookEvent, data: unknown, source: string, locationId: string | null, createdAt: Date) {
  const endpoints = await tx.webhookEndpoint.findMany({ where: { isActive: true, events: { has: event } } });
  const eventId = crypto.createHash('sha256').update(event + ':' + source).digest('hex');
  const body = JSON.stringify({ id: eventId, event, createdAt: createdAt.toISOString(), data: numeric(data) });
  for (const endpoint of endpoints) await enqueueJob(tx, { kind: 'WEBHOOK', idempotencyKey: 'webhook:' + event + ':' + source + ':' + endpoint.id,
    locationId, label: event, payload: { endpointId: endpoint.id, url: endpoint.url, body, eventId } });
}
export const emitWebhook = (event: WebhookEvent, data: unknown) => prisma.$transaction(tx => queueWebhook(tx, event, data, crypto.randomUUID(), null, new Date()));

/** Resolve once and pin that public IP for the request; never follow redirects. */
export async function postSignedWebhook(address: string, body: string, signature: string, eventId: string): Promise<number> {
  const url = validateWebhookUrl(address), hostname = url.hostname.replace(/^\[|\]$/g, '');
  const answers = await lookup(hostname, { all: true });
  if (!answers.length || answers.some(answer => ipaddr.process(answer.address).range() !== 'unicast')) throw new JobFailure('DESTINATION_NOT_PUBLIC');
  const selected = answers[0];
  return new Promise((resolve, reject) => {
    const request = https.request(url, { method: 'POST', lookup: (_name, _options, callback) => callback(null, selected.address, selected.family),
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'X-Webhook-Signature': signature,
        'X-Webhook-Id': eventId, 'User-Agent': 'RetailPOS-Webhooks/2.0' } }, response => { response.resume(); resolve(response.statusCode || 0); });
    request.setTimeout(5000, () => request.destroy(new Error('TIMEOUT')));
    request.once('error', () => reject(new JobFailure('NETWORK_OR_TIMEOUT', true)));
    request.end(body);
  });
}
export async function deliverWebhookJob(job: BackgroundJob): Promise<JobOutcome> {
  const payload = jobPayload<{ endpointId: string; url: string; body: string; eventId: string }>(job);
  const endpoint = await prisma.webhookEndpoint.findUnique({ where: { id: payload.endpointId } });
  if (!endpoint?.isActive || endpoint.url !== payload.url) return { status: 'CANCELLED', code: 'ENDPOINT_REMOVED_DISABLED_OR_CHANGED' };
  let status: number | null = null, failure = 'NETWORK_OR_TIMEOUT', retryable = true;
  try {
    status = await postSignedWebhook(endpoint.url, payload.body, signWebhookPayload(endpoint.secret, payload.body), payload.eventId);
    if (status < 200 || status >= 300) { failure = 'HTTP_' + status; retryable = status === 408 || status === 429 || status >= 500; }
  } catch (error) { if (error instanceof JobFailure) { failure = error.code; retryable = error.retryable; } }
  const accepted = status !== null && status >= 200 && status < 300;
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM webhook_endpoints WHERE id = ${endpoint.id} FOR UPDATE`;
    const current = await tx.webhookEndpoint.findUnique({ where: { id: endpoint.id } });
    if (current) { const failures = accepted ? 0 : current.failCount + 1; await tx.webhookEndpoint.update({ where: { id: endpoint.id }, data: {
      lastStatus: status, lastDeliveryAt: new Date(), failCount: failures, ...(failures >= 20 ? { isActive: false } : {}) } }); }
  });
  return accepted ? { status: 'ACCEPTED', result: { httpStatus: status, eventId: payload.eventId } }
    : { status: retryable ? 'RETRY' : 'FAILED', code: failure };
}
export async function sendTestWebhook(endpointId: string) {
  return prisma.$transaction(async tx => {
    const endpoint = await tx.webhookEndpoint.findUnique({ where: { id: endpointId } });
    if (!endpoint) throw new AppError('Webhook endpoint not found', 404);
    const eventId = crypto.randomUUID();
    return enqueueJob(tx, { kind: 'WEBHOOK', idempotencyKey: 'webhook:ping:' + eventId, label: 'ping', payload: {
      endpointId, url: endpoint.url, eventId, body: JSON.stringify({ id: eventId, event: 'ping', createdAt: new Date().toISOString(), data: { message: 'Webhook test from your POS' } }) } });
  });
}
