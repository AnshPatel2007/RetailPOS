import { LoadingState } from '@/components/ui/LoadingState';
import { Alert } from '@/components/ui/Alert';
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
import { Modal } from '@/components/ui/Modal';
import { ResolveDiscrepancyDialog, DiscrepancyDetail } from '@/components/inventory/ResolveDiscrepancyDialog';
import { inventoryExceptionService } from '@/services/api';
import { useEffectiveLocation } from '@/hooks/useEffectiveLocation';
import { formatCurrency, formatDate, formatEnumLabel } from '@/lib/utils';

type View = 'open' | 'resolved' | 'all' | 'corrections' | 'unmatched';

interface ExceptionRow {
  id: string;
  status: 'OPEN' | 'RECOUNT_REQUESTED' | 'RESOLVED';
  firstNegativeAt: string;
  lastNegativeAt: string;
  lowestQuantity: number;
  currentQuantity: number;
  occurrenceCount: number;
  resolution: string | null;
  product: { id: string; name: string; sku: string; barcode: string | null };
}
interface LogEntry { createdAt: string; type: string; quantity: number; previousQty: number; newQty: number; notes: string | null }
interface ExceptionDetail extends ExceptionRow, DiscrepancyDetail {
  summary: string;
  recommendation: string;
  possibleCauses: string[];
  lastCount: LogEntry | null;
  lastReceipt: LogEntry | null;
  lastAdjustment: LogEntry | null;
  resolutionNotes: string | null;
  product: ExceptionRow['product'] & { stockVersion: number };
}
interface CorrectionRow {
  id: string; createdAt: string; reason: string; quantity: number; notes: string | null;
  recordedAs: { name: string; price: number | string } | null; actually: { name: string; price: number | string } | null;
  sale: { saleNumber: string; cashier: string | null } | null; cogsChange: number | string | null; priceDifference: number | string | null;
}
interface UnmatchedRow {
  entryId: string; createdAt: string; kind: string; notes: string | null; product: { name: string; sku: string } | null;
  units: number; soldUnits: number; estimatedValue: number | string; estimatedUnitCost: number | string | null;
  match: { actualUnitCost: number | string; matchedAt: string } | null;
}

const statusBadge = (status: ExceptionRow['status']) => status === 'RESOLVED'
  ? <Badge variant="success">Resolved</Badge>
  : status === 'RECOUNT_REQUESTED' ? <Badge variant="warning">Recount requested</Badge> : <Badge variant="destructive">Open</Badge>;

const describeLog = (entry: LogEntry | null) => entry
  ? `${formatDate(entry.createdAt)} · ${formatEnumLabel(entry.type)} · ${entry.quantity > 0 ? '+' : ''}${entry.quantity} (${entry.previousQty} → ${entry.newQty})`
  : 'None recorded';
const signedMoney = (value: number | string | null) => value === null ? '—' : `${Number(value) > 0 ? '+' : Number(value) < 0 ? '−' : ''}${formatCurrency(Math.abs(Number(value)))}`;

