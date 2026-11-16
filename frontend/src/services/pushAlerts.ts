import { pulseService } from './api';
import { applicationServerKey, deviceLabel, pushSupport, type PushSupport } from '@/lib/pushSupport';

/**
 * Phone alerts on this device (Settings > Profile & Security): turn on, off, and
 * forget this device when its person signs out. Needs the installed app: a service
 * worker is registered only in the built app (vite-plugin-pwa), not in development.
 */
export function browserPushSupport(): PushSupport {
  const nav = navigator as Navigator & { standalone?: boolean };
  return pushSupport({
    userAgent: nav.userAgent, platform: nav.platform, maxTouchPoints: nav.maxTouchPoints, standalone: nav.standalone,
    hasServiceWorker: 'serviceWorker' in nav, hasPushManager: 'PushManager' in window, hasNotification: 'Notification' in window,
    displayStandalone: typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches,
  });
}

async function registration() {
  if (!('serviceWorker' in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration()) ?? null;
}

/** This device's push subscription, if alerts are on here; null when the app's worker is not running (development). */
export async function deviceSubscription(): Promise<PushSubscription | null> {
  const found = await registration();
  return found ? found.pushManager.getSubscription() : null;
}

/** True when the installed app's worker runs here (alerts need it). */
export const appWorkerReady = async () => !!(await registration());

/** Asks for permission, subscribes this device and tells the server. */
export async function turnOnAlerts(publicKey: string) {
  const found = await registration();
  if (!found) throw new Error('Alerts need the installed app. Open the POS from your Home Screen or app list.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error(permission === 'denied'
    ? 'Notifications are blocked for this site. Allow them in the browser\'s site settings, then try again.'
    : 'Allow notifications to turn alerts on.');
  const subscription = await found.pushManager.getSubscription()
    ?? await found.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(publicKey) });
  const { endpoint, keys } = subscription.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await pulseService.subscribe({ endpoint, keys, deviceLabel: deviceLabel(navigator.userAgent) });
}

/** Stops alerts on this device (the server first, then the browser). */
export async function turnOffAlerts() {
  const subscription = await deviceSubscription();
  if (!subscription) return;
  await pulseService.unsubscribe(subscription.endpoint);
  await subscription.unsubscribe();
}

/**
 * Signing out: this device stops getting the person's alerts. Uses the token being
 * signed out (the stored one is already gone) and never holds sign-out up for long.
 */
export async function forgetDeviceOnSignOut(token: string | null) {
  const work = (async () => {
    const subscription = await deviceSubscription();
    if (!subscription) return;
    await pulseService.unsubscribe(subscription.endpoint, token).catch(() => undefined);
    await subscription.unsubscribe().catch(() => undefined);
  })().catch(() => undefined);
  await Promise.race([work, new Promise(resolve => setTimeout(resolve, 3000))]);
}
