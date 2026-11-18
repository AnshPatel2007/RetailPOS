/** Shared without React/store/API imports so API mutations can invalidate reads. */
export const scopedQueryCache = new Map<string, { at: number; data: unknown }>();
export const scopedQueryInvalidations = new Set<() => void>();

// Only a versioned notification crosses tabs. User/store identifiers and cached data
// never leave this tab. A receiving tab revalidates using its own authorization.
const channelName = 'pos-read-invalidation-v1';
let channel: BroadcastChannel | undefined;
let listening = false;
function invalidateLocalQueries() {
  scopedQueryCache.clear();
  // Read subscribers must never turn a confirmed write into a failed API response.
  scopedQueryInvalidations.forEach(refresh => { try { refresh(); } catch { /* The subscriber can recover on its next activation. */ } });
}

function connectInvalidations() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      channel = new BroadcastChannel(channelName);
      channel.onmessage = event => { if (event.data === 1) invalidateLocalQueries(); };
    } catch { /* Restricted browser storage falls back to storage events/local reads. */ }
  }
  if (!channel) window.addEventListener('storage', event => { if (event.key === channelName && event.newValue) invalidateLocalQueries(); });
}

export function subscribeScopedQueryInvalidation(refresh: () => void) {
  connectInvalidations();
  scopedQueryInvalidations.add(refresh);
  return () => { scopedQueryInvalidations.delete(refresh); };
}

export function invalidateScopedQueries() {
  connectInvalidations();
  invalidateLocalQueries();
  if (channel) { try { channel.postMessage(1); return; } catch { /* A closing/restricted tab must not reject the write. */ } }
  if (typeof window !== 'undefined') {
    try { window.localStorage.setItem(channelName, `${Date.now()}:${Math.random()}`); } catch { /* Local refresh remains available without storage. */ }
  }
}
