import { useEffect, useRef, useState } from 'react';
import { ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/LoadingState';
import { deliveryInvoiceService } from '@/services/api';
import { cn } from '@/lib/utils';

/**
 * The kept photos (or PDF) of a delivery invoice. Photos need the sign-in, so
 * each is fetched once and shown from memory; the page buttons switch photos and
 * Zoom doubles the size to read small print.
 */
export function InvoicePhotoViewer({ invoiceId, pages, page, onPage, className }: {
  invoiceId: string;
  pages: { pageNumber: number; mimeType: string }[];
  /** The photo shown; the viewer keeps its own when not given. */
  page?: number;
  onPage?: (page: number) => void;
  className?: string;
}) {
  const [own, setOwn] = useState(pages[0]?.pageNumber ?? 1);
  const current = page ?? own;
  const choose = (next: number) => { setOwn(next); onPage?.(next); };
  const [urls, setUrls] = useState<Record<number, string>>({});
  const [failed, setFailed] = useState<Record<number, boolean>>({});
  const [zoomed, setZoomed] = useState(false);
  const urlsRef = useRef(urls);
  urlsRef.current = urls;
  const [attempt, setAttempt] = useState(0);

  useEffect(() => () => { for (const url of Object.values(urlsRef.current)) URL.revokeObjectURL(url); }, []);
  useEffect(() => {
    if (urlsRef.current[current] || !pages.some(entry => entry.pageNumber === current)) return;
    const controller = new AbortController();
    setFailed(state => ({ ...state, [current]: false }));
    deliveryInvoiceService.page(invoiceId, current, controller.signal)
      .then(response => setUrls(state => ({ ...state, [current]: URL.createObjectURL(response.data) })))
      .catch(() => { if (!controller.signal.aborted) setFailed(state => ({ ...state, [current]: true })); });
    return () => controller.abort();
  }, [invoiceId, current, pages, attempt]);

  const shown = pages.find(entry => entry.pageNumber === current);
  const url = urls[current];
  const pdf = shown?.mimeType === 'application/pdf';
  if (!pages.length) return <p className={cn('text-sm text-muted-foreground', className)}>The photos of this invoice were deleted.</p>;
  return <figure className={cn('invoice-photos space-y-2', className)} aria-label="Invoice photos">
    <div className="flex flex-wrap items-center justify-between gap-2">
      {pages.length > 1 ? <div className="flex flex-wrap gap-1" role="group" aria-label="Photos">
        {pages.map(entry => <Button key={entry.pageNumber} type="button" variant={entry.pageNumber === current ? 'outline' : 'ghost'}
          aria-pressed={entry.pageNumber === current} onClick={() => choose(entry.pageNumber)}>Photo {entry.pageNumber}</Button>)}
      </div> : <span className="text-sm text-muted-foreground">{pdf ? 'Invoice PDF' : 'Invoice photo'}</span>}
      {!pdf && url && <Button type="button" variant="ghost" onClick={() => setZoomed(value => !value)} aria-pressed={zoomed}>
        {zoomed ? <ZoomOut className="h-4 w-4" aria-hidden="true" /> : <ZoomIn className="h-4 w-4" aria-hidden="true" />}{zoomed ? 'Fit' : 'Zoom'}
      </Button>}
    </div>
    <div className={cn('invoice-photo-frame overflow-auto rounded-md border bg-muted/30', zoomed ? 'max-h-[70vh]' : 'max-h-[70vh] lg:max-h-[calc(100vh-14rem)]')}>
      {failed[current]
        ? <div role="alert" className="flex flex-col items-center gap-2 p-6 text-sm">The photo did not load.<Button type="button" variant="outline" onClick={() => setAttempt(value => value + 1)}>Try again</Button></div>
        : !url ? <div role="status" className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground"><Spinner size="sm" />Loading the photo…</div>
        : pdf ? <div className="space-y-2 p-2">
            <iframe src={url} title="Invoice PDF" className="h-[65vh] w-full rounded bg-background" />
            <a href={url} target="_blank" rel="noreferrer" className="text-sm text-primary underline">Open the PDF</a>
          </div>
        : <img src={url} alt={`Invoice photo ${current}`} className={cn('block max-w-none', zoomed ? 'w-[200%]' : 'w-full')} />}
    </div>
  </figure>;
}