export const InventoryExceptions: React.FC = () => {
  const { locationId, isReadOnly, isSuperAdmin } = useEffectiveLocation();
  const [view, setView] = useState<View>('open');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<ExceptionRow[]>([]);
  const [corrections, setCorrections] = useState<CorrectionRow[]>([]);
  const [unmatched, setUnmatched] = useState<UnmatchedRow[]>([]);
  const [pagination, setPagination] = useState({ totalPages: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<ExceptionDetail | null>(null);
  const [resolving, setResolving] = useState<ExceptionDetail | null>(null);
  const [matching, setMatching] = useState<UnmatchedRow | null>(null);
  const [actualCost, setActualCost] = useState('');
  const [saving, setSaving] = useState(false);
  const scope = isSuperAdmin && locationId ? { locationId } : {};

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError(null);
    try {
      if (view === 'corrections') setCorrections((await inventoryExceptionService.corrections(scope, signal)).data.data);
      else if (view === 'unmatched') setUnmatched((await inventoryExceptionService.unmatched({ status: 'all', ...scope }, signal)).data.data);
      else {
        const res = await inventoryExceptionService.getAll({ status: view, page, limit: 25, ...scope }, signal);
        setRows(res.data.data); setPagination(res.data.pagination);
      }
    } catch (err: any) {
      if (err?.name !== 'CanceledError') setError(err.response?.data?.error || 'Could not load this list');
    } finally { setLoading(false); }
  }, [view, page, locationId]);

  useEffect(() => { const controller = new AbortController(); load(controller.signal); return () => controller.abort(); }, [load]);

  const open = async (id: string) => {
    try { setDetail((await inventoryExceptionService.getById(id, scope)).data.data); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Could not load this exception'); }
  };

  const requestRecount = async () => {
    if (!detail) return;
    setSaving(true);
    try { await inventoryExceptionService.requestRecount(detail.id); toast.success('Recount requested'); await load(); await open(detail.id); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Could not request a recount'); }
    finally { setSaving(false); }
  };

  const saveMatch = async () => {
    if (!matching) return;
    const cost = Number(actualCost);
    if (!Number.isFinite(cost) || cost < 0) { toast.error('Enter the supplier cost per unit'); return; }
    setSaving(true);
    try { await inventoryExceptionService.matchUnmatched(matching.entryId, { actualUnitCost: cost }); toast.success('Supplier cost recorded'); setMatching(null); setActualCost(''); await load(); }
    catch (err: any) { toast.error(err.response?.data?.error || 'Could not save'); }
    finally { setSaving(false); }
  };

  const showsExceptions = view === 'open' || view === 'resolved' || view === 'all';
  const empty = !loading && !error && (showsExceptions ? rows.length === 0 : view === 'corrections' ? corrections.length === 0 : unmatched.length === 0);

  return (
    <ManagementPage>
      <PageHeader
        title="Inventory Exceptions"
        secondaryTabs={<PageTabs secondary label="Exception view" value={view} onChange={value => { setView(value as View); setPage(1); }}
          items={[{ id: 'open', label: 'Needs Review' }, { id: 'resolved', label: 'Resolved' }, { id: 'all', label: 'All' },
            { id: 'corrections', label: 'Corrections' }, { id: 'unmatched', label: 'Added Without Invoice' }]} />}
      />
      <p className="text-sm text-muted-foreground mb-4">
        {view === 'corrections' ? 'Products that were sold, received or returned under the wrong item. Sale amounts are never changed; the cost of goods follows what actually left the store.'
          : view === 'unmatched' ? 'Stock recorded as received without a supplier invoice (a delivery that was never entered, or a shortfall that was counted back). Enter the real cost when the invoice arrives; the difference is posted once, in the current period.'
          : 'The register never stops a sale because recorded stock ran out. When a sale takes an item below zero, it appears here so the store can find out why.'}
      </p>
      {error && <Alert tone="error" className="mb-4" title={error} action={<Button variant="outline" size="sm" onClick={() => load()}>Retry</Button>} />}
      {loading && <LoadingState />}
      {empty && <EmptyState icon={ClipboardCheck}
        title={view === 'corrections' ? 'No corrections yet' : view === 'unmatched' ? 'Nothing waiting for an invoice' : view === 'resolved' ? 'No resolved exceptions yet' : 'No inventory exceptions'}
        hint={view === 'open' ? 'Every item has a recorded quantity of zero or more, or its discrepancy was reviewed.' : undefined} />}

      {showsExceptions && !loading && rows.length > 0 && <Table>
        <TableHeader><TableRow>
          <TableHead>Product</TableHead><TableHead className="text-right">Recorded qty</TableHead><TableHead className="text-right">Lowest</TableHead>
          <TableHead className="text-right">Sales below zero</TableHead><TableHead>Last negative</TableHead><TableHead>Status</TableHead>
        </TableRow></TableHeader>
        <TableBody>{rows.map(row => (
          <TableRow key={row.id} className="cursor-pointer" onClick={() => open(row.id)}>
            <TableCell><button type="button" className="text-left font-medium hover:underline focus-visible:underline" onClick={event => { event.stopPropagation(); open(row.id); }}>{row.product.name}</button><div className="text-xs text-muted-foreground">{row.product.sku}{row.product.barcode ? ` · ${row.product.barcode}` : ''}</div></TableCell>
            <TableCell className={`text-right tabular-nums ${row.currentQuantity < 0 ? 'text-destructive font-medium' : ''}`}>{row.currentQuantity}</TableCell>
            <TableCell className="text-right tabular-nums">{row.lowestQuantity}</TableCell>
            <TableCell className="text-right tabular-nums">{row.occurrenceCount}</TableCell>
            <TableCell>{formatDate(row.lastNegativeAt)}</TableCell>
            <TableCell>{statusBadge(row.status)}{row.resolution ? <span className="ml-2 text-xs text-muted-foreground">{formatEnumLabel(row.resolution)}</span> : null}</TableCell>
          </TableRow>))}
        </TableBody>
      </Table>}
      {showsExceptions && pagination.totalPages > 1 && <Pagination page={page} totalPages={pagination.totalPages} onPageChange={setPage} totalItems={pagination.total} itemName="exceptions" />}

      {view === 'corrections' && !loading && corrections.length >= 500 && <p className="mb-2 text-sm text-muted-foreground">Showing the latest 500 corrections.</p>}
      {view === 'corrections' && !loading && corrections.length > 0 && <Table>
        <TableHeader><TableRow>
          <TableHead>Date</TableHead><TableHead>Recorded as</TableHead><TableHead>Actually</TableHead><TableHead className="text-right">Units</TableHead>
          <TableHead>Sale · cashier</TableHead><TableHead className="text-right">Customer charged</TableHead><TableHead className="text-right">Cost of goods</TableHead>
        </TableRow></TableHeader>
        <TableBody>{corrections.map(row => {
          const price = row.priceDifference === null ? null : Number(row.priceDifference);
          return <TableRow key={row.id}>
            <TableCell>{formatDate(row.createdAt)}<div className="text-xs text-muted-foreground">{formatEnumLabel(row.reason)}</div></TableCell>
            <TableCell>{row.recordedAs?.name ?? '—'}</TableCell>
            <TableCell>{row.actually?.name ?? '—'}</TableCell>
            <TableCell className="text-right tabular-nums">{row.quantity}</TableCell>
            <TableCell>{row.sale ? `${row.sale.saleNumber}${row.sale.cashier ? ' · ' + row.sale.cashier : ''}` : 'Not linked to a sale'}</TableCell>
            <TableCell className={`text-right ${price && price > 0 ? 'text-destructive' : ''}`}>{price === null || price === 0 ? '—' : price > 0 ? `Under ${formatCurrency(price)}` : `Over ${formatCurrency(-price)}`}</TableCell>
            <TableCell className="text-right tabular-nums">{signedMoney(row.cogsChange)}</TableCell>
          </TableRow>;
        })}</TableBody>
      </Table>}

      {view === 'unmatched' && !loading && unmatched.length >= 500 && <p className="mb-2 text-sm text-muted-foreground">Showing the latest 500 entries.</p>}
      {view === 'unmatched' && !loading && unmatched.length > 0 && <Table>
        <TableHeader><TableRow>
          <TableHead>Date</TableHead><TableHead>Product</TableHead><TableHead className="text-right">Units</TableHead>
          <TableHead className="text-right">Estimated cost</TableHead><TableHead>Status</TableHead><TableHead />
        </TableRow></TableHeader>
        <TableBody>{unmatched.map(row => <TableRow key={row.entryId}>
          <TableCell>{formatDate(row.createdAt)}</TableCell>
          <TableCell><div className="font-medium">{row.product?.name ?? '—'}</div>{row.soldUnits > 0 && <div className="text-xs text-muted-foreground">{row.soldUnits} already sold</div>}</TableCell>
          <TableCell className="text-right tabular-nums">{row.units}</TableCell>
          <TableCell className="text-right tabular-nums">{row.estimatedUnitCost === null ? '—' : `${formatCurrency(Number(row.estimatedUnitCost))} each`}</TableCell>
          <TableCell>{row.match ? <Badge variant="success">{formatCurrency(Number(row.match.actualUnitCost))} each entered</Badge> : <Badge variant="warning">Waiting for invoice</Badge>}</TableCell>
          <TableCell className="text-right">{!row.match && !isReadOnly && <Button size="sm" variant="outline" onClick={() => { setMatching(row); setActualCost(row.estimatedUnitCost === null ? '' : String(Number(row.estimatedUnitCost))); }}>Enter supplier cost</Button>}</TableCell>
        </TableRow>)}</TableBody>
      </Table>}

      <Modal isOpen={!!detail && !resolving} onClose={() => setDetail(null)} title={detail ? `Inventory discrepancy: ${detail.product.name}` : ''} size="lg"
        footer={detail && detail.status !== 'RESOLVED' && !isReadOnly ? <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={requestRecount} disabled={saving || detail.status === 'RECOUNT_REQUESTED'}>Mark for recount</Button>
          <Button onClick={() => setResolving(detail)}>Resolve discrepancy</Button>
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

      <ResolveDiscrepancyDialog detail={resolving} locationId={locationId || ''} onClose={() => setResolving(null)}
        onDone={() => { setResolving(null); setDetail(null); load(); }} />

      <Modal isOpen={!!matching} onClose={() => setMatching(null)} title="Enter supplier cost" size="md"
        footer={<div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setMatching(null)} disabled={saving}>Cancel</Button>
          <Button onClick={saveMatch} disabled={saving}>{saving ? 'Saving…' : 'Save cost'}</Button></div>}>
        {matching && <div className="space-y-3 text-sm">
          <p>{matching.product?.name}: {matching.units} unit(s) recorded at an estimated {matching.estimatedUnitCost === null ? 'unknown cost' : `${formatCurrency(Number(matching.estimatedUnitCost))} each`}.</p>
          <Input type="number" label="Actual cost per unit from the invoice" min="0" step="0.01" value={actualCost} onChange={e => setActualCost(e.target.value)} autoFocus />
          {matching.estimatedUnitCost !== null && actualCost !== '' && Number.isFinite(Number(actualCost)) && (
            <p className="text-muted-foreground">Difference of {signedMoney((Number(actualCost) - Number(matching.estimatedUnitCost)) * matching.units)} is posted now: units already sold go to cost of goods, units still on hand are revalued.</p>)}
        </div>}
      </Modal>
    </ManagementPage>
  );
};
