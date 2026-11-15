import toast from 'react-hot-toast';
import { FileText } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table';
import { useConfirm } from '@/components/ui/useConfirm';
import { RowActions } from '@/components/common/RowActions';
import { useScopedQuery } from '@/hooks/useScopedQuery';
import { deliveryInvoiceService } from '@/services/api';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import type { InvoiceSummary } from '@/types/deliveryInvoices';

const status = (invoice: InvoiceSummary) => invoice.status === 'FAILED' ? <Badge variant="destructive">Could not be read</Badge>
  : invoice.status === 'READING' ? <Badge variant="secondary">Being read</Badge>
  : invoice.counts && invoice.counts.waiting > 0 ? <Badge variant="warning">{invoice.counts.waiting} to check</Badge>
  : <Badge variant="success">Ready for your OK</Badge>;

/**
 * Invoices someone photographed that wait for an owner's or manager's OK
 * (the Alerts bell opens the oldest). Oldest first.
 */
export function WaitingInvoices({ onOpen }: { onOpen: (id: string) => void }) {
  const [confirm, confirmDialog] = useConfirm();
  const query = useScopedQuery<InvoiceSummary[]>(['delivery-invoices', 'open'], async signal => (await deliveryInvoiceService.list({ status: 'open' }, signal)).data.data,
    true, 0, { refreshInterval: 30000 });
  const invoices = query.data || [];
  if (!invoices.length) return null;

  const discard = async (invoice: InvoiceSummary) => {
    if (!await confirm({ title: 'Discard this invoice?', message: 'Its photos are deleted and nothing is received.', confirmLabel: 'Discard invoice', destructive: true })) return;
    try { await deliveryInvoiceService.discard(invoice.id); toast.success('Invoice discarded'); query.refresh(); }
    catch (failure) { toast.error((failure as { response?: { data?: { error?: string } } }).response?.data?.error || 'The invoice was not discarded.'); }
  };

  return <section aria-labelledby="waiting-invoices" className="space-y-2">
    {confirmDialog}
    <h2 id="waiting-invoices" className="flex items-center gap-2 text-base font-semibold"><FileText className="h-4 w-4" aria-hidden="true" />Waiting for your OK ({invoices.length})</h2>
    <div className="rounded-lg border bg-card">
      <Table scrollLabel="Invoices waiting for your OK">
        <TableHeader>
          <TableRow>
            <TableHead>Supplier</TableHead>
            <TableHead>Sent</TableHead>
            <TableHead numeric>Total</TableHead>
            <TableHead>Status</TableHead>
            <TableHead><span className="sr-only">Actions</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invoices.map(invoice => {
            const name = invoice.supplier?.name || invoice.vendorName || 'Invoice';
            return <TableRow key={invoice.id}>
              <TableCell>
                <p className="font-medium">{name}</p>
                <p className="text-xs text-muted-foreground">{[invoice.invoiceNumber && `Invoice ${invoice.invoiceNumber}`, `${invoice.lineCount} ${invoice.lineCount === 1 ? 'line' : 'lines'}`].filter(Boolean).join(' · ')}</p>
              </TableCell>
              <TableCell>
                <p>{formatDateTime(invoice.createdAt)}</p>
                <p className="text-xs text-muted-foreground">by {invoice.createdBy?.name || 'someone'}</p>
              </TableCell>
              <TableCell numeric>{invoice.total === null || invoice.total === undefined ? '—' : formatCurrency(invoice.total)}</TableCell>
              <TableCell>{status(invoice)}</TableCell>
              <TableCell className="text-right">
                <RowActions name={name} primary={{ label: invoice.status === 'FAILED' ? 'Open' : 'Check', onAction: () => onOpen(invoice.id), disabled: invoice.status === 'READING' }}
                  items={[{ id: 'discard', label: 'Discard invoice', destructive: true, onAction: () => void discard(invoice) }]} />
              </TableCell>
            </TableRow>;
          })}
        </TableBody>
      </Table>
    </div>
    {query.error && <p role="alert" className="text-sm text-destructive">The waiting invoices did not load. <Button type="button" variant="ghost" onClick={query.refresh}>Try again</Button></p>}
  </section>;
}
