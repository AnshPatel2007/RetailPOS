import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import { useAdminViewStore } from '@/store/adminViewStore';
import { sessionGeneration } from '@/services/sessionGeneration';
import { storeContextGeneration } from '@/services/storeContextGeneration';
import { subscribeScopedQueryInvalidation } from '@/services/queryCache';
import { canRefreshInBackground, subscribeRefreshEnvironment } from '@/services/autoRefreshEnvironment';
import { createReadRefreshScheduler, ReadRefreshContext } from '@/services/readRefreshScheduler';

export type { ReadRefreshContext } from '@/services/readRefreshScheduler';
export interface AutoRefreshOptions {
  enabled?: boolean;
  key?: unknown;
  intervalMs?: number;
  /** One-shot reviewed snapshots/POST previews must opt out of automatic triggers. */
  automatic?: boolean;
  paused?: boolean;
  immediate?: boolean;
}

/** For read loaders only. Apply responses only while context.current() is true. */
export function useAutoRefresh(load: (context: ReadRefreshContext) => Promise<unknown>, options: AutoRefreshOptions = {}) {
  const user = useAuthStore(state => state.user);
  const preview = useAdminViewStore(state => state.viewingLocationId);
  const { enabled = true, intervalMs = 30000, automatic = true, immediate = true, paused = false } = options;
  const key = JSON.stringify([user?.id, user?.role, user?.locationId, preview, sessionGeneration(), storeContextGeneration(), options.key]);
  const loader = useRef(load); loader.current = load;
  const pause = useRef(paused); pause.current = paused;
  const coordinator = useRef<ReturnType<typeof createReadRefreshScheduler> | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState({ key: '', error: '', updatedAt: 0 });
  const refresh = useCallback(() => { coordinator.current?.request('manual'); }, []);

  useEffect(() => {
    setRefreshing(false);
    if (!enabled) return;
    const generation = sessionGeneration(), store = storeContextGeneration();
    const scheduler = createReadRefreshScheduler({
      load: async context => {
        try {
          const value = await loader.current(context);
          if (context.current()) setStatus({ key, error: '', updatedAt: Date.now() });
          return value;
        } catch (error: unknown) {
          if (context.current()) setStatus(previous => ({ key, updatedAt: previous.key === key ? previous.updatedAt : 0,
            error: (error as { response?: { data?: { error?: string } } }).response?.data?.error || 'Unable to update. Retry when connected.' }));
          throw error;
        }
      }, intervalMs, automatic,
      current: () => generation === sessionGeneration() && store === storeContextGeneration(),
      canBackground: () => !pause.current && canRefreshInBackground(),
      onBusy: setRefreshing,
    });
    coordinator.current = scheduler;
    const unlisten = automatic ? subscribeScopedQueryInvalidation(() => scheduler.request('mutation')) : () => {};
    const unsubscribe = subscribeRefreshEnvironment(reason => {
      if (reason === 'focus' || reason === 'online') scheduler.request(reason);
      scheduler.environmentChanged();
    });
    if (immediate) scheduler.request('initial');
    else scheduler.start();
    return () => { unlisten(); unsubscribe(); scheduler.dispose(); if (coordinator.current === scheduler) coordinator.current = null; };
  }, [key, enabled, intervalMs, automatic, immediate]);

  useEffect(() => { coordinator.current?.environmentChanged(); }, [paused]);
  const matches = enabled && status.key === key;
  return { refresh, refreshing, error: matches ? status.error : '', stale: matches && !!status.error && status.updatedAt > 0,
    updatedAt: matches ? status.updatedAt : null };
}
