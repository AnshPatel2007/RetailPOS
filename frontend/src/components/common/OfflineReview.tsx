import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '@/services/offlineDb';
import { syncService } from '@/services/syncService';
import { useAuthStore } from '@/store/authStore';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { formatCurrency } from '@/lib/utils';
import { OfflineReconciliation } from './OfflineReconciliation';

export function OfflineReview({ onClose }: { onClose: () => void }) {
  const user = useAuthStore(state => state.user);
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!user?.locationId || user.role === 'SUPER_ADMIN' || !navigator.onLine) return;
    let active = true;
    void syncService.cacheAllData().catch(() => { if (active) setError('The offline catalog could not be updated. Reopen recovery when connected to try again.'); });
    return () => { active = false; };
  }, [user?.id, user?.locationId, user?.role]);
  const records = useLiveQuery(async () => {
    if (!user?.locationId || user.role === 'SUPER_ADMIN') return { cash: [], terminal: [], cachedAt: undefined };
    const canReviewStore = user.role === 'ADMIN' || user.role === 'MANAGER';
    const allowed = (record: { locationId?: string | null; userId?: string }) => record.locationId === user.locationId && (canReviewStore || record.userId === user.id);
    try {
      const [cash, terminal, cache] = await Promise.all([
        db.pendingSales.filter(record => !record.synced && allowed(record)).sortBy('createdAt'),
        db.terminalCheckouts.filter(record => allowed(record) && record.reconciliation?.status !== 'FINAL').sortBy('createdAt'),
        db.settings.get('products_cache_scope'),
      ]);
      return { cash, terminal, cachedAt: cache?.value?.userId === user.id && cache.value.locationId === user.locationId ? cache.value.cachedAt as number : undefined };
    } catch { return { cash: [], terminal: [], cachedAt: undefined, error: 'Unable to read this register’s saved transactions. Restore browser storage and retry.' }; }
  }, [user?.id, user?.locationId, user?.role]);
  const retry = async () => {
    setBusy(true); setError('');
    try {
      await syncService.manualSync();
      setError(syncService.getState().lastError || '');
    }
    catch (cause: unknown) { setError(cause instanceof Error ? cause.message : 'Sync failed'); }
    finally { setBusy(false); }
  };
  return <Modal isOpen onClose={() => { if (!busy) onClose(); }} title="Register recovery" size="lg">
    <div className="space-y-4 p-4">
      <p className="text-sm">Offline checkout supports cash only in an already loaded, signed-in shift. Starting or reloading the POS while offline is not supported. Gift cards, account payments and loyalty require a connection.</p>
      <p className="text-sm text-muted-foreground">Product cache: {records?.cachedAt ? new Date(records.cachedAt).toLocaleString() : 'Not available for this cashier and store'}.</p>
      <p className="text-sm text-muted-foreground">These records are stored on this browser. Keep them until the sale is confirmed. Managers and owners can review their store’s records here; only the original cashier can retry saving them.</p>
      {(error || records?.error) && <p role="alert" className="text-destructive">{error || records?.error}</p>}
      {!records ? <p role="status">Loading saved transactions…</p> : <>
        <h3 className="font-semibold">Pending cash sales ({records.cash.length})</h3>
        {!records.cash.length && <p className="text-sm text-muted-foreground">No pending cash sales in your scope on this register.</p>}
        <ul className="space-y-3">
          {records.cash.map(record => <li key={record.localId} className="space-y-1 rounded border p-3 text-sm break-words">
            <p className="font-medium">{formatCurrency(record.total)} · {new Date(record.createdAt).toLocaleString()}</p>
            <p>{record.userId === user?.id ? 'Your checkout' : 'Another cashier’s checkout'} · {record.syncAttempts} failed attempts</p>
            <p className="text-muted-foreground">Reference: {record.localId}</p>
            {record.syncError && <p role="alert" className="text-destructive">{record.syncError}</p>}
            {!record.payload && <p className="text-destructive">Original checkout details are missing. A manager must reconcile the payment with sales history.</p>}
          </li>)}
        </ul>
        {records.cash.some(record => record.userId === user?.id) && <Button onClick={retry} disabled={busy || !navigator.onLine}>{busy ? 'Retrying…' : 'Retry my cash sales'}</Button>}
        <h3 className="font-semibold">Terminal payments to confirm ({records.terminal.length})</h3>
        {!records.terminal.length && <p className="text-sm text-muted-foreground">No unconfirmed terminal payments in your scope on this register.</p>}
        <ul className="space-y-3">
          {records.terminal.map(record => <li key={record.key} className="space-y-1 rounded border p-3 text-sm break-words">
            <p className="font-medium">{formatCurrency(record.total)} · {new Date(record.createdAt).toLocaleString()}</p>
            <p>Terminal reference: {record.references.join(', ')}</p>
            <p className="text-muted-foreground">Checkout reference: {record.key}</p>
            <p>Do not charge again. {record.userId === user?.id ? 'Open POS to retry saving this payment.' : 'Return with the original cashier to retry saving.'}</p>
          </li>)}
        </ul>
        {records.terminal.some(record => record.userId === user?.id) && <Button onClick={() => { onClose(); navigate('/pos'); }}>Open POS recovery</Button>}
        {['ADMIN', 'MANAGER'].includes(user?.role || '') && <OfflineReconciliation cash={records.cash} terminal={records.terminal} />}
      </>}
    </div>
  </Modal>;
}
