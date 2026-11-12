import { Checkbox } from '@/components/ui/Checkbox';
import { formatDateTime } from '@/lib/utils';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Pagination } from '@/components/common/Pagination';
import { reportService } from '@/services/api';
import toast from 'react-hot-toast';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
import { AutoRefreshStatus } from '@/components/common/AutoRefreshStatus';

type Delivery = { id: string; recipientEmail: string; subject: string; status: 'QUEUED' | 'SENDING' | 'ACCEPTED' | 'FAILED' | 'REVIEW' | 'CANCELLED'; attempts: number; errorCode: string | null; createdAt: string };
const statuses = { QUEUED: 'Queued', SENDING: 'Sending', ACCEPTED: 'Accepted by provider', FAILED: 'Failed', REVIEW: 'Needs delivery review', CANCELLED: 'Cancelled' };
const failure = (code: string | null) => code === 'NOT_CONFIGURED' ? 'Email delivery is not configured.' : code === 'PROVIDER_REJECTED' ? 'The provider rejected this email.' : code === 'DELIVERY_UNKNOWN' ? 'Delivery is uncertain. Check the provider before retrying.' : code === 'RECIPIENT_NO_LONGER_AUTHORIZED' ? 'The recipient no longer has access to this store.' : '';

export function DigestDeliveryControls({ userId, storeId }: { userId: string; storeId: string }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]), [page, setPage] = useState(1), [pages, setPages] = useState(0);
  const [error, setError] = useState(''), [retry, setRetry] = useState<Delivery | null>(null), [reason, setReason] = useState(''), [confirmed, setConfirmed] = useState(false);
  const generation = useRef(0);
  const storageKey = `digest-request:${userId}:${storeId}`;
  const load = async (quiet = false, active: () => boolean = () => true, signal?: AbortSignal) => {
    const current = ++generation.current;
    if (!quiet) { setLoading(true); setError(''); }
    try {
      const result = await reportService.getDigestDeliveries(page, signal);
      if (current === generation.current && active()) { setError(''); setDeliveries(result.data.data); setPages(result.data.pagination.pages); }
    } catch (failure) { if (quiet) throw failure; if (current === generation.current && active()) setError('Delivery history could not be loaded. Try again.'); }
    finally { if (current === generation.current) setLoading(false); }
  };
  const updates = useAutoRefresh(context => load(context.quiet, context.current, context.signal), {
    key: [userId, storeId, page], enabled: open, intervalMs: 10000, paused: !!retry || busy,
  });
  useEffect(() => {
    return () => { generation.current++; };
  }, [open, page]);
  useEffect(() => { setDeliveries([]); setPages(0); setPage(1); setRetry(null); setError(''); }, [userId, storeId]);
  const send = async () => {
    if (busy) return; setBusy(true);
    try {
      const key = localStorage.getItem(storageKey) || crypto.randomUUID(); localStorage.setItem(storageKey, key);
      const result = await reportService.sendDailyDigest(key);
      localStorage.removeItem(storageKey); toast.success(result.data.message); setOpen(true); if (open) await load();
    } catch { toast.error('The brief could not be confirmed. Retry uses the same request to prevent duplicate emails.'); }
    finally { setBusy(false); }
  };
  const submitRetry = async () => {
    if (!retry || busy) return; setBusy(true); setError('');
    try { await reportService.retryDigestDelivery(retry.id, { reason, confirmedNotDelivered: confirmed }); setRetry(null); await load(); }
    catch { setError('Retry was not confirmed. Check the latest delivery status before trying again.'); }
    finally { setBusy(false); }
  };
  return <>
    <Button variant="outline" disabled={busy} onClick={send}>{busy ? 'Working...' : 'Send Morning Brief'}</Button>
    <Button variant="outline" onClick={() => setOpen(true)}>Delivery History</Button>
    <div data-auto-refresh={!retry ? 'allow' : undefined}><Modal isOpen={open} onClose={() => { if (!busy) { setOpen(false); setRetry(null); } }} title="Morning brief deliveries" size="lg">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Each email is stored before sending. Provider acceptance does not confirm arrival in the recipient's inbox.</p>
        {error && <div role="alert" className="text-sm text-destructive"><p>{error}</p>{!retry && <Button variant="outline" onClick={updates.refresh}>Retry</Button>}</div>}
        <AutoRefreshStatus state={updates} />
        {retry ? <div className="space-y-4">
          <p>Retry delivery to {retry.recipientEmail}</p>
          {retry.status === 'REVIEW' && <Checkbox label="I checked the provider's delivery history and confirmed this email was not delivered." checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />}
          <label className="block text-sm">Reason for retry<textarea value={reason} onChange={event => setReason(event.target.value)} maxLength={500} className="block mt-2 w-full rounded-md border border-input bg-background p-3" /></label>
          <div className="flex gap-2"><Button disabled={busy || reason.trim().length < 8 || (retry.status === 'REVIEW' && !confirmed)} onClick={submitRetry}>Queue retry</Button><Button variant="outline" disabled={busy} onClick={() => setRetry(null)}>Back to history</Button></div>
        </div> : <>
          {loading && <p role="status" className="text-sm">Refreshing delivery history...</p>}
          {!loading && !error && deliveries.length === 0 && <p>No morning briefs have been queued for this store.</p>}
          <div className="space-y-3">{deliveries.map(delivery => <div key={delivery.id} className="rounded-md border border-border p-4 space-y-2">
            <div className="flex flex-wrap justify-between gap-2"><p className="font-medium break-all">{delivery.recipientEmail}</p><p className="text-sm">{statuses[delivery.status]}</p></div>
            <p className="text-sm text-muted-foreground">{delivery.subject}</p><p className="text-xs text-muted-foreground">{formatDateTime(delivery.createdAt)} | Attempts: {delivery.attempts}</p>
            {delivery.errorCode && <p className="text-sm">{failure(delivery.errorCode)}</p>}
            {['FAILED', 'REVIEW'].includes(delivery.status) && <Button variant="outline" onClick={() => { setRetry(delivery); setReason(''); setConfirmed(false); }}>Review retry</Button>}
          </div>)}</div>
          <Pagination page={page} totalPages={pages} onPageChange={setPage} />
        </>}
      </div>
    </Modal></div>
  </>;
}
