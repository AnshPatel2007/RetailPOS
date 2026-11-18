import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { api } from '@/services/api';
import { useAuthStore } from '@/store/authStore';
import { sessionGeneration } from '@/services/sessionGeneration';
import { cashOperationRejected, hasExternalRefundEvidence } from '@/services/pendingCashOperation';

const schema = z.object({ label: z.string().min(1).max(300), path: z.string().min(1).max(400),
  payload: z.object({ idempotencyKey: z.string().uuid() }).passthrough() }).strict();
type Saved = z.infer<typeof schema>;
export function useSavedOperation(kind: string, allowedPrefix: string, onSuccess?: (data: any, operation: Saved) => void) {
  const user = useAuthStore(state => state.user);
  const key = `pos-pending-operation:${kind}:${user?.locationId || ''}:${user?.id || ''}`;
  const [pending, setPending] = useState<Saved | null>(null), [error, setError] = useState(''), [storageError, setStorageError] = useState(false), [busy, setBusy] = useState(false);
  const active = useRef(false), flight = useRef(false), success = useRef(onSuccess); success.current = onSuccess;
  const read = useCallback(() => {
    const raw = localStorage.getItem(key); if (raw === null) return null;
    const saved = schema.parse(JSON.parse(raw));
    if (!saved.path.startsWith(allowedPrefix) || saved.path.includes('..') || saved.path.includes('?')) throw new Error('Invalid saved operation');
    return saved;
  }, [key, allowedPrefix]);
  const refreshStorage = useCallback(() => {
    try { setPending(read()); setStorageError(false); setError(''); }
    catch { setStorageError(true); setError('Saved recovery data cannot be read. Reconcile it before recording another operation.'); }
  }, [read]);
  useEffect(() => { window.dispatchEvent(new Event('pos-reversal-recovery')); }, [pending, storageError]);
  useEffect(() => {
    active.current = true; refreshStorage();
    const changed = (event: StorageEvent) => { if (!flight.current && (event.key === key || event.key === null)) refreshStorage(); };
    window.addEventListener('storage', changed);
    return () => { active.current = false; window.removeEventListener('storage', changed); };
  }, [key, refreshStorage]);
  const submit = async (input?: { label: string; path: string; payload: Record<string, unknown> }) => {
    if (flight.current || storageError || !user) return;
    const generation = sessionGeneration(), current = () => active.current && generation === sessionGeneration();
    let saved: Saved, recovering = false, confirmed = false;
    try {
      const previous = read(); recovering = !!previous;
      if (input && kind === 'bulk-refund' && (localStorage.getItem(`pos-pending-bulk-void:${user.locationId}:${user.id}`) || localStorage.getItem(`pos-pending-void:${user.locationId}:${user.id}`) || localStorage.getItem(`pos-pending-refund:${user.locationId}:${user.id}`))) { setError('Confirm the saved reversal before recording another reversal.'); return; }
      if (input && previous) { setPending(previous); setError('Confirm the saved operation before starting another.'); return; }
      if (!input && !previous) { setPending(null); return; }
      saved = previous || schema.parse({ ...input, payload: { ...input!.payload, idempotencyKey: crypto.randomUUID() } });
      if (!saved.path.startsWith(allowedPrefix) || saved.path.includes('..') || saved.path.includes('?')) throw new Error('Invalid operation');
      localStorage.setItem(key, JSON.stringify(saved)); setPending(saved);
    } catch { setStorageError(true); setError('Nothing was sent. Browser recovery storage is unavailable. Restore it before continuing.'); return; }
    flight.current = true; setBusy(true); setError('');
    try {
      const response = await api.post(saved.path, saved.payload); confirmed = true;
      // A view may close while its request commits. Keep the key until a mounted
      // recovery view can apply its receipt (including local offline evidence).
      if (!current()) return response.data;
      if (read()?.payload.idempotencyKey === saved.payload.idempotencyKey) localStorage.removeItem(key);
      if (current()) { setPending(read()); success.current?.(response.data, saved); }
      return response.data;
    } catch (cause) {
      if (!current()) return;
      if (confirmed) { setStorageError(true); setError('The operation is confirmed, but recovery storage could not be cleared. Restore storage and retry confirmation.'); return; }
      const externalRefund = kind === 'bulk-refund' && hasExternalRefundEvidence(saved.payload);
      if (!recovering && !externalRefund && cashOperationRejected(cause)) {
        try { if (read()?.payload.idempotencyKey === saved.payload.idempotencyKey) localStorage.removeItem(key); setPending(read()); }
        catch { setStorageError(true); }
      }
      const detail = (cause as { response?: { data?: { error?: string } } }).response?.data?.error || 'Result uncertain. Retry the saved operation; do not repeat any payment.';
      setError(externalRefund ? detail + ' Terminal refund evidence is retained. Retry the exact saved request; if the conflict persists, ask the owner to reconcile the terminal record. Do not refund the card again.' : detail);
    } finally { flight.current = false; if (current()) setBusy(false); }
  };
  return { pending, error, storageError, busy, blocked: busy || !!pending || storageError, submit, retry: () => submit(), refreshStorage };
}
