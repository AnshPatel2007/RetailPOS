import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Camera, CheckCircle2, FileText, ImagePlus, X } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { DialogActions } from '@/components/ui/DialogActions';
import { Alert } from '@/components/ui/Alert';
import { Button, buttonClassName } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/LoadingState';
import { deliveryInvoiceService } from '@/services/api';
import { useAuthStore } from '@/store/authStore';
import { can } from '@/lib/capabilities';
import { PhotoError, prepareInvoicePage } from '@/lib/imageCompress';
import type { InvoiceDetail, InvoiceSummary } from '@/types/deliveryInvoices';
import { invoiceCountsLine } from './invoiceText';

const MAX_PAGES = 5;
type Page = { key: string; blob: Blob; name: string; url: string | null; pdf: boolean };
type Step = 'capture' | 'sending' | 'done';
const errorText = (failure: unknown, fallback: string) => (failure as { response?: { data?: { error?: string } } }).response?.data?.error || fallback;

/**
 * Photograph a supplier's invoice (each page, or its PDF) and send it to be
 * read. Anyone working in the store may: a cashier's invoice waits for an owner
 * or manager, who is told by the Alerts bell. Owners and managers can go
 * straight to checking it (`onReady`).
 */
export function InvoiceCapture({ isOpen, onClose, onReady }: { isOpen: boolean; onClose: () => void; onReady?: (invoice: InvoiceDetail) => void }) {
  const role = useAuthStore(state => state.user?.role);
  const manages = can(role, 'inventory.manage');
  const [pages, setPages] = useState<Page[]>([]);
  const [step, setStep] = useState<Step>('capture');
  const [error, setError] = useState('');
  const [result, setResult] = useState<InvoiceSummary | InvoiceDetail | null>(null);
  const camera = useRef<HTMLInputElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const open = useRef(isOpen);
  open.current = isOpen;
  const pagesRef = useRef(pages);
  pagesRef.current = pages;

  // Thumbnails are object URLs: free them when pages go away.
  useEffect(() => () => { for (const page of pagesRef.current) if (page.url) URL.revokeObjectURL(page.url); }, []);
  const reset = () => {
    for (const page of pagesRef.current) if (page.url) URL.revokeObjectURL(page.url);
    setPages([]); setStep('capture'); setError(''); setResult(null);
  };
  // Closing while it is being read lets the read finish on the server; this dialog starts fresh next time.
  const close = () => { if (step !== 'sending') reset(); onClose(); };

  const add = async (list: FileList | null) => {
    if (!list?.length) return;
    setError('');
    const chosen = Array.from(list);
    const hasPdf = chosen.some(file => file.type === 'application/pdf' || /\.pdf$/i.test(file.name));
    if (hasPdf && (chosen.length > 1 || pagesRef.current.length)) { setError('Send a PDF on its own: it already holds every page.'); return; }
    if (pagesRef.current.some(page => page.pdf)) { setError('This invoice is a PDF. Remove it to send photos instead.'); return; }
    const room = MAX_PAGES - pagesRef.current.length;
    if (chosen.length > room) setError(`Up to ${MAX_PAGES} photos at a time. Send the rest as another invoice.`);
    for (const file of chosen.slice(0, Math.max(0, room))) {
      try {
        const prepared = await prepareInvoicePage(file);
        const pdf = prepared.blob.type === 'application/pdf' || /\.pdf$/i.test(prepared.name);
        setPages(current => [...current, { key: crypto.randomUUID(), ...prepared, pdf, url: pdf ? null : URL.createObjectURL(prepared.blob) }]);
      } catch (failure) {
        setError(failure instanceof PhotoError ? failure.message : 'This photo could not be added. Try again.');
      }
    }
  };
  const remove = (key: string) => setPages(current => current.filter(page => {
    if (page.key === key && page.url) URL.revokeObjectURL(page.url);
    return page.key !== key;
  }));

  const send = async () => {
    if (!pages.length) return;
    setStep('sending'); setError('');
    try {
      const sent = (await deliveryInvoiceService.send(pages.map(page => ({ blob: page.blob, name: page.name })))).data.data;
      if (!open.current) { reset(); return; }
      if (sent.status === 'READY' && onReady && 'lines' in sent) { reset(); onReady(sent); return; }
      setResult(sent); setStep('done');
    } catch (failure) {
      if (!open.current) { reset(); return; }
      setError(errorText(failure, 'The invoice was not sent. Check the connection and send it again.'));
      setStep('capture');
    }
  };

  const retake = async () => {
    if (result) await deliveryInvoiceService.discard(result.id).catch(() => undefined);
    reset();
  };
  const readAgain = async () => {
    if (!result) return;
    setStep('sending'); setError('');
    try {
      const read = (await deliveryInvoiceService.readAgain(result.id)).data.data;
      if (!open.current) { reset(); return; }
      if (read.status === 'READY' && onReady && 'lines' in read) { reset(); onReady(read); return; }
      setResult(read); setStep('done');
    } catch (failure) {
      if (!open.current) { reset(); return; }
      setError(errorText(failure, 'The invoice was not read again. Try once more.'));
      setStep('done');
    }
  };

  const failed = step === 'done' && result?.status === 'FAILED';
  const footer = step === 'capture'
    ? <DialogActions onCancel={close} confirmLabel={pages.length > 1 ? `Send ${pages.length} photos` : 'Send'} onConfirm={() => void send()} disabled={!pages.length} />
    : failed ? <DialogActions onCancel={close} cancelLabel="Not now" confirmLabel="Read again" onConfirm={() => void readAgain()}>
        <Button type="button" variant="outline" onClick={() => void retake()}>Retake photos</Button>
      </DialogActions>
    : undefined;

  return <Modal isOpen={isOpen} onClose={close} title="Delivery invoice" size="md" footer={footer}
    description={step === 'capture' ? 'Photograph each page, flat and in good light, with the whole page in view.' : undefined}>
    {step === 'capture' && <div className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}
      {pages.length > 0 && <ol className="grid grid-cols-3 gap-2" aria-label="Pages to send">
        {pages.map((page, index) => <li key={page.key} className="relative">
          {page.pdf
            ? <div className="flex aspect-[3/4] flex-col items-center justify-center gap-1 rounded-md border bg-muted/40 p-2 text-center text-xs">
                <FileText className="h-6 w-6 text-muted-foreground" aria-hidden="true" /><span className="break-all">{page.name}</span></div>
            : <img src={page.url!} alt={`Page ${index + 1}`} className="aspect-[3/4] w-full rounded-md border object-cover" />}
          <span className="mt-1 block text-center text-xs text-muted-foreground">{page.pdf ? 'PDF' : `Page ${index + 1}`}</span>
          <Button type="button" variant="ghost" size="icon" aria-label={`Remove page ${index + 1}`} onClick={() => remove(page.key)}
            className="absolute right-1 top-1 h-8 w-8 bg-background/90"><X className="h-4 w-4" aria-hidden="true" /></Button>
        </li>)}
      </ol>}
      <div className="grid gap-2 sm:grid-cols-2">
        <Button type="button" variant="outline" className="h-12" disabled={pages.length >= MAX_PAGES || pages.some(page => page.pdf)} onClick={() => camera.current?.click()}>
          <Camera aria-hidden="true" />{pages.length ? 'Photograph the next page' : 'Take a photo'}
        </Button>
        <Button type="button" variant="outline" className="h-12" disabled={pages.length >= MAX_PAGES || pages.some(page => page.pdf)} onClick={() => files.current?.click()}>
          <ImagePlus aria-hidden="true" />Choose photos or a PDF
        </Button>
      </div>
      <input ref={camera} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden="true"
        onChange={event => { void add(event.target.files); event.target.value = ''; }} />
      <input ref={files} type="file" accept="image/*,application/pdf" multiple className="sr-only" tabIndex={-1} aria-hidden="true" data-testid="invoice-files"
        onChange={event => { void add(event.target.files); event.target.value = ''; }} />
      <p className="text-xs text-muted-foreground">Up to {MAX_PAGES} photos, or the PDF the supplier sent. Nothing changes in stock until {manages ? 'you check it and press OK' : 'an owner or manager checks it'}.</p>
    </div>}

    {step === 'sending' && <div role="status" className="flex flex-col items-center gap-3 py-8 text-center">
      <Spinner />
      <p className="font-medium">Reading the invoice…</p>
      <p className="max-w-sm text-sm text-muted-foreground">About half a minute a page. {manages ? 'The lines open as soon as it is read.' : 'You can close this: it goes to the owner either way.'}</p>
    </div>}

    {step === 'done' && result && (failed
      ? <div className="space-y-3">
          <Alert tone="error" title="The invoice could not be read">{result.error || 'Try again.'}</Alert>
          {error && <Alert tone="error">{error}</Alert>}
          <p className="text-sm text-muted-foreground">Read it again, or retake the photos. It also waits under the owner&apos;s Alerts.</p>
        </div>
      : <div role="status" className="flex flex-col items-center gap-2 py-6 text-center">
          <CheckCircle2 className="h-10 w-10 text-success" aria-hidden="true" />
          <p className="text-lg font-semibold">{manages ? 'Invoice read' : 'Sent to the owner'}</p>
          <p className="text-sm text-muted-foreground">
            {[result.vendorName, result.invoiceNumber && `Invoice ${result.invoiceNumber}`, `${result.lineCount} ${result.lineCount === 1 ? 'line' : 'lines'}`].filter(Boolean).join(' · ')}
          </p>
          {'counts' in result && result.counts && <p className="text-sm">{invoiceCountsLine(result.counts)}</p>}
          <p className="max-w-sm text-sm text-muted-foreground">{manages ? 'It waits under Purchasing > Receive Delivery until you press OK.' : 'Stock changes once an owner or manager checks it and presses OK.'}</p>
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            {manages && <Link to={`/inventory/purchasing/receive?invoice=${encodeURIComponent(result.id)}`} onClick={close} className={buttonClassName({ variant: 'outline' })}>Check it now</Link>}
            <Button type="button" variant="ghost" onClick={reset}>Send another invoice</Button>
          </div>
        </div>)}
  </Modal>;
}
