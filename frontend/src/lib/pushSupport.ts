/**
 * Whether this browser can show phone alerts. An iPhone or iPad can, but only from
 * the app added to the Home Screen; other browsers need service workers and push.
 */
export type PushSupport = 'supported' | 'install-first' | 'unsupported';
export interface BrowserFacts {
  userAgent: string; platform?: string; maxTouchPoints?: number;
  /** Safari's own "opened from the Home Screen" flag. */
  standalone?: boolean;
  hasServiceWorker: boolean; hasPushManager: boolean; hasNotification: boolean;
  /** `(display-mode: standalone)` matches: opened as an installed app. */
  displayStandalone: boolean;
}

export const isAppleTouchDevice = (facts: Pick<BrowserFacts, 'userAgent' | 'platform' | 'maxTouchPoints'>) =>
  /iPad|iPhone|iPod/.test(facts.userAgent) || (facts.platform === 'MacIntel' && (facts.maxTouchPoints ?? 0) > 1);

export function pushSupport(facts: BrowserFacts): PushSupport {
  const installed = facts.displayStandalone || facts.standalone === true;
  if (facts.hasServiceWorker && facts.hasPushManager && facts.hasNotification) return 'supported';
  return isAppleTouchDevice(facts) && !installed ? 'install-first' : 'unsupported';
}

/** The server's public push key (base64url) as the bytes `pushManager.subscribe` wants. */
export function applicationServerKey(base64url: string): ArrayBuffer {
  const base64 = (base64url + '='.repeat((4 - base64url.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const buffer = new ArrayBuffer(raw.length), bytes = new Uint8Array(buffer);
  for (let index = 0; index < raw.length; index++) bytes[index] = raw.charCodeAt(index);
  return buffer;
}

/** A short name for the device, shown in the list of devices with alerts on. */
export function deviceLabel(userAgent: string): string {
  if (/iPhone/.test(userAgent)) return 'iPhone';
  if (/iPad/.test(userAgent)) return 'iPad';
  if (/Android/.test(userAgent)) return /Mobile/.test(userAgent) ? 'Android phone' : 'Android tablet';
  if (/Windows/.test(userAgent)) return 'Windows computer';
  if (/Macintosh/.test(userAgent)) return 'Mac';
  return 'This device';
}
