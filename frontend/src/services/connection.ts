/**
 * Whether the POS server can be reached right now.
 *
 * The browser's own "online" flag only says this computer has a network: a
 * store's router is usually still up when its internet is down, and the flag
 * stays "online". So when a request gets no answer from the POS server, the
 * server's health address is asked directly, and only if that fails too is the
 * register offline. One blocked or failing request therefore never flips the
 * register offline while the server is fine. While offline, the health address
 * is asked every few seconds so the register notices the server coming back.
 * The register uses this to switch to its saved catalog and offline cash sales.
 */
type Listener = (offline: boolean) => void;

let unreachable = false;
let verifying: Promise<void> | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let check: (() => Promise<boolean>) | null = null;
const listeners = new Set<Listener>();

const browserOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;
const ask = async () => { try { return !!check && await check(); } catch { return false; } };

/** True when the browser is offline or the POS server is not answering. */
export const isOffline = () => browserOffline() || unreachable;

const notify = () => { const offline = isOffline(); listeners.forEach(listener => listener(offline)); };

function watch(delay: number) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    timer = undefined;
    if (!unreachable) return;
    // No point asking while the computer itself has no network.
    if (!browserOffline() && await ask()) serverAnswered();
    else if (unreachable) watch(5000);
  }, delay);
}

function markUnreachable() {
  if (unreachable) return;
  unreachable = true;
  notify();
  watch(5000);
}

/** How to ask the server whether it is there (set once by the API client). */
export function setServerCheck(health: () => Promise<boolean>) { check = health; }

/** Any answer from the POS server itself, success or error. */
export function serverAnswered() {
  if (!unreachable) return;
  unreachable = false;
  if (timer) { clearTimeout(timer); timer = undefined; }
  notify();
}

/**
 * A request got no answer from the POS server (no network path, a timeout, or
 * a gateway error page). The register goes offline only if the health address
 * does not answer either.
 */
export function serverDidNotAnswer() {
  if (unreachable || verifying) return;
  if (browserOffline() || !check) { markUnreachable(); return; }
  verifying = ask().then(answered => { if (!answered) markUnreachable(); }).finally(() => { verifying = null; });
}

/** Resolves once any health check in progress has decided; then `isOffline()` is current. */
export const connectionSettled = (): Promise<void> => verifying ?? Promise.resolve();

/** Called with the new state whenever the register goes offline or comes back. */
export function subscribeConnection(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('online', () => { if (unreachable) watch(0); notify(); });
  window.addEventListener('offline', notify);
}
