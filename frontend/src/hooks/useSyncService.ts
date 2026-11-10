import { useState, useEffect, useCallback } from 'react';
import { syncService } from '../services/syncService';

interface SyncState {
  status: 'idle' | 'syncing' | 'success' | 'error';
  connectionStatus: 'online' | 'offline';
  pendingSalesCount: number;
  lastSyncTime?: number;
  lastError?: string;
}

export function useSyncService() {
  const [state, setState] = useState<SyncState>(syncService.getState());

  useEffect(() => {
    const unsubscribe = syncService.subscribe(setState);
    return unsubscribe;
  }, []);

  const sync = useCallback(async () => {
    await syncService.manualSync();
  }, []);

  // Asked for by a person: download everything again, not just changes.
  const cacheData = useCallback(async () => {
    await syncService.cacheAllData(true);
  }, []);

  const getStats = useCallback(async () => {
    return syncService.getStats();
  }, []);

  return {
    ...state,
    isOnline: state.connectionStatus === 'online',
    isOffline: state.connectionStatus === 'offline',
    isSyncing: state.status === 'syncing',
    hasPendingSales: state.pendingSalesCount > 0,
    sync,
    cacheData,
    getStats,
  };
}

export default useSyncService;
