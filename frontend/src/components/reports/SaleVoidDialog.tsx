import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { saleService } from '@/services/api';
import { useAuthStore } from '@/store/authStore';
import { cashOperationKey, cashOperationRejected, readCashOperation, PendingCashOperation } from '@/services/pendingCashOperation';
import { sessionGeneration } from '@/services/sessionGeneration';
import { formatCurrency } from '@/lib/utils';
import type { Sale } from '@/types';

export function SaleVoidDialog({ sale, onClose, onSuccess }: { sale: Sale; onClose: () => void; onSuccess: () => void }) {
  const user = useAuthStore(s => s.user);
  const storageKey = cashOperationKey('void', user?.id, user?.locationId);
  const [pending, setPending] = useState<PendingCashOperation | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [storageError, setStorageError] = useState(false);
  const [busy, setBusy] = useState(false);
  const active = useRef(true);
  const inFlight = useRef<string | null>(null);
  const readSaved = useCallback(() => {
    const saved = readCashOperation(storageKey);
    if (saved && (!saved.saleId || typeof saved.label !== 'string' || !Number.isFinite(saved.amount)
      || typeof saved.payload?.reason !== 'string' || !Number.isFinite(saved.payload?.expectedAmount)
      || typeof saved.payload?.idempotencyKey !== 'string' || !saved.payload.idempotencyKey)) throw Error('Invalid saved void');
    return saved;
  }, [storageKey]);
  const readRecovery = useCallback(() => {
    try {
      const saved = readSaved();
      setPending(saved); setReason(saved ? String(saved.payload.reason) : ''); setStorageError(false); setError('');
    } catch { setStorageError(true); setError('The saved void cannot be read. Ask a manager to reconcile it before recording another void.'); }
  }, [readSaved]);
  useEffect(() => {
    active.current = true; inFlight.current = null; setBusy(false); readRecovery();
    const changed = (event: StorageEvent) => { if (!inFlight.current && (event.key === storageKey || event.key === null)) readRecovery(); };
    window.addEventListener('storage', changed);
    return () => { active.current = false; window.removeEventListener('storage', changed); };
  }, [storageKey, readRecovery]);
  useEffect(() => { window.dispatchEvent(new Event('pos-reversal-recovery')); }, [pending, storageError]);
  const submit = async () => {
    if (inFlight.current || storageError) return;
    const generation = sessionGeneration();
    const current = () => active.current && generation === sessionGeneration();
    let operation: PendingCashOperation, recovering = false;
    try {
      const saved = readSaved(); recovering = !!saved;
      if (saved && saved.payload.idempotencyKey !== pending?.payload.idempotencyKey) {
        setPending(saved); setError('Another saved void needs confirmation. Review it before retrying.'); return;
      }
      if (!saved && pending) {
        setPending(null); setError('The saved void was cleared in another tab. Refresh the sale before starting another void.'); onSuccess(); return;
      }
      if (!saved && [
        cashOperationKey('refund', user?.id, user?.locationId),
        `pos-pending-bulk-void:${user?.locationId}:${user?.id}`,
        `pos-pending-operation:bulk-refund:${user?.locationId}:${user?.id}`,
      ].some(key => localStorage.getItem(key))) { setError('Confirm the saved refund or bulk void before starting another void.'); return; }
      operation = saved || { saleId: sale.id, label: sale.saleNumber, amount: sale.total, externalReversal: ['CARD', 'SPLIT', 'OTHER'].includes(sale.paymentMethod),
        payload: { idempotencyKey: crypto.randomUUID(), reason: reason.trim(), expectedAmount: sale.total } };
      if (!String(operation.payload.reason).trim()) { setError('Enter a reason for this void.'); return; }
      localStorage.setItem(storageKey, JSON.stringify(operation));
    }
    catch { setStorageError(true); setError('The void cannot be saved for recovery. Restore browser storage before continuing.'); return; }
    const flight = `${generation}:${operation.payload.idempotencyKey}`;
    setPending(operation); inFlight.current = flight; setBusy(true); setError('');
    let confirmed = false;
    try {
      await saleService.void(operation.saleId!, operation.payload as { reason: string; idempotencyKey: string; expectedAmount: number });
      confirmed = true;
      if (readSaved()?.payload.idempotencyKey === operation.payload.idempotencyKey) localStorage.removeItem(storageKey);
      if (current()) {
        const remaining = readSaved(); setPending(remaining); onSuccess();
        if (!remaining) onClose(); else setError('The void is confirmed. Review the other saved void before continuing.');
      }
    } catch (err) {
      if (!current()) return;
      if (confirmed) { setStorageError(true); setError('The void is confirmed, but its recovery record could not be cleared. Restore browser storage and retry confirmation.'); return; }
      const externalReversal = operation.externalReversal || (operation.saleId === sale.id && ['CARD', 'SPLIT', 'OTHER'].includes(sale.paymentMethod));
      if (!recovering && !externalReversal && cashOperationRejected(err)) {
        try {
          if (readSaved()?.payload.idempotencyKey === operation.payload.idempotencyKey) localStorage.removeItem(storageKey);
          setPending(readSaved());
        }
        catch { setStorageError(true); }
      }
      const message = (err as { response?: { data?: { error?: string } } }).response?.data?.error;
      setError((message || 'The void result is uncertain. Retry the saved void to confirm it without paying or restoring stock twice.')
        + (externalReversal ? ' Keep the terminal reversal evidence and ask a manager to reconcile any rejection; do not reverse the terminal payment again.' : ''));
    } finally { if (inFlight.current === flight) { inFlight.current = null; if (current()) setBusy(false); } }
  };
  return <Modal isOpen onClose={() => { if (!busy) onClose(); }} title="Void Sale" size="md">
    <div className="space-y-4">
      <p>{pending?.label || sale.saleNumber}: <strong>{formatCurrency(pending?.amount ?? sale.total)}</strong></p>
      <p className="text-sm text-muted-foreground">This reverses the full sale and restores its inventory. The original sale stays in its original period; the reversal is recorded today.</p>
      <p className="text-sm text-muted-foreground">For external card payments, complete the reversal on the card terminal first. This action records the reversal in the POS.</p>
      {sale.status === 'VOIDED' && !pending && <p role="status">This sale is already voided. {sale.voidEvent ? `${sale.voidEvent.reason} (${new Date(sale.voidEvent.createdAt).toLocaleString()})` : 'The legacy reversal date is unavailable.'}</p>}
      {pending ? <p role="status">A saved void needs confirmation. Retry it before starting another void. Reason: {String(pending.payload.reason)}</p> : sale.status !== 'VOIDED' && <label className="block space-y-2"><span>Reason</span><textarea className="w-full rounded-md border bg-background p-3" value={reason} onChange={e => setReason(e.target.value)} maxLength={500} /></label>}
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {storageError && <Button variant="outline" disabled={busy} onClick={readRecovery}>Retry recovery storage</Button>}
      <div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={onClose}>Close</Button><Button variant="destructive" disabled={busy || storageError || (!pending && (!reason.trim() || sale.status === 'VOIDED'))} onClick={submit}>{busy ? 'Saving...' : pending ? 'Retry saved void' : 'Record Void'}</Button></div>
    </div>
  </Modal>;
}
