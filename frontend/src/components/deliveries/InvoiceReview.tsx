import { type ComponentProps, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Image as ImageIcon } from 'lucide-react';
import toast from 'react-hot-toast';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { LoadingState, Spinner } from '@/components/ui/LoadingState';
import { useConfirm } from '@/components/ui/useConfirm';
import { SummaryStrip } from '@/components/common/Workspace';
import { SupplierPicker } from '@/components/common/SupplierPicker';
import { deliveryInvoiceService } from '@/services/api';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils';
import type { InvoiceDetail, InvoiceLine, InvoiceLinePatch, InvoicePatch } from '@/types/deliveryInvoices';
import { InvoiceLineCard } from './InvoiceLineCard';
import { InvoicePhotoViewer } from './InvoicePhotoViewer';
import { ItemPickerPanel, NewItemPanel } from './InvoiceLinePanels';
import { lineProblem, reviewOrder } from './invoiceText';
import { scrollPageToTop } from './pageScroll';

const errorText = (failure: unknown, fallback: string) => (failure as { response?: { data?: { error?: string } } }).response?.data?.error || fallback;
const statusOf = (failure: unknown) => (failure as { response?: { status?: number } }).response?.status;
const plural = (count: number, one: string, many = one + 's') => `${count} ${count === 1 ? one : many}`;
const moneyOrBlank = (value: number | null) => value === null ? '' : value.toFixed(2);

/**
 * Checking a delivery invoice before it reaches stock: the photos beside the
 * lines, the lines that need a person first, and one OK that receives
 * everything through the reviewed receipt import. Every decision is saved as it
 * is made (with the invoice's version), so two people never overwrite each other.
 */
