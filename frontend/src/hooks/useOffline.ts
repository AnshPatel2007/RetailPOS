import { useSyncExternalStore } from 'react';
import { isOffline, subscribeConnection } from '@/services/connection';

/** True while the POS server cannot be reached (browser offline, or the server is not answering). */
export function useOffline(): boolean {
  return useSyncExternalStore(subscribeConnection, isOffline, isOffline);
}
