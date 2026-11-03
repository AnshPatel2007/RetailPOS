import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';

/** Keep established page loaders quiet while they migrate to scoped queries. */
export function useLegacyPageRefresh(load: (current: () => boolean, signal: AbortSignal) => Promise<unknown>, options: {
  key: string;
  enabled?: boolean;
  paused?: boolean;
  intervalMs?: number;
}) {
  const [error, setError] = useState(false);
  useEffect(() => setError(false), [options.key]);
  const updates = useAutoRefresh(async ({ current, signal }) => {
    try {
      await load(current, signal);
      if (current()) setError(false);
    } catch (failure) {
      if (current()) setError(true);
      throw failure;
    }
  }, { ...options, immediate: false });
  return {
    ...updates,
    notice: error ? <div role="status" className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-warning/30 p-3 text-sm">
      <span>Updates are unavailable. Showing previously loaded data.</span>
      <Button variant="outline" disabled={updates.refreshing} onClick={updates.refresh}>Retry</Button>
    </div> : null,
  };
}
