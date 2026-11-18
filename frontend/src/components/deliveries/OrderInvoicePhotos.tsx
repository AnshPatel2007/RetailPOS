import { useState } from 'react';
import { useScopedQuery } from '@/hooks/useScopedQuery';
import { deliveryInvoiceService } from '@/services/api';
import { formatDateTime } from '@/lib/utils';
import type { InvoiceDetail, InvoiceSummary } from '@/types/deliveryInvoices';
import { InvoicePhotoViewer } from './InvoicePhotoViewer';

/** On an order received from a photo of its invoice: the kept photos, opened on request. */
export function OrderInvoicePhotos({ purchaseOrderId }: { purchaseOrderId: string }) {
  const [open, setOpen] = useState(false);
  const list = useScopedQuery<InvoiceSummary[]>(['order-invoice', purchaseOrderId], async signal =>
    (await deliveryInvoiceService.list({ purchaseOrderId }, signal)).data.data, true, 60000, { autoRefresh: false });
  const invoice = list.data?.find(row => row.status === 'RECEIVED' && row.pageCount > 0);
  const detail = useScopedQuery<InvoiceDetail>(['order-invoice-detail', invoice?.id], async signal =>
    (await deliveryInvoiceService.get(invoice!.id, signal)).data.data, open && !!invoice, 60000, { autoRefresh: false });
  if (!invoice) return null;
  return <div className="border-t pt-4">
    <details onToggle={event => setOpen((event.currentTarget as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer font-medium">Invoice {invoice.pageCount > 1 ? `photos (${invoice.pageCount})` : 'photo'}</summary>
      <p className="mt-1 text-xs text-muted-foreground">Received from a photo of the invoice{invoice.createdBy ? ` sent by ${invoice.createdBy.name}` : ''}, {formatDateTime(invoice.createdAt)}.</p>
      {open && (detail.data ? <InvoicePhotoViewer className="mt-3" invoiceId={invoice.id} pages={detail.data.pages} />
        : detail.error ? <p role="alert" className="mt-3 text-sm text-destructive">The photos did not load.</p>
        : <p role="status" className="mt-3 text-sm text-muted-foreground">Loading the photos…</p>)}
    </details>
  </div>;
}
