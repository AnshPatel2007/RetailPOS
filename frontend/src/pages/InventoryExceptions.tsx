import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ClipboardCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import { ManagementPage } from '@/components/common/Workspace';
import { PageHeader } from '@/components/common/PageHeader';
import { PageTabs } from '@/components/common/PageTabs';
import { Pagination } from '@/components/common/Pagination';
import { EmptyState } from '@/components/common/EmptyState';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { inventoryExceptionService } from '@/services/api';
import { useEffectiveLocation } from '@/hooks/useEffectiveLocation';
import { formatDate, formatEnumLabel } from '@/lib/utils';

type Status = 'open' | 'resolved' | 'all';

interface ExceptionRow {
  id: string;
  status: 'OPEN' | 'RECOUNT_REQUESTED' | 'RESOLVED';
  firstNegativeAt: string;
  lastNegativeAt: string;
  lowestQuantity: number;
  currentQuantity: number;
  occurrenceCount: number;
  resolution: string | null;
  product: { id: string; name: string; sku: string; barcode: string | null; brand?: string | null; variant?: string | null; size?: string | null };
}

interface RelatedProduct { id: string; name: string; sku: string; barcode: string | null; variant: string | null; size: string | null; stockQuantity: number; reasons: string[] }
interface LogEntry { createdAt: string; type: string; quantity: number; previousQty: number; newQty: number; notes: string | null }
interface ExceptionDetail extends ExceptionRow {
  summary: string;
  recommendation: string;
  possibleCauses: string[];
  relatedProducts: RelatedProduct[];
  recentSales: { id: string; quantity: number; createdAt: string; sale: { saleNumber: string; user?: { firstName: string; lastName: string } | null } }[];
  lastCount: LogEntry | null;
  lastReceipt: LogEntry | null;
  lastAdjustment: LogEntry | null;
  resolutionNotes: string | null;
  product: ExceptionRow['product'] & { stockVersion: number };
}

const RESOLUTIONS = [
  ['WRONG_SKU_SOLD', 'A similar product was sold under this item'],
  ['MISSING_RECEIPT', 'A delivery was not received in the system'],
  ['TRANSFER_NOT_RECORDED', 'A transfer was not recorded'],
  ['MISCOUNT', 'An earlier count was wrong'],
  ['DAMAGED', 'Damaged goods'],
  ['EXPIRED', 'Expired goods'],
  ['THEFT', 'Theft'],
  ['NO_CHANGE_NEEDED', 'Reviewed, no change needed'],
  ['OTHER', 'Other (describe)'],
] as const;

const statusBadge = (status: ExceptionRow['status']) => status === 'RESOLVED'
  ? <Badge variant="success">Resolved</Badge>
  : status === 'RECOUNT_REQUESTED' ? <Badge variant="warning">Recount requested</Badge> : <Badge variant="destructive">Open</Badge>;

const describeLog = (entry: LogEntry | null) => entry
  ? `${formatDate(entry.createdAt)} · ${formatEnumLabel(entry.type)} · ${entry.quantity > 0 ? '+' : ''}${entry.quantity} (${entry.previousQty} → ${entry.newQty})`
  : 'None recorded';

