import { useEffect, useState } from 'react';
import { inventoryExceptionService } from '@/services/api';

/** Unresolved negative-stock exceptions for the sidebar badge (managers only). */
export function useInventoryExceptionCount(enabled: boolean, locationId?: string | null) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) { setCount(0); return; }
    let controller = new AbortController();
    const load = () => {
      controller.abort(); controller = new AbortController();
      inventoryExceptionService.summary(locationId ? { locationId } : undefined, controller.signal)
        .then(res => setCount(res.data.data.unresolved ?? 0))
        .catch(() => { /* badge is advisory; the page shows real errors */ });
    };
    load();
    const timer = window.setInterval(load, 120_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [enabled, locationId]);
  return count;
}
