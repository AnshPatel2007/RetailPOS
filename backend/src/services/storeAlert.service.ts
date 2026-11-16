/**
 * Phone alerts: something a store's owners (or owners and managers) should know at
 * once, sent to every phone or computer where they turned alerts on (Web Push).
 *
 * An alert is recorded once per store and key (store_alerts), so a retry, a second
 * server or a scheduler pass never sends it twice. Recipients are read when it is
 * sent: everyone with ADMIN (and, for LEADS alerts, MANAGER) access to the store
 * today. A device the push service reports gone is removed. A high alert goes out
 * by email when no owner of the store has a device on. Nothing here ever fails the
 * request that raised it.
 */
import webpush from 'web-push';
import prisma from '../config/database';
import { config } from '../config';
import { logger } from '../utils/logger';
import { enqueueDigestEmails } from './emailDelivery.service';

export type AlertAudience = 'OWNERS' | 'LEADS';
export interface StoreAlertInput {
  key: string;
  kind: string;
  severity: 'high' | 'medium' | 'low';
  sentence: string;
  /** The page that deals with it. */
  href: string;
  audience?: AlertAudience;
}
export interface PushMessage { title: string; body: string; tag: string; url: string }

let vapid: { publicKey: string } | null | undefined;
/** The server's public push key when phone alerts are set up (VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY), else null. */
export function pushPublicKey(): string | null {
  if (vapid === undefined) {
    const publicKey = process.env.VAPID_PUBLIC_KEY?.trim(), privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
    vapid = null;
    if (publicKey && privateKey) {
      try {
        // The push services contact this address about the sender; https or mailto only.
        const subject = process.env.VAPID_SUBJECT?.trim() || (/^https:/.test(config.app.url) ? config.app.url : 'mailto:' + (process.env.EMAIL_FROM || 'alerts@localhost'));
        webpush.setVapidDetails(subject, publicKey, privateKey);
        vapid = { publicKey };
      } catch { logger.error('Phone alerts are off: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY or VAPID_SUBJECT is not valid'); }
    }
  }
  return vapid?.publicKey ?? null;
}
/** For tests: read the push keys again. */
export const resetPushKeys = () => { vapid = undefined; };

/** The link a tap opens: the alert's store first (a person may run several), then its page. */
export const alertLink = (locationId: string, href: string) => `/alerts/open?store=${encodeURIComponent(locationId)}&to=${encodeURIComponent(href)}`;

/** Sends to each device; a device the push service no longer knows is removed. Returns how many were reached. */
export async function sendToDevices(subscriptions: { id: string; endpoint: string; p256dh: string; auth: string }[], message: PushMessage, urgent = false) {
  if (!pushPublicKey() || !subscriptions.length) return 0;
  let reached = 0;
  await Promise.all(subscriptions.map(async subscription => {
    try {
      await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
        JSON.stringify(message), { TTL: 4 * 3600, urgency: urgent ? 'high' : 'normal' });
      reached++;
      await prisma.pushSubscription.updateMany({ where: { id: subscription.id }, data: { lastSentAt: new Date() } });
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) await prisma.pushSubscription.deleteMany({ where: { id: subscription.id } });
      else logger.warn('Phone alert not delivered to a device' + (status ? ` (push service answered ${status})` : ''));
    }
  }));
  return reached;
}

const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function notify(locationId: string, alert: StoreAlertInput & { audience: AlertAudience }) {
  const store = await prisma.location.findUnique({ where: { id: locationId }, select: { name: true, isActive: true } });
  if (!store?.isActive) return;
  const roles = alert.audience === 'LEADS' ? ['ADMIN', 'MANAGER'] as const : ['ADMIN'] as const;
  const people = await prisma.user.findMany({
    where: { isActive: true, storeAccess: { some: { locationId, role: { in: [...roles] } } } },
    select: { id: true, email: true, storeAccess: { where: { locationId }, select: { role: true } },
      pushSubscriptions: { select: { id: true, endpoint: true, p256dh: true, auth: true } } },
  });
  const message: PushMessage = { title: store.name, body: alert.sentence, tag: alert.key, url: alertLink(locationId, alert.href) };
  await sendToDevices(people.flatMap(person => person.pushSubscriptions), message, alert.severity === 'high');
  // Urgent, and no owner would see it on a phone: the owners get it by email.
  const owners = people.filter(person => person.storeAccess.some(access => access.role === 'ADMIN'));
  if (alert.severity === 'high' && !owners.some(owner => owner.pushSubscriptions.length) && owners.length) {
    const link = config.app.url + message.url;
    await enqueueDigestEmails(locationId, 'store-alert:' + locationId + ':' + alert.key, owners.map(owner => owner.email), `${store.name}: ${alert.sentence}`,
      `<p style="font-family:Arial,sans-serif;font-size:15px;">${esc(alert.sentence)}</p><p style="font-family:Arial,sans-serif;"><a href="${esc(link)}">Open it in the POS</a></p>`
      + '<p style="font-family:Arial,sans-serif;font-size:12px;color:#666;">Turn on alerts on your phone (Settings > Profile & Security) to get these at once.</p>');
  }
}

/** Alert work still running (recording and sending): tests wait for it. */
const sending = new Set<Promise<void>>();
export const alertsSettled = async () => { while (sending.size) await Promise.all([...sending]); };
/** Runs alert work once the response is sent: it never fails or delays the request. */
export function afterResponse(work: () => Promise<unknown>) {
  const tracked: Promise<void> = Promise.resolve().then(work).then(() => undefined, () => { logger.warn('Store alert failed'); })
    .finally(() => { sending.delete(tracked); });
  sending.add(tracked);
}

/**
 * Records the alert once and tells the store's people in the background. True when it
 * is new. Never throws: an alert must not fail the sale, refund or shift that raised it.
 */
export async function raiseStoreAlert(locationId: string, alert: StoreAlertInput): Promise<boolean> {
  try {
    const audience = alert.audience ?? 'OWNERS';
    const recorded = await prisma.storeAlert.createMany({ data: [{ locationId, key: alert.key, kind: alert.kind, severity: alert.severity, audience,
      sentence: alert.sentence, href: alert.href }], skipDuplicates: true });
    if (!recorded.count) return false;
    const work: Promise<void> = notify(locationId, { ...alert, audience })
      .catch(() => logger.warn('Phone alert recorded but not sent; it stays in the store\'s alerts'))
      .finally(() => { sending.delete(work); });
    sending.add(work);
    return true;
  } catch {
    logger.warn('Store alert could not be recorded');
    return false;
  }
}

/** Closes an alert whose condition has cleared (it stays in the history). */
export async function resolveStoreAlert(locationId: string, key: string, now = new Date()) {
  await prisma.storeAlert.updateMany({ where: { locationId, key, resolvedAt: null }, data: { resolvedAt: now } }).catch(() => logger.warn('Store alert could not be closed'));
}

/** The owner's alert amounts; a store without a row uses $50 and $5. */
export async function storeAlertSettings(locationId: string) {
  const row = await prisma.storeAlertSetting.findUnique({ where: { locationId } });
  return { refundAlertOver: row ? (row.refundAlertOver === null ? null : Number(row.refundAlertOver)) : 50,
    drawerAlertOver: row ? (row.drawerAlertOver === null ? null : Number(row.drawerAlertOver)) : 5 };
}