export const InventoryExceptions: React.FC = () => {
  const { locationId, isReadOnly, isSuperAdmin } = useEffectiveLocation();
  const [status, setStatus] = useState<Status>('open');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<ExceptionRow[]>([]);
  const [pagination, setPagination] = useState({ totalPages: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<ExceptionDetail | null>(null);
  const [action, setAction] = useState<'count' | 'resolve' | null>(null);
  const [counted, setCounted] = useState('');
  const [resolution, setResolution] = useState<string>('WRONG_SKU_SOLD');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const scope = isSuperAdmin && locationId ? { locationId } : {};

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError(null);
    try {
      const res = await inventoryExceptionService.getAll({ status, page, limit: 25, ...scope }, signal);
      setRows(res.data.data); setPagination(res.data.pagination);
    } catch (err: any) {
      if (err?.name !== 'CanceledError') setError(err.response?.data?.error || 'Could not load inventory exceptions');
    } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, page, locationId]);

  useEffect(() => { const controller = new AbortController(); load(controller.signal); return () => controller.abort(); }, [load]);

  const open = async (id: string) => {
    try { setDetail((await inventoryExceptionService.getById(id, scope)).data.data); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Could not load this exception'); }
  };
  const closeAction = () => { setAction(null); setCounted(''); setNotes(''); setResolution('WRONG_SKU_SOLD'); };
  const refresh = async () => { await load(); if (detail) await open(detail.id); };

  const requestRecount = async () => {
    if (!detail) return;
    setSaving(true);
    try { await inventoryExceptionService.requestRecount(detail.id); toast.success('Recount requested'); await refresh(); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Could not request a recount'); }
    finally { setSaving(false); }
  };

  const submit = async () => {
    if (!detail || !action) return;
    if (resolution === 'OTHER' && !notes.trim()) { toast.error('Describe the resolution when choosing Other'); return; }
    setSaving(true);
    try {
      if (action === 'count') {
        const quantity = Number(counted);
        if (!Number.isSafeInteger(quantity) || quantity < 0) { toast.error('Enter the physical count'); setSaving(false); return; }
        await inventoryExceptionService.recordCount(detail.id, { countedQuantity: quantity, resolution, notes: notes.trim() || undefined,
          expectedVersion: detail.product.stockVersion, idempotencyKey: crypto.randomUUID() });
        toast.success('Count recorded and exception resolved');
      } else {
        await inventoryExceptionService.resolve(detail.id, { resolution, notes: notes.trim() || undefined });
        toast.success('Exception resolved');
      }
      closeAction(); setDetail(null); await load();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Could not save');
    } finally { setSaving(false); }
  };

  const countedNumber = Number(counted);
  const adjustment = detail && counted !== '' && Number.isSafeInteger(countedNumber) ? countedNumber - detail.currentQuantity : null;

  return (
    <ManagementPage>
      <PageHeader
        title="Inventory Exceptions"
        secondaryTabs={<PageTabs secondary label="Exception status" value={status} onChange={value => { setStatus(value as Status); setPage(1); }}
          items={[{ id: 'open', label: 'Needs review' }, { id: 'resolved', label: 'Resolved' }, { id: 'all', label: 'All' }]} />}
      />
      <p className="text-sm text-muted-foreground mb-4">
        The register never stops a sale because recorded stock ran out. When a sale takes an item below zero, it appears here so the
        store can count it and the items most likely confused with it.
      </p>
      {error && <div role="alert" className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error} <Button variant="outline" size="sm" onClick={() => load()}>Retry</Button></div>}
      {!loading && !error && rows.length === 0 ? (
        <EmptyState icon={ClipboardCheck} title={status === 'resolved' ? 'No resolved exceptions yet' : 'No inventory exceptions'}
          hint={status === 'open' ? 'Every item has a recorded quantity of zero or more, or its discrepancy was reviewed.' : undefined} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead className="text-right">Recorded qty</TableHead>
              <TableHead className="text-right">Lowest</TableHead>
              <TableHead className="text-right">Sales below zero</TableHead>
              <TableHead>Last negative</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(loading ? [] : rows).map(row => (
              <TableRow key={row.id} className="cursor-pointer" onClick={() => open(row.id)}>
                <TableCell>
                  <div className="font-medium">{row.product.name}</div>
                  <div className="text-xs text-muted-foreground">{row.product.sku}{row.product.barcode ? ` · ${row.product.barcode}` : ''}</div>
                </TableCell>
                <TableCell className={`text-right tabular-nums ${row.currentQuantity < 0 ? 'text-destructive font-medium' : ''}`}>{row.currentQuantity}</TableCell>
                <TableCell className="text-right tabular-nums">{row.lowestQuantity}</TableCell>
                <TableCell className="text-right tabular-nums">{row.occurrenceCount}</TableCell>
                <TableCell>{formatDate(row.lastNegativeAt)}</TableCell>
                <TableCell>{statusBadge(row.status)}{row.resolution ? <span className="ml-2 text-xs text-muted-foreground">{formatEnumLabel(row.resolution)}</span> : null}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {loading && <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>}
      {pagination.totalPages > 1 && <Pagination page={page} totalPages={pagination.totalPages} onPageChange={setPage} totalItems={pagination.total} itemName="exceptions" />}

      <Modal isOpen={!!detail && !action} onClose={() => setDetail(null)} title={detail ? `Inventory discrepancy: ${detail.product.name}` : ''} size="lg"
        footer={detail && detail.status !== 'RESOLVED' && !isReadOnly ? <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={requestRecount} disabled={saving || detail.status === 'RECOUNT_REQUESTED'}>Mark for recount</Button>
          <Button variant="outline" onClick={() => setAction('resolve')}>Resolve without count</Button>
          <Button onClick={() => setAction('count')}>Record physical count</Button>
        </div> : undefined}>
        {detail && <div className="space-y-5 text-sm">
          <div className="flex items-start gap-3 rounded-md border border-warning/40 bg-warning/10 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <div>
              <p className="font-medium">Recorded stock: {detail.currentQuantity} units · {statusBadge(detail.status)}</p>
              <p>{detail.summary}</p>
              <p className="mt-1 text-muted-foreground">{detail.recommendation}</p>
            </div>
          </div>
          <section>
            <h3 className="mb-2 font-semibold">Related products to check</h3>
            {detail.relatedProducts.length === 0 ? <p className="text-muted-foreground">No closely related products found. Add brand, family, flavor and size to products for better suggestions.</p> :
              <ul className="space-y-1">{detail.relatedProducts.map(p => <li key={p.id} className="flex justify-between gap-3 rounded border border-border px-3 py-2">
                <span><span className="font-medium">{p.name}</span> <span className="text-xs text-muted-foreground">{p.sku}</span><br />
                  <span className="text-xs text-muted-foreground">{p.reasons.join(' · ')}</span></span>
                <span className="tabular-nums text-muted-foreground">Recorded: {p.stockQuantity}</span></li>)}</ul>}
          </section>
          <section className="grid gap-1">
            <h3 className="mb-1 font-semibold">History</h3>
            <p><span className="text-muted-foreground">Last count:</span> {describeLog(detail.lastCount)}</p>
            <p><span className="text-muted-foreground">Last delivery:</span> {describeLog(detail.lastReceipt)}</p>
            <p><span className="text-muted-foreground">Last adjustment:</span> {describeLog(detail.lastAdjustment)}</p>
            <p><span className="text-muted-foreground">First went negative:</span> {formatDate(detail.firstNegativeAt)}</p>
          </section>
          <section>
            <h3 className="mb-2 font-semibold">Recent sales</h3>
            {detail.recentSales.length === 0 ? <p className="text-muted-foreground">No recent sales.</p> :
              <ul className="space-y-1">{detail.recentSales.map(line => <li key={line.id} className="flex justify-between">
                <span>{line.sale.saleNumber}{line.sale.user ? ` · ${line.sale.user.firstName} ${line.sale.user.lastName}` : ''}</span>
                <span className="text-muted-foreground">{line.quantity} × · {formatDate(line.createdAt)}</span></li>)}</ul>}
          </section>
          <section>
            <h3 className="mb-1 font-semibold">Possible reasons</h3>
            <p className="text-muted-foreground">{detail.possibleCauses.join('; ')}. This alert does not assume anyone made a mistake.</p>
          </section>
          {detail.status === 'RESOLVED' && <p className="text-muted-foreground">Resolved as {formatEnumLabel(detail.resolution || '')}{detail.resolutionNotes ? `: ${detail.resolutionNotes}` : ''}.</p>}
        </div>}
      </Modal>

      <Modal isOpen={!!detail && !!action} onClose={closeAction} title={action === 'count' ? 'Record physical count' : 'Resolve exception'} size="md"
        footer={<div className="flex justify-end gap-2"><Button variant="outline" onClick={closeAction} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? 'Saving…' : action === 'count' ? 'Save count and resolve' : 'Resolve'}</Button></div>}>
        {detail && <div className="space-y-4 text-sm">
          {action === 'count' && <>
            <Input type="number" label={`Units of ${detail.product.name} on hand`} min="0" step="1" value={counted} onChange={e => setCounted(e.target.value)} autoFocus />
            {adjustment !== null && <p className="text-muted-foreground">System quantity {detail.currentQuantity} → counted {countedNumber}: adjustment of {adjustment > 0 ? '+' : ''}{adjustment} will be recorded with the reason below.</p>}
          </>}
          <Select label="Reason" value={resolution} onChange={e => setResolution(e.target.value)}>
            {RESOLUTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
          {resolution === 'WRONG_SKU_SOLD' && <p className="text-xs text-muted-foreground">If you know which sale used the wrong item, a manager can also correct that sale line from the sale's details; the customer's receipt does not change.</p>}
          <Input label="Notes" description={resolution === 'OTHER' ? 'Required' : 'Optional'} value={notes} onChange={e => setNotes(e.target.value)} maxLength={2000} />
        </div>}
      </Modal>
    </ManagementPage>
  );
};
