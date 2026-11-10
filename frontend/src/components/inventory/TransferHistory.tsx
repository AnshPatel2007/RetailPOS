import { formatDateTime } from '@/lib/utils';
import { useEffect, useState } from 'react';
import { inventoryTransferService } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Transfer, TransferReceipt, transferProductName } from '@/types/transfers';

export function TransferHistory({ transfer }: { transfer: Transfer }) {
  const [page, setPage] = useState(1), [pages, setPages] = useState(1);
  const [receipts, setReceipts] = useState<TransferReceipt[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false; setLoading(true); setError(false);
    inventoryTransferService.receipts(transfer.id, page).then(({ data }) => { if (!cancelled) { setReceipts(data.data); setPages(Math.max(1, data.pagination.totalPages)); } })
      .catch(() => { if (!cancelled) setError(true); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [transfer.id, transfer.updatedAt, page, retry]);
  return <section className="border-t pt-4 space-y-2" aria-label="Transfer history">
    <h4 className="font-medium">Delivery and return history</h4>
    {!transfer.receivingHistoryKnown && <p className="text-sm text-muted-foreground">This shipment predates detailed receiving records. Earlier events and product snapshots are unavailable.</p>}
    {loading ? <p role="status">Loading history…</p> : error ? <p role="alert">Could not load history. <Button variant="outline" onClick={() => setRetry(n => n + 1)}>Retry history</Button></p> : <>
      {!receipts.length && <p className="text-sm text-muted-foreground">No delivery or return events recorded yet.</p>}
      {receipts.map(receipt => <div key={receipt.id} className="rounded border p-3 text-sm space-y-1">
        <p className="font-medium">{receipt.kind === 'RECEIVE' ? 'Destination delivery' : receipt.kind === 'SOURCE_RETURN' ? 'Return at source' : 'Return requested'} · {formatDateTime(receipt.createdAt)}</p>
        {receipt.actor && <p className="text-xs text-muted-foreground">Recorded by {receipt.actor}</p>}
        {receipt.items.map(line => { const item = transfer.items.find(item => item.id === line.transferItemId); return <p key={line.transferItemId}>{item ? transferProductName(item) : 'Item'}: {line.acceptedQty} accepted, {line.damagedQty} damaged, {line.missingQty} missing{line.sentBackQty ? `, ${line.sentBackQty} sent back` : ''}</p>; })}
        {receipt.notes && <p className="text-muted-foreground">{receipt.notes}</p>}
      </div>)}
      {pages > 1 && <div className="flex items-center justify-between"><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(n => n - 1)}>Newer events</Button><span className="text-xs">Page {page} of {pages}</span><Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(n => n + 1)}>Older events</Button></div>}
    </>}
  </section>;
}
