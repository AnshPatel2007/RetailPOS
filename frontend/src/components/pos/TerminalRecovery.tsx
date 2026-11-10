import { useState } from 'react';
import { TerminalCheckout, db } from '@/services/offlineDb';
import { saleService } from '@/services/api';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';
import { finishPaymentSession } from '@/services/paymentSession';

export function TerminalRecovery({ attempt, persisted, onRecovered }: {
  attempt: TerminalCheckout;
  persisted: boolean;
  onRecovered: (sale: any, attempt: TerminalCheckout) => void;
}) {
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [durable, setDurable] = useState(persisted);
  const retry = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      await db.transaction('rw',db.terminalCheckouts,async()=>{
        const current=await db.terminalCheckouts.get(attempt.key);
        if(current?.reconciliation?.status==='FINAL')throw new Error('This payment already has a manager disposition. Review register history before continuing.');
        await db.terminalCheckouts.put(attempt);
      });
      setDurable(true);
      // The original key and payload survive reloads. The server returns an
      // existing sale before considering stock, prices, or the current shift.
      const response = await saleService.create(attempt.payload);
      await db.transaction('rw', db.terminalCheckouts, db.paymentSessions, async () => {
        await db.terminalCheckouts.update(attempt.key,{reconciliation:{receiptId:'sale:'+response.data.data.id,status:'FINAL',disposition:'MATCH_RECORDED',recordedAt:Date.now()}});
        if (attempt.paymentSessionId) await finishPaymentSession(attempt.paymentSessionId, 'sale:' + response.data.data.id);
      });
      const currentUser = useAuthStore.getState().user;
      if (currentUser?.id !== attempt.userId || currentUser.locationId !== attempt.locationId) return;
      onRecovered(response.data.data, attempt);
    } catch (cause: any) {
      setError(cause.response?.data?.error || 'Unable to confirm that the sale was saved. Keep this record and retry when connected.');
    } finally { setBusy(false); }
  };
  return <>
    <div role="alert" className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-500 bg-amber-50 p-3 text-amber-950 dark:bg-amber-950 dark:text-amber-100">
      <span>Card payment requires reconciliation. Do not charge the customer again.</span>
      <Button variant="outline" onClick={() => setOpen(true)}>Review payment</Button>
    </div>
    <Modal isOpen={open} onClose={() => { if (!busy) setOpen(false); }} title="Payment requires reconciliation">
      <div className="space-y-4 p-4">
        <p>The separate terminal payment was submitted to the POS, but saving the sale has not been confirmed. Do not charge the customer again.</p>
        <dl className="space-y-2 break-words text-sm">
          <div><dt className="text-muted-foreground">Sale total</dt><dd>{formatCurrency(attempt.total)}</dd></div>
          <div><dt className="text-muted-foreground">Terminal approval reference</dt><dd>{attempt.references.join(', ')}</dd></div>
          <div><dt className="text-muted-foreground">Recorded on this register</dt><dd>{formatDateTime(attempt.createdAt)}</dd></div>
          <div><dt className="text-muted-foreground">Checkout reference</dt><dd>{attempt.key}</dd></div>
        </dl>
        <p className="text-sm text-muted-foreground">Retry saving uses the original transaction and cannot charge the terminal. If it still fails, ask a manager to compare this reference with the terminal and sales history.</p>
        {durable
          ? <p className="text-sm text-muted-foreground">This record stays on this browser through reloads and logout; return with the same cashier and store. Do not clear browser storage.</p>
          : <p role="alert" className="text-destructive">Browser storage failed. Keep this page open and copy the terminal and checkout references for your manager. This record cannot survive a reload until storage is restored and Retry saving succeeds.</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Button onClick={retry} disabled={busy}>{busy ? 'Checking sale…' : 'Retry saving sale'}</Button>
      </div>
    </Modal>
  </>;
}
