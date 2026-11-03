import { useRef, useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import { useAdminViewStore } from '@/store/adminViewStore';
import { sessionGeneration } from '@/services/sessionGeneration';
import { storeContextGeneration } from '@/services/storeContextGeneration';
import { scopedQueryCache as cache } from '@/services/queryCache';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
export { invalidateScopedQueries } from '@/services/queryCache';

useAuthStore.subscribe((state, previous) => {
  if (state.user?.id !== previous.user?.id || state.user?.role !== previous.user?.role || state.user?.locationId !== previous.user?.locationId) cache.clear();
});
useAdminViewStore.subscribe((state, previous) => { if (state.viewingLocationId !== previous.viewingLocationId) cache.clear(); });

export interface ScopedQueryOptions {
  refreshInterval?: number;
  autoRefresh?: boolean;
  paused?: boolean;
}

/** Only mounted/active views fetch. No previous-store data can render on a new key. */
export function useScopedQuery<T>(queryKey: unknown[], load: (signal: AbortSignal) => Promise<T>, enabled = true, staleTime = 30000, options: ScopedQueryOptions = {}) {
  const user = useAuthStore(state => state.user);
  const preview = useAdminViewStore(state => state.viewingLocationId);
  const key = JSON.stringify([user?.id, user?.role, user?.locationId, preview, sessionGeneration(), storeContextGeneration(), ...queryKey]);
  const [result, setResult] = useState<{ key: string; data: T | null; error: string; at: number }>({ key: '', data: null, error: '', at: 0 });
  const loader = useRef(load); loader.current = load;
  const { refresh, refreshing } = useAutoRefresh(async context => {
    const { signal, current, reason } = context;
    const saved = cache.get(key);
    if (reason === 'initial' && saved && Date.now() - saved.at < staleTime) {
      if (current()) setResult({ key, data: saved.data as T, error: '', at: saved.at });
      return;
    }
    try {
      const data = await loader.current(signal);
      if (!current()) return;
      if (cache.size >= 100) cache.delete(cache.keys().next().value!);
      const at = Date.now();
      cache.set(key, { at, data }); setResult({ key, data, error: '', at });
    } catch (error: unknown) {
      if (current()) setResult(previous => ({ key, data: previous.key === key ? previous.data : null, at: previous.key === key ? previous.at : 0,
        error: (error as { response?: { data?: { error?: string } } }).response?.data?.error || 'Unable to load this view. Retry when connected.' }));
      throw error;
    }
  }, { key, enabled: enabled && !!user, intervalMs: options.refreshInterval, automatic: options.autoRefresh ?? staleTime > 0, paused: options.paused });
  const matching = enabled && !!user && result.key === key;
  return { data: enabled && result.key === key ? result.data : null, error: enabled && result.key === key ? result.error : '',
    loading: enabled && !!user && (!matching || (result.data === null && refreshing && !result.error)),
    refreshing: enabled && refreshing, stale: matching && result.data !== null && !!result.error, updatedAt: matching ? result.at : null, refresh };
}