export function InvoiceReview({ invoiceId, locationId, onBack }: { invoiceId: string; locationId: string; onBack: () => void }) {
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [photo, setPhoto] = useState(1);
  const [showPhotos, setShowPhotos] = useState(false);
  const [picking, setPicking] = useState<InvoiceLine | null>(null);
  const [adding, setAdding] = useState<InvoiceLine | null>(null);
  const [changingSupplier, setChangingSupplier] = useState(false);
  const [received, setReceived] = useState<{ units: number; lines: number; costsUp: number } | null>(null);
  const [confirm, confirmDialog] = useConfirm();
  const latest = useRef<InvoiceDetail | null>(null);
  latest.current = invoice;

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const next = (await deliveryInvoiceService.get(invoiceId, signal)).data.data;
      setInvoice(next); setLoadError('');
    } catch (failure) {
      if (signal?.aborted) return;
      setLoadError(statusOf(failure) === 404 ? 'This invoice is not in this store, or it was removed.' : errorText(failure, 'The invoice did not load.'));
    }
  }, [invoiceId]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  // While it is being read, look again every few seconds.
  useEffect(() => {
    if (invoice?.status !== 'READING') return;
    const timer = window.setTimeout(() => void load(), 4000);
    return () => window.clearTimeout(timer);
  }, [invoice, load]);

  const save = async (patch: Omit<InvoicePatch, 'version'>) => {
    const current = latest.current;
    if (!current) return false;
    setSaving(true); setError('');
    try {
      setInvoice((await deliveryInvoiceService.update(current.id, { ...patch, version: current.version })).data.data);
      return true;
    } catch (failure) {
      setError(errorText(failure, 'That change was not saved. Try again.'));
      if (statusOf(failure) === 409) await load();
      return false;
    } finally { setSaving(false); }
  };
  const saveLine = (line: InvoiceLine) => (patch: Omit<InvoiceLinePatch, 'index'>) => save({ lines: [{ index: line.index, ...patch }] });

  const ordered = useMemo(() => invoice ? reviewOrder(invoice.lines) : [], [invoice]);
  const waiting = invoice ? invoice.lines.filter(line => lineProblem(line)) : [];

  const receive = async () => {
    const current = latest.current;
    if (!current) return;
    setSaving(true); setError('');
    const costsUp = current.lines.filter(line => !line.skip && line.costChange !== null && line.costChange >= current.costAlertPercent).length;
    try {
      const done = (await deliveryInvoiceService.receive(current.id, current.version)).data.data;
      setInvoice(done);
      setReceived({ units: current.counts.units, lines: current.lines.filter(line => !line.skip).length, costsUp });
      scrollPageToTop();
      toast.success(`Received ${plural(current.counts.units, 'unit')}`);
    } catch (failure) {
      setError(errorText(failure, 'The delivery was not received. Nothing changed; try again.'));
      if (statusOf(failure) === 409) await load();
    } finally { setSaving(false); }
  };

  const discard = async () => {
    const current = latest.current;
    if (!current || !await confirm({ title: 'Discard this invoice?', message: 'Its photos are deleted and nothing is received. You can send the invoice again later.', confirmLabel: 'Discard invoice', destructive: true })) return;
    setSaving(true);
    try {
      await deliveryInvoiceService.discard(current.id);
      toast.success('Invoice discarded');
      onBack();
    } catch (failure) {
      setError(errorText(failure, 'The invoice was not discarded. Try again.'));
    } finally { setSaving(false); }
  };

  const readAgain = async () => {
    const current = latest.current;
    if (!current) return;
    setSaving(true); setError('');
    try {
      setInvoice({ ...current, status: 'READING' });
      setInvoice((await deliveryInvoiceService.readAgain(current.id)).data.data as InvoiceDetail);
    } catch (failure) {
      setError(errorText(failure, 'The invoice was not read again. Try once more.'));
      await load();
    } finally { setSaving(false); }
  };

  const back = <Button type="button" variant="ghost" onClick={onBack}><ArrowLeft aria-hidden="true" />All deliveries</Button>;
  if (loadError) return <div className="space-y-3">{back}<Alert tone="error">{loadError}</Alert></div>;
  if (!invoice) return <LoadingState label="Loading the invoice…" />;

  const vendor = invoice.supplier?.name || invoice.vendorName || 'Unknown supplier';
  const photos = <InvoicePhotoViewer invoiceId={invoice.id} pages={invoice.pages} page={photo} onPage={setPhoto} />;
  const showPhoto = (page: number) => { setPhoto(page); setShowPhotos(true); };

  if (invoice.status !== 'READY') return <div className="space-y-4">
    {confirmDialog}
    {back}
    {invoice.status === 'READING' ? <div role="status" className="flex flex-col items-center gap-3 rounded-lg border bg-card py-10 text-center">
        <Spinner /><p className="font-medium">Reading the invoice…</p><p className="text-sm text-muted-foreground">About half a minute a page.</p></div>
      : invoice.status === 'FAILED' ? <Alert tone="error" title="This invoice could not be read"
          action={<div className="flex flex-wrap gap-2"><Button type="button" variant="ghost" disabled={saving} onClick={() => void discard()}>Discard</Button>
            <Button type="button" variant="primary" loading={saving} onClick={() => void readAgain()}>Read again</Button></div>}>
          {invoice.error || 'Try again, or send new photos.'}</Alert>
      : invoice.status === 'RECEIVED' ? <section aria-label="Received" className="space-y-3 rounded-lg border bg-card p-4">
          <p className="flex items-center gap-2 text-lg font-semibold"><CheckCircle2 className="h-6 w-6 text-success" aria-hidden="true" />Delivery received</p>
          <p className="text-sm">{vendor}{invoice.invoiceNumber ? ` · Invoice ${invoice.invoiceNumber}` : ''}
            {received ? ` · ${plural(received.lines, 'line')}, ${plural(received.units, 'unit')} added to stock.` : ''}</p>
          <p className="text-sm text-muted-foreground">Received {invoice.receivedAt ? formatDateTime(invoice.receivedAt) : ''}{invoice.receivedBy ? ` by ${invoice.receivedBy.name}` : ''}. Costs are updated, and these lines will be matched for sure next time.</p>
          {received && received.costsUp > 0 && <Alert tone="warning" title={`Costs went up on ${plural(received.costsUp, 'item')}`}
            action={<Link className="text-sm font-medium text-primary underline" to="/inventory/purchasing/price-review">Check prices</Link>}>
            Their prices may now be too low for your target margin.</Alert>}
          <div className="flex flex-wrap gap-2"><Button type="button" variant="primary" onClick={onBack}>Done</Button></div>
        </section>
      : <Alert tone="info">This invoice was discarded.</Alert>}
    {invoice.pages.length > 0 && invoice.status !== 'READING' && <div className="max-w-2xl">{photos}</div>}
  </div>;

  return <section aria-label={`Invoice from ${vendor}`} className="space-y-4">
    {confirmDialog}
    <div className="flex flex-wrap items-center justify-between gap-2">
      {back}
      <Button type="button" variant="outline" className="lg:hidden" onClick={() => setShowPhotos(value => !value)} aria-expanded={showPhotos}>
        <ImageIcon aria-hidden="true" />{showPhotos ? 'Hide the photos' : `Show the ${invoice.pages.length > 1 ? 'photos' : 'photo'}`}</Button>
    </div>
    <div className="invoice-review grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <aside className={showPhotos ? 'block' : 'hidden lg:block'} aria-label="Photos">
        <div className="lg:sticky lg:top-20">{photos}</div>
      </aside>
      <div className="min-w-0 space-y-4">
        <section aria-label="Invoice details" className="space-y-3 rounded-lg border bg-card p-4">
          {changingSupplier || !invoice.supplier
            ? <div className="space-y-2">
                {!invoice.supplier && !changingSupplier
                  ? <div className="flex flex-wrap items-center justify-between gap-2">
                      <div><p className="text-xs text-muted-foreground">Supplier</p><p className="font-medium">{invoice.vendorName || 'Not printed on the invoice'}</p>
                        <p className="text-xs text-muted-foreground">{invoice.vendorName ? 'A new supplier: added when you receive this delivery.' : 'Choose the supplier, or it is received as "Unspecified supplier".'}</p></div>
                      <Button type="button" variant="outline" disabled={saving} onClick={() => setChangingSupplier(true)}>It's one of my suppliers</Button>
                    </div>
                  : <><SupplierPicker locationId={locationId} selected={null} onSelect={supplier => { setChangingSupplier(false); void save({ supplierId: supplier.id }); }} />
                      <Button type="button" variant="ghost" onClick={() => setChangingSupplier(false)}>Keep {invoice.supplier?.name || invoice.vendorName || 'it as it is'}</Button></>}
              </div>
            : <div className="flex flex-wrap items-center justify-between gap-2">
                <div><p className="text-xs text-muted-foreground">Supplier</p><p className="font-medium">{invoice.supplier.name}</p>
                  {invoice.vendorName && invoice.vendorName !== invoice.supplier.name && <p className="text-xs text-muted-foreground">Printed as {invoice.vendorName}</p>}</div>
                <Button type="button" variant="outline" disabled={saving} onClick={() => setChangingSupplier(true)}>Change</Button>
              </div>}
          <div className="grid gap-3 sm:grid-cols-3">
            <BlurInput label="Invoice number" value={invoice.invoiceNumber || ''} disabled={saving} onCommit={value => void save({ invoiceNumber: value.trim() || null })} />
            <BlurInput label="Invoice date" type="date" value={invoice.invoiceDate || ''} disabled={saving} onCommit={value => void save({ invoiceDate: value || null })} />
            <BlurInput label="Invoice total" type="number" inputMode="decimal" min="0" step="0.01" value={moneyOrBlank(invoice.total)} disabled={saving}
              onCommit={value => void save({ total: value.trim() ? Number(value) : null })} />
          </div>
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">Charges on the invoice: {formatCurrency(invoice.fees ?? 0)} fees, {formatCurrency(invoice.tax ?? 0)} tax, {formatCurrency(invoice.discount ?? 0)} discount</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <BlurInput label="Fees (delivery, fuel, deposits)" type="number" inputMode="decimal" min="0" step="0.01" value={moneyOrBlank(invoice.fees)} disabled={saving} onCommit={value => void save({ fees: value.trim() ? Number(value) : null })} />
              <BlurInput label="Tax on the invoice" type="number" inputMode="decimal" min="0" step="0.01" value={moneyOrBlank(invoice.tax)} disabled={saving} onCommit={value => void save({ tax: value.trim() ? Number(value) : null })} />
              <BlurInput label="Discount" type="number" inputMode="decimal" min="0" step="0.01" value={moneyOrBlank(invoice.discount)} disabled={saving} onCommit={value => void save({ discount: value.trim() ? Number(value) : null })} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Fees and tax are spread across the items' costs; a discount lowers them.</p>
          </details>
          <p className="text-xs text-muted-foreground">Sent by {invoice.createdBy?.name || 'someone'} {formatDateTime(invoice.createdAt)}{invoice.pageCount > 1 ? ` · ${invoice.pageCount} photos` : ''}</p>
        </section>

        {invoice.warnings.map(warning => <Alert key={warning.code} tone="warning" title={warning.message}>
          {warning.code === 'TOTALS_DIFFER' && warning.amount !== undefined ? `The lines, fees and tax come to ${formatCurrency(Math.abs(warning.amount))} ${warning.amount > 0 ? 'less' : 'more'} than the total. Check the quantities and amounts against the photo.`
            : warning.code === 'ALREADY_RECEIVED' ? `Received ${warning.date ? formatDate(warning.date) : 'before'}. Receiving it again is refused; discard this copy if it is the same delivery.`
            : `Sent ${warning.date ? formatDateTime(warning.date) : 'earlier'}. Check one of them and discard the other.`}
        </Alert>)}
        {invoice.notes.length > 0 && <Alert tone="info" title="About the photos">{invoice.notes.join(' ')}</Alert>}

        <SummaryStrip items={[
          { label: 'Lines', value: invoice.counts.lines, detail: invoice.counts.skipped ? `${invoice.counts.skipped} skipped` : undefined },
          { label: 'Units', value: invoice.counts.units },
          { label: 'Cost', value: invoice.counts.cost === null ? '—' : formatCurrency(invoice.counts.cost), detail: 'before fees and tax' },
          { label: 'Need you', value: waiting.length, tone: waiting.length ? 'warning' : 'success', detail: waiting.length ? 'lines to check' : 'everything is checked' },
        ]} />

        {error && <Alert tone="error">{error}</Alert>}
        <ol className="space-y-3" aria-label="Invoice lines">
          {ordered.map(line => <InvoiceLineCard key={line.index} line={line} alertPercent={invoice.costAlertPercent} disabled={saving} photoCount={invoice.pages.length}
            onSave={saveLine(line)} onPick={() => setPicking(line)} onAddNew={() => setAdding(line)} onShowPhoto={showPhoto} />)}
        </ol>

        <div className="sticky bottom-0 z-10 space-y-2 rounded-lg border bg-background/95 p-3 shadow-sm backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">
              <p className="font-medium">{plural(invoice.counts.units, 'unit')} from {vendor}</p>
              <p className="text-muted-foreground" id="receive-hint">{waiting.length ? `${plural(waiting.length, 'line needs', 'lines need')} you first` : 'Everything is checked. Stock changes when you press Receive.'}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="ghost" disabled={saving} onClick={() => void discard()}>Discard</Button>
              <Button type="button" variant="primary" loading={saving} disabled={waiting.length > 0 || invoice.counts.units === 0} aria-describedby="receive-hint" onClick={() => void receive()}>
                Receive {plural(invoice.counts.units, 'unit')}</Button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <ItemPickerPanel line={picking} locationId={locationId} onClose={() => setPicking(null)}
      onAddNew={() => { const line = picking; setPicking(null); setAdding(line); }}
      onPick={product => { const line = picking; setPicking(null); if (line) void save({ lines: [{ index: line.index, product }] }); }} />
    <NewItemPanel line={adding} categories={invoice.categories} onClose={() => setAdding(null)}
      onSave={item => adding ? save({ lines: [{ index: adding.index, newItem: item }] }) : Promise.resolve(false)} />
  </section>;
}

/** A field saved when the person leaves it (and only if it changed). */
function BlurInput({ value, onCommit, ...props }: Omit<ComponentProps<typeof Input>, 'value' | 'onChange'> & { value: string; onCommit: (value: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return <Input {...props} value={text} onChange={event => setText(event.target.value)} onBlur={() => { if (text !== value) onCommit(text); }}
    onKeyDown={event => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur(); }} />;
}
