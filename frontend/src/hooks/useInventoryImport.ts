import { useEffect, useRef, useState } from 'react';
import { api } from '@/services/api';
import { useAuthStore } from '@/store/authStore';
import { sessionGeneration } from '@/services/sessionGeneration';
import { cashOperationRejected } from '@/services/pendingCashOperation';

export interface ImportPreview {
  id: string | null; total: number; created: number; updated: number; errors: string[];
  rows: { number: number; data: { sku: string; name?: string }; productId: string | null; previousStock: number; nextStock: number;
    changes: { field: string; before: unknown; after: unknown }[] }[];
}
export function useInventoryImport(kind: 'CSV' | 'RECEIPT', onSuccess: () => void, open: boolean) {
  const user = useAuthStore(state => state.user);
  const key = `pos-pending-import:${kind}:${user?.locationId || ''}:${user?.id || ''}`;
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ total: number; created: number; updated: number } | null>(null);
  const inFlight = useRef(false);
  useEffect(() => {
    setPreview(null); setResult(null); setError('');
    try { setPending(localStorage.getItem(key)); }
    catch { setError('Browser storage is unavailable. Restore it before importing.'); }
  }, [key, open]);
  const review = async (payload: object) => {
    if (inFlight.current || pending) return;
    inFlight.current = true; setBusy(true); setError(''); setResult(null);
    const generation = sessionGeneration();
    try {
      const response = await api.post(`/products/imports/${kind.toLowerCase()}/preview`, payload);
      if (generation === sessionGeneration()) setPreview(response.data.data);
    } catch (failure) {
      if (generation === sessionGeneration()) setError((failure as { response?: { data?: { error?: string } } }).response?.data?.error || 'Unable to review this import.');
    } finally { inFlight.current = false; if (generation === sessionGeneration()) setBusy(false); }
  };
  const commit = async () => {
    if (inFlight.current) return;
    const id = pending || preview?.id; if (!id) return;
    inFlight.current = true; setBusy(true); setError('');
    const generation = sessionGeneration();
    let saved = false;
    try {
      localStorage.setItem(key, id); saved = true; setPending(id);
      const response = await api.post(`/products/imports/${id}/apply`);
      localStorage.removeItem(key);
      if (generation !== sessionGeneration()) return;
      setPending(null); setPreview(null); setResult(response.data.data); onSuccess();
    } catch (failure) {
      if (generation !== sessionGeneration()) return;
      if (saved && cashOperationRejected(failure)) {
        try { localStorage.removeItem(key); setPending(null); setPreview(null); }
        catch { setError('Restore browser storage before retrying this import.'); return; }
      }
      setError(!saved ? 'Nothing was sent. Restore browser storage before importing.' : (failure as { response?: { data?: { error?: string } } }).response?.data?.error || 'Result unconfirmed. Retry the saved import; it will be applied only once.');
    } finally { inFlight.current = false; if (generation === sessionGeneration()) setBusy(false); }
  };
  return { preview, result, pending, busy, error, review, commit, resetPreview: () => setPreview(null) };
}
