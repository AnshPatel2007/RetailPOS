import { useEffect, useState } from 'react';
import { inventoryExceptionService } from '@/services/api';
import { subscribeScopedQueryInvalidation } from '@/services/queryCache';

/**
 * Unresolved negative-stock exceptions for the sidebar and Stock Control badges
 * (managers only). Refreshes right after any confirmed change in this or another
 * tab (a sale that oversells, an adjustment, a resolution), on focus, and every
 * two minutes as a fallback.
 */
export function useInventoryExceptionCount(enabled: boolean, locationId?: string | null) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) { setCount(0); return; }
    let controller = new AbortController();
    let pending: number | undefined;
    const load = () => {
      controller.abort(); controller = new AbortController();
      inventoryExceptionService.summary(locationId ? { locationId } : undefined, controller.signal)
        .then(res => setCount(res.data.data.unresolved ?? 0))
        .catch(() => { /* badge is advisory; the page shows real errors */ });
    };
    // Several writes can land together (a sale and its payment); ask once.
    const soon = () => { window.clearTimeout(pending); pending = window.setTimeout(load, 250); };
    const visible = () => { if (document.visibilityState === 'visible') soon(); };
    load();
    const unsubscribe = subscribeScopedQueryInvalidation(soon);
    window.addEventListener('focus', soon);
    document.addEventListener('visibilitychange', visible);
    const timer = window.setInterval(load, 120_000);
    return () => {
      controller.abort(); window.clearInterval(timer); window.clearTimeout(pending); unsubscribe();
      window.removeEventListener('focus', soon); document.removeEventListener('visibilitychange', visible);
    };
  }, [enabled, locationId]);
  return count;
}
