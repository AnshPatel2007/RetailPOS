import { useEffect, useId, useRef, useState } from 'react';
import { XCircle, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { saleService } from '@/services/api';
import { bulkVoidStorageKey, readPendingBulkVoid, PendingBulkVoid } from '@/services/pendingBulkVoid';
import { cashOperationKey, cashOperationRejected } from '@/services/pendingCashOperation';
import { sessionGeneration } from '@/services/sessionGeneration';
import { useAuthStore } from '@/store/authStore';
import { can } from '@/lib/capabilities';
import { formatCurrency } from '@/lib/utils';
import type { Sale } from '@/types';

interface SalesBulkActionsProps {
  selectedSales: Sale[];
  onClearSelection: () => void;
  onSuccess: () => void;
}

export function SalesBulkActions({ selectedSales, onClearSelection, onSuccess }: SalesBulkActionsProps) {
  const reasonId = useId();
  const user = useAuthStore(state => state.user);
  const allowed = can(user?.role, 'sale.reverse') && !!user?.locationId;
  const storageKey = bulkVoidStorageKey(user?.id || '', user?.locationId || '');
  const [pending, setPending] = useState<PendingBulkVoid | null>(null);
  const [draft, setDraft] = useState<Sale[]>([]);
  const [reason, setReason] = useState('');
  const [showReview, setShowReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(false);
  const inFlight = useRef(false);
  const [, refreshRecovery] = useState(0);
  useEffect(() => { window.dispatchEvent(new Event('pos-reversal-recovery')); }, [pending, storageError]);
  useEffect(() => {
    const changed = () => refreshRecovery(value => value + 1);
    window.addEventListener('pos-reversal-recovery', changed); window.addEventListener('storage', changed);
    return () => { window.removeEventListener('pos-reversal-recovery', changed); window.removeEventListener('storage', changed); };
  }, []);

  const readSaved = () => {
    try {
      setPending(readPendingBulkVoid(storageKey)); setStorageError(false); setError(''); setReady(true);
    } catch {
      setStorageError(true); setReady(true);
      setError('The saved bulk void cannot be read. Ask a manager to reconcile it before starting another batch.');
    }
  };
  useEffect(() => {
    active.current = true;
    if (allowed) readSaved();
    const changed = (event: StorageEvent) => { if (!inFlight.current && (event.key === storageKey || event.key === null)) readSaved(); };
    window.addEventListener('storage', changed);
    return () => { active.current = false; window.removeEventListener('storage', changed); };
  }, [storageKey, allowed]);

  const submit = async () => {
    if (inFlight.current || !ready || storageError) return;
    const generation = sessionGeneration();
    const current = () => active.current && generation === sessionGeneration();
    let operation: PendingBulkVoid;
    let recovering = false;
    try {
      const saved = readPendingBulkVoid(storageKey);
      if (!saved && [cashOperationKey('refund', user?.id, user?.locationId), cashOperationKey('void', user?.id, user?.locationId),
        `pos-pending-operation:bulk-refund:${user?.locationId}:${user?.id}`].some(key => localStorage.getItem(key))) { setError('Confirm the saved refund or void before starting another batch.'); return; }
      recovering = !!saved;
      if (saved && saved.payload.idempotencyKey !== pending?.payload.idempotencyKey) {
        setPending(saved); setError('Another saved batch needs confirmation. Review it before retrying.'); return;
      }
      if (!saved && pending) {
        setPending(null); setShowReview(false); setError('The saved batch was cleared in another tab. Refresh the report before selecting sales again.'); onSuccess(); return;
      }
      operation = saved || {
        payload: { idempotencyKey: crypto.randomUUID(), reason: reason.trim(), sales: draft.map(sale => ({ id: sale.id, expectedAmount: sale.total })) },
        labels: Object.fromEntries(draft.map(sale => [sale.id, sale.saleNumber])),
        externalReversal: draft.some(sale => ['CARD', 'SPLIT', 'OTHER'].includes(sale.paymentMethod)),
      };
      if (!operation.payload.reason || !operation.payload.sales.length || operation.payload.sales.length > 50) { setError('Select 1 to 50 sales and enter a reason.'); return; }
      localStorage.setItem(storageKey, JSON.stringify(operation));
    } catch {
      setStorageError(true); setError('The bulk void cannot be saved for recovery. Restore browser storage before continuing.'); return;
    }
    setPending(operation); inFlight.current = true; setBusy(true); setError('');
    let confirmed = false;
    try {
      await saleService.bulkVoid(operation.payload);
      confirmed = true;
      // Do not erase a newer saved request from another tab.
      if (readPendingBulkVoid(storageKey)?.payload.idempotencyKey === operation.payload.idempotencyKey) localStorage.removeItem(storageKey);
      if (current()) { setPending(null); setShowReview(false); setReason(''); onClearSelection(); onSuccess(); }
    } catch (err) {
      if (!current()) return;
      if (confirmed) {
        setStorageError(true); setError('The bulk void is confirmed, but its saved recovery record could not be cleared. Restore browser storage and retry confirmation.'); return;
      }
      // A rejection of the initial attempt proves rollback. After an uncertain
      // attempt, a later permission/conflict error cannot prove non-commitment.
      if (!recovering && !operation.externalReversal && cashOperationRejected(err)) {
        try {
          if (readPendingBulkVoid(storageKey)?.payload.idempotencyKey === operation.payload.idempotencyKey) localStorage.removeItem(storageKey);
          setPending(readPendingBulkVoid(storageKey));
        }
        catch { setStorageError(true); }
      }
      const message = (err as { response?: { data?: { error?: string } } }).response?.data?.error;
      setError((message || 'The bulk void result is uncertain. Retry the saved batch to confirm it without paying or restoring stock twice.')
        + (operation.externalReversal ? ' Keep terminal reversal evidence and ask a manager to reconcile rejections; do not reverse terminal payments again.' : ''));
    } finally { inFlight.current = false; if (current()) setBusy(false); }
  };

  if (!allowed || (!selectedSales.length && !pending && !storageError && !error)) return null;
  const reviewSales = pending ? pending.payload.sales.map(sale => ({ ...sale, label: pending.labels[sale.id] }))
    : draft.map(sale => ({ id: sale.id, expectedAmount: sale.total, label: sale.saleNumber }));
  const total = reviewSales.reduce((sum, sale) => sum + Math.round(sale.expectedAmount * 100), 0) / 100;
  const reversalPending = (() => { try { return [cashOperationKey('refund', user?.id, user?.locationId), cashOperationKey('void', user?.id, user?.locationId),
    `pos-pending-operation:bulk-refund:${user?.locationId}:${user?.id}`].some(key => localStorage.getItem(key)); } catch { return true; } })();
  return <div className="bg-primary/10 border border-primary/20 rounded-md p-4 mb-4 space-y-3">
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-sm font-medium">{pending ? `${pending.payload.sales.length} saved void(s) need confirmation` : `${selectedSales.length} sale(s) selected`}</span>
      <Button size="sm" variant="destructive" disabled={busy || !ready || storageError || (!pending && (reversalPending || !selectedSales.length || selectedSales.length > 50 || selectedSales.some(sale => sale.status !== 'COMPLETED')))} onClick={() => { setDraft([...selectedSales]); setError(''); setShowReview(true); }}>
        <XCircle className="h-4 w-4 mr-1" />{pending ? 'Review saved bulk void' : 'Void Selected'}
      </Button>
      {selectedSales.length > 0 && <>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onClearSelection}><X className="h-4 w-4 mr-1" />Deselect All</Button>
      </>}
      {storageError && <Button size="sm" variant="outline" disabled={busy} onClick={readSaved}>Retry recovery storage</Button>}
    </div>
    {!pending && selectedSales.length > 50 && <p className="text-sm">Select at most 50 sales per batch.</p>}
    {!pending && selectedSales.some(sale => sale.status !== 'COMPLETED') && <p className="text-sm">Only completed sales can be voided. Review returned or already voided sales individually.</p>}
    {error && !showReview && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Modal isOpen={showReview} onClose={() => { if (!inFlight.current) setShowReview(false); }} title="Void Selected Sales" size="md">
      <div className="space-y-4">
        <p>Reverse {reviewSales.length} sale(s), totaling <strong>{formatCurrency(total)}</strong>, and restore their inventory. Every sale must be eligible; the whole batch saves together.</p>
        <p className="text-sm text-muted-foreground">Complete any external card reversals on the terminal first. The POS records the original tenders; cash payouts belong to your open drawer.</p>
        <ul className="max-h-48 overflow-y-auto space-y-2" aria-label="Sales to void">{reviewSales.map(sale => <li key={sale.id} className="flex flex-wrap justify-between gap-2"><span className="font-mono text-sm">{sale.label}</span><span>{formatCurrency(sale.expectedAmount)}</span></li>)}</ul>
        {pending ? <p role="status">A saved batch needs confirmation. Retry this exact batch before starting another. Reason: {pending.payload.reason}</p>
          : <div className="space-y-2"><label htmlFor={reasonId} className="block">Reason</label><textarea id={reasonId} className="w-full rounded-md border bg-background p-3" value={reason} onChange={event => setReason(event.target.value)} maxLength={500} /></div>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" disabled={busy} onClick={() => setShowReview(false)}>Close</Button><Button variant="destructive" disabled={busy || !ready || storageError || (!pending && !reason.trim())} onClick={submit}>{busy ? 'Saving...' : pending ? 'Retry saved bulk void' : 'Record Bulk Void'}</Button></div>
      </div>
    </Modal>
  </div>;
}
