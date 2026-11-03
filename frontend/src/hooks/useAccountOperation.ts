import { useEffect, useRef, useState } from 'react';
import { api } from '@/services/api';
import { cashOperationRejected } from '@/services/pendingCashOperation';
import { sessionGeneration } from '@/services/sessionGeneration';
import { useAuthStore } from '@/store/authStore';
import toast from 'react-hot-toast';

export interface AccountReceipt {
  id: string;
  kind: 'GIFT_ISSUE' | 'GIFT_RELOAD' | 'HOUSE_PAYMENT' | 'STORE_CREDIT';
  paymentMethod: string;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  reference: string | null;
  reason: string | null;
  createdAt: string;
}
interface PendingAccountOperation {
  path: string;
  label: string;
  payload: Record<string, unknown> & { amount: number; idempotencyKey: string };
}

// Save before sending. A dropped response must replay the exact operation even
// after a reload, drawer closure, or a later change to the account balance.
export function useAccountOperation(kind: 'gift' | 'house' | 'credit', onSuccess: () => void) {
  const user = useAuthStore(state => state.user);
  const key = `pos-pending-account-${kind}:${user?.locationId || ''}:${user?.id || ''}`;
  const [pending, setPending] = useState<PendingAccountOperation | null>(null);
  const [storageError, setStorageError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<{ record: AccountReceipt; label: string } | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const successRef = useRef(onSuccess);
  successRef.current = onSuccess;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    setReceipt(null);
    try { setPending(JSON.parse(localStorage.getItem(key) || 'null')); setStorageError(false); }
    catch { setStorageError(true); }
  }, [key]);

  const execute = async (operation?: Omit<PendingAccountOperation, 'payload'> & { payload: Record<string, unknown> & { amount: number } }) => {
    if (inFlight.current || storageError || !user) return;
    inFlight.current = true; setBusy(true);
    const generation = sessionGeneration();
    let saved: PendingAccountOperation | null = null;
    let recoverySaved = false;
    try {
      saved = JSON.parse(localStorage.getItem(key) || 'null');
      if (operation && saved) { toast.error('Retry the saved operation before starting another.'); return; }
      if (operation) saved = { ...operation, payload: { ...operation.payload, idempotencyKey: crypto.randomUUID() } };
      if (!saved) return;
      // Never send if durable local storage is unavailable.
      localStorage.setItem(key, JSON.stringify(saved));
      recoverySaved = true;
      setPending(saved);
      const response = await api.post(saved.path, saved.payload);
      localStorage.removeItem(key);
      if (!mounted.current || generation !== sessionGeneration()) return;
      setPending(null);
      setReceipt({ record: response.data.receipt, label: response.data.data?.code || saved.label });
      successRef.current();
      toast.success(response.data.replayed ? 'Original receipt recovered. Recorded once.' : 'Account transaction recorded');
      return 'saved';
    } catch (error) {
      if (!mounted.current || generation !== sessionGeneration()) return;
      if (!recoverySaved) {
        setStorageError(true);
        toast.error('Nothing was sent: browser storage is unavailable. Keep any terminal approval reference and restore storage before continuing.');
        return 'rejected';
      }
      const rejected = cashOperationRejected(error);
      if (rejected) {
        try { localStorage.removeItem(key); setPending(null); }
        catch { setStorageError(true); }
      }
      const message = (error as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(message || (saved ? 'Result unconfirmed. Retry the saved operation; do not collect payment again.' : 'Unable to save this operation. Check browser storage before continuing.'));
      return rejected ? 'rejected' : 'unconfirmed';
    } finally {
      inFlight.current = false;
      if (mounted.current && generation === sessionGeneration()) setBusy(false);
    }
  };
  return { pending, busy, storageError, receipt, blocked: busy || !!pending || storageError,
    submit: execute, retry: () => execute(), closeReceipt: () => setReceipt(null),
    showReceipt: (record: AccountReceipt, label: string) => setReceipt({ record, label }),
  };
}
