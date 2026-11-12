import { ManagementPage, SummaryStrip } from '@/components/common/Workspace';
import { useScopedQuery } from '@/hooks/useScopedQuery';
import { Select } from '@/components/ui/Select';
import { formatEnumLabel, formatDate } from '@/lib/utils';
import { useLegacyPageRefresh } from '@/hooks/useLegacyPageRefresh';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ClipboardCheck, Plus, CheckCircle, XCircle, Eye, Send, ListChecks } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { PageTabs } from '@/components/common/PageTabs';
import { PageHeader } from '@/components/common/PageHeader';
import { Pagination } from '@/components/common/Pagination';
import { EmptyState } from '@/components/common/EmptyState';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/Table';
import { cycleCountService, locationService, categoryService, apiErrorMessage } from '@/services/api';
import { useAuthStore } from '@/store/authStore';
import { useEffectiveLocation } from '@/hooks/useEffectiveLocation';
import toast from 'react-hot-toast';
import { useUrlFilter, useUrlPage, useResetUrlFilters } from '@/hooks/useUrlFilter';
import { ProductPicker, PickableProduct } from '@/components/common/ProductPicker';
import { LoadingState, Spinner } from '@/components/ui/LoadingState';
import { Textarea } from '@/components/ui/Textarea';
import { Alert } from '@/components/ui/Alert';

interface CycleCountRecord {
  id: string;
  countNumber: string;
  locationId: string;
  status: string;
  type: string;
  categoryId: string | null;
  notes: string | null;
  createdBy: string;
  approvedBy: string | null;
  completedAt: string | null;
  createdAt: string;
  items: CycleCountItem[];
  /** List rows carry counts and the store name instead of every item. */
  itemCount?: number;
  countedCount?: number;
  locationName?: string | null;
}

interface CycleCountItem {
  id: string;
  productId: string;
  expectedQty: number;
  stockVersion: number | null;
  countedQty: number | null;
  discrepancy: number | null;
  notes: string | null;
  product?: {
    id: string;
    name: string;
    sku: string;
    stockVersion: number;
  };
}

interface Location {
  id: string;
  name: string;
}

interface Category {
  id: string;
  name: string;
}

const statusVariant: Record<string, 'default' | 'warning' | 'success' | 'secondary'> = {
  IN_PROGRESS: 'default',
  REVIEW: 'warning',
  APPROVED: 'success',
  CANCELLED: 'secondary',
};

export const CycleCount: React.FC = () => {
  const { user } = useAuthStore();
  const { isReadOnly, locationId } = useEffectiveLocation();
  const requestVersion = useRef(0);
  const [counts, setCounts] = useState<CycleCountRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [locations, setLocations] = useState<Location[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [statusFilter, setStatusFilter] = useUrlFilter('status');
  const [page, setPage] = useUrlPage();
  const [total, setTotal] = useState(0);

  // Create modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createLocationId, setCreateLocationId] = useState('');
  const [createType, setCreateType] = useState('FULL');
  const [createCategoryId, setCreateCategoryId] = useState('');
  const [createNotes, setCreateNotes] = useState('');
  const [selectedProducts, setSelectedProducts] = useState<PickableProduct[]>([]);

  // Detail/counting modal
  const [recordId, setRecordId] = useUrlFilter('record');
  const [detailRefresh, setDetailRefresh] = useState(0);
  const [detailError, setDetailError] = useState('');
  const showDetailModal = !!recordId;
  const resetUrlFilters = useResetUrlFilters();
  const priorLocation = useRef(locationId);
  useEffect(() => {
    if (priorLocation.current !== locationId) { resetUrlFilters(); priorLocation.current = locationId; }
  }, [locationId, resetUrlFilters]);
  const [selectedCount, setSelectedCount] = useState<CycleCountRecord | null>(null);
  const [itemCounts, setItemCounts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);

  const fetchCounts = useCallback(async (quiet = false, active: () => boolean = () => true, signal?: AbortSignal) => {
    const version = ++requestVersion.current;
    if (!quiet) { setLoading(true); setLoadError(''); }
    try {
      const { data } = await cycleCountService.getAll({ locationId, page, limit: 20, status: statusFilter || undefined }, signal);
      if (version !== requestVersion.current || !active()) return;
      setLoadError('');
      setCounts(data.data);
      setTotal(data.total);
    } catch (failure) {
      if (quiet) throw failure;
      if (version === requestVersion.current) setLoadError('Unable to load cycle counts. Try again.');
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [page, statusFilter, locationId]);

  useEffect(() => {
    fetchCounts();
    return () => { requestVersion.current++; };
  }, [fetchCounts]);

  useEffect(() => {
    let active = true;
    setCounts([]); setShowCreateModal(false); setCreateCategoryId(''); setCreateNotes(''); setItemCounts({});
    setLocations([]); setCategories([]); setSelectedCount(null);
    if (locationId) locationService.getById(locationId).then(({ data }) => { if (active) setLocations([data.data]); }).catch(() => { if (active) toast.error('Unable to load the current store'); });
    categoryService.getAll().then(({ data }) => { if (active) setCategories(data.data || []); }).catch(() => { if (active) toast.error('Unable to load categories'); });
    return () => { active = false; };
  }, [locationId]);

  useEffect(() => { setCreateLocationId(locationId || ''); setSelectedProducts([]); }, [locationId]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await cycleCountService.create({
        locationId: createLocationId,
        type: createType,
        categoryId: createType === 'CATEGORY' ? createCategoryId : undefined,
        productIds: createType === 'PARTIAL' ? selectedProducts.map(p => p.id) : undefined,
        notes: createNotes || undefined,
      });
      toast.success('Cycle count started');
      setShowCreateModal(false);
      setCreateLocationId(locationId || '');
      setSelectedProducts([]);
      setCreateType('FULL');
      setCreateCategoryId('');
      setCreateNotes('');
      fetchCounts();
    } catch (err: any) {
      toast.error(apiErrorMessage(err, 'Failed to start cycle count'));
    }
  };

  const viewDetail = (record: { id: string }) => { setRecordId(record.id); setDetailRefresh(value => value + 1); };
  useEffect(() => {
    let active = true;
    setSelectedCount(null); setDetailError('');
    if (recordId) cycleCountService.getById(recordId).then(({ data }) => {
      if (!active) return;
      setSelectedCount(data.data);
      const initial: Record<string, number> = {};
      data.data.items.forEach((item: CycleCountItem) => { if (item.countedQty !== null) initial[item.id] = item.countedQty; });
      setItemCounts(initial);
    }).catch(() => { if (active) setDetailError('Unable to load this record. It may no longer be available to this store.'); });
    return () => { active = false; };
  }, [recordId, locationId, detailRefresh]);
  // Entered counts that differ from what the server has saved.
  const unsavedItems = selectedCount ? Object.entries(itemCounts)
    .filter(([id, countedQty]) => selectedCount.items.find(item => item.id === id)?.countedQty !== countedQty)
    .map(([id, countedQty]) => ({ id, countedQty })) : [];
  const uncountedItems = selectedCount ? selectedCount.items.filter(item => itemCounts[item.id] === undefined).length : 0;
  const saveEnteredCounts = async (count: CycleCountRecord) => {
    for (let offset = 0; offset < unsavedItems.length; offset += 1000) {
      await cycleCountService.updateItems(count.id, unsavedItems.slice(offset, offset + 1000));
    }
  };
  const handleSaveItems = async () => {
    if (!selectedCount || busy) return;
    if (!Object.keys(itemCounts).length) {
      toast.error('Enter at least one count');
      return;
    }
    setBusy(true);
    try {
      await saveEnteredCounts(selectedCount);
      toast.success('Counts saved');
      const { data } = await cycleCountService.getById(selectedCount.id);
      setSelectedCount(data.data);
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Failed to save counts'));
    } finally { setBusy(false); }
  };

  // One shared confirm dialog for submit/approve/cancel
  const [confirmState, setConfirmState] = useState<{
    title: string;
    message: string;
    destructive?: boolean;
    confirmLabel?: string;
    action: () => void;
  } | null>(null);

  const handleSubmit = async () => {
    if (!selectedCount || busy) return;
    setBusy(true);
    try {
      // Counts typed since the last save are saved first, so nothing entered is lost.
      await saveEnteredCounts(selectedCount);
      await cycleCountService.submit(selectedCount.id);
      toast.success('Submitted for review');
      setRecordId('');
      fetchCounts();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Failed to submit'));
      setDetailRefresh(value => value + 1);
    } finally { setBusy(false); }
  };

  const handleApprove = async () => {
    if (!selectedCount) return;
    try {
      await cycleCountService.approve(selectedCount.id);
      toast.success('Cycle count approved, inventory adjusted');
      setRecordId('');
      fetchCounts();
    } catch (err: any) {
      toast.error(apiErrorMessage(err, 'Failed to approve'));
      await viewDetail(selectedCount);
    }
  };

  const handleCancel = async () => {
    if (!selectedCount) return;
    try {
      await cycleCountService.cancel(selectedCount.id);
      toast.success('Cycle count cancelled');
      setRecordId('');
      fetchCounts();
    } catch (err: any) {
      toast.error(apiErrorMessage(err, 'Failed to cancel'));
    }
  };

  const totalPages = Math.ceil(total / 20);
  const isAdmin = user?.role === 'ADMIN';
  // Mutating routes are ADMIN/MANAGER only — hide the buttons cashiers can't use
  const canManage =
    !isReadOnly &&
    ['ADMIN', 'MANAGER'].includes(user?.role || '');

  const staleItems = selectedCount?.items.filter(i => i.stockVersion == null || i.stockVersion !== i.product?.stockVersion) || [];
  const handleRefresh = async () => {
    if (!selectedCount) return;
    try {
      await cycleCountService.refresh(selectedCount.id);
      await viewDetail(selectedCount);
      toast.success('Changed items cleared. Recount them before submitting.');
      void fetchCounts();
    } catch (err) { toast.error(apiErrorMessage(err, 'Could not refresh count')); }
  };

  const autoRefresh = useLegacyPageRefresh((current, signal) => fetchCounts(true, current, signal), { key: JSON.stringify([locationId, page, statusFilter]), paused: loading });

  // What to count next, and how often counts have matched the record lately.
  const suggestions = useScopedQuery(['count-suggestions', locationId], async signal => (await cycleCountService.suggested(8, signal)).data.data, !!locationId);
  const accuracy = useScopedQuery(['count-accuracy', locationId], async signal => (await cycleCountService.accuracy(signal)).data.data, !!locationId);
  const [startingSuggested, setStartingSuggested] = useState(false);
  const startSuggested = async () => {
    const items = suggestions.data || [];
    if (!items.length || !locationId) return;
    setStartingSuggested(true);
    try {
      const { data } = await cycleCountService.create({ locationId, type: 'PARTIAL', productIds: items.map(item => item.productId), notes: 'Suggested count' });
      toast.success('Suggested count started');
      fetchCounts();
      setRecordId(data.data.id);
    } catch (err) { toast.error(apiErrorMessage(err, 'Failed to start the suggested count')); }
    finally { setStartingSuggested(false); }
  };
  const accuracyData = accuracy.data;

  return (
    <ManagementPage className="">
      <PageHeader
        title="Cycle Counts"
        secondaryTabs={<PageTabs secondary label="Count status" value={statusFilter} onChange={setStatusFilter}
          items={["","IN_PROGRESS","REVIEW","APPROVED","CANCELLED"].map(status => ({ id: status, label: status ? formatEnumLabel(status) : 'All' }))} />}
        subtitle="Physical inventory verification"
        actions={canManage && (
          <Button variant="primary" onClick={() => setShowCreateModal(true)}>
            <Plus className="w-4 h-4 mr-2" />
            New Count
          </Button>
        )}
      />
      {autoRefresh.notice}
      <SummaryStrip items={[
        { label: 'Stock accuracy (last 30 days)', value: accuracyData?.accuracy == null ? '—' : `${Math.round(accuracyData.accuracy * 100)}%`,
          tone: accuracyData?.accuracy != null && accuracyData.accuracy < 0.9 ? 'warning' : 'default',
          detail: !accuracyData ? (accuracy.error ? 'Did not load' : 'Loading…') : accuracyData.counted
            ? `${accuracyData.matched} of ${accuracyData.counted} counted items matched the record` : 'No counts approved in the last 30 days' },
      ]} />

      {canManage && <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <CardTitle>Suggested Count</CardTitle>
          <Button variant="primary" onClick={() => void startSuggested()} disabled={startingSuggested || !suggestions.data?.length}>
            <ListChecks className="w-4 h-4 mr-2" />Start Suggested Count
          </Button>
        </CardHeader>
        <CardContent>
          {suggestions.error ? <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">Suggestions did not load.<Button size="sm" variant="outline" onClick={suggestions.refresh}>Retry</Button></div>
            : !suggestions.data ? <div className="flex justify-center py-4"><Spinner /></div>
            : !suggestions.data.length ? <p className="text-sm text-muted-foreground">Nothing to suggest: every tracked item is already on an open count or has a stock exception to resolve first.</p>
            : <>
              <p className="mb-3 text-sm text-muted-foreground">A short count of the {suggestions.data.length} items most worth checking now: never or long ago counted, high value, fast selling, recently adjusted, or quick to count.</p>
              <ol className="divide-y rounded-md border" aria-label="Suggested items to count">
                {suggestions.data.map(item => <li key={item.productId} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-3 py-2 text-sm">
                  <span className="min-w-0 font-medium">{item.name}<span className="ml-2 text-xs font-normal text-muted-foreground">{item.stockQuantity} on record</span></span>
                  <span className="text-xs text-muted-foreground">{item.reasons.join(' · ') || 'Due for a count'}</span>
                </li>)}
              </ol>
            </>}
        </CardContent>
      </Card>}

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle>Counts</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <Spinner size="lg" />
            </div>
          ) : loadError ? (<div role="alert"><p>{loadError}</p><Button className="mt-3" variant="outline" onClick={() => void fetchCounts()}>Retry</Button></div>) : counts.length === 0 ? (
            <EmptyState
              icon={ClipboardCheck}
              title="No cycle counts found"
              hint={statusFilter ? 'Try a different status filter' : 'Start a count to verify physical inventory'}
            />
          ) : (
            <Table scrollLabel="Cycle Count records">
              <TableHeader>
                <TableRow>
                  <TableHead>Count #</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Items</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {counts.map((c) => (
                  <TableRow key={c.id} className="cursor-pointer" onClick={() => viewDetail(c)}>
                    <TableCell className="font-medium">
                      <button type="button" className="text-left hover:underline focus-visible:underline" onClick={(event) => { event.stopPropagation(); viewDetail(c); }}>{c.countNumber}</button>
                    </TableCell>
                    <TableCell>{c.locationName || locations.find(l => l.id === c.locationId)?.name || '\u2014'}</TableCell>
                    <TableCell className="text-muted-foreground">{formatEnumLabel(c.type)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {c.status === 'IN_PROGRESS' && c.itemCount ? `${c.countedCount ?? 0} of ${c.itemCount} counted` : c.itemCount ?? '\u2014'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant[c.status] || 'secondary'}>{formatEnumLabel(c.status)}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(c.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} totalItems={total} itemName="counts" />
        </CardContent>
      </Card>

      {/* Create Modal */}
      <Modal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} title="Start Cycle Count">
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Location *</label>
            <Select
              value={createLocationId}
              aria-label="Count location"
              disabled={!!locationId}
              onChange={(e) => setCreateLocationId(e.target.value)}
              required
              className="w-full px-3 py-2 bg-background border border-input rounded-md text-foreground"
            >
              <option value="">Select location...</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Count Type</label>
            <Select
              value={createType}
              aria-label="Count type"
              onChange={(e) => setCreateType(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-input rounded-md text-foreground"
            >
              <option value="FULL">Full Count</option>
              <option value="PARTIAL">Partial</option>
              <option value="CATEGORY">By Category</option>
            </Select>
          </div>
          {createType === 'CATEGORY' && (
            <div>
              <label className="block text-sm font-medium mb-1">Category *</label>
              <Select
                value={createCategoryId}
                aria-label="Count category"
                onChange={(e) => setCreateCategoryId(e.target.value)}
                required
                className="w-full px-3 py-2 bg-background border border-input rounded-md text-foreground"
              >
                <option value="">Select category...</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </div>
          )}
          {createType === 'PARTIAL' && createLocationId && <div className="space-y-3">
            <div className="flex flex-wrap gap-2">{selectedProducts.map(product => <Button key={product.id} type="button" variant="outline" size="sm" onClick={() => setSelectedProducts(current => current.filter(p => p.id !== product.id))}>{product.name} ×</Button>)}</div>
            <ProductPicker locationId={createLocationId} selectedIds={selectedProducts.map(p => p.id)} onSelect={product => setSelectedProducts(current => [...current, product])} />
          </div>}
          <div>
            <label className="block text-sm font-medium mb-1">Notes</label>
            <Textarea aria-label="Count notes" value={createNotes} onChange={(e) => setCreateNotes(e.target.value)} rows={2} />
          </div>
          {createType === 'PARTIAL' && !selectedProducts.length && <p id="count-products-hint" className="text-xs text-muted-foreground">Select at least one product for a partial count.</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" type="button" onClick={() => setShowCreateModal(false)}>Cancel</Button>
            <Button variant="primary" type="submit" aria-describedby={createType === 'PARTIAL' && !selectedProducts.length ? 'count-products-hint' : undefined} disabled={createType === 'PARTIAL' && !selectedProducts.length}>Start Count</Button>
          </div>
        </form>
      </Modal>

      {/* Detail / Counting Modal */}
      <Modal
        isOpen={showDetailModal}
        onClose={() => { setRecordId(''); setSelectedCount(null); }}
        title={`Cycle Count ${selectedCount?.countNumber || ''}`}
      >
        {!selectedCount && (detailError ? <Alert tone="error" title={detailError} action={<Button variant="outline" onClick={() => setDetailRefresh(value => value + 1)}>Retry</Button>} /> : <LoadingState label="Loading details…" />)}
        {selectedCount && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
              <div>
                <p className="text-muted-foreground">Status</p>
                <Badge variant={statusVariant[selectedCount.status] || 'secondary'}>{formatEnumLabel(selectedCount.status)}</Badge>
              </div>
              <div>
                <p className="text-muted-foreground">Type</p>
                <p>{formatEnumLabel(selectedCount.type)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Location</p>
                <p>{locations.find(l => l.id === selectedCount.locationId)?.name || '\u2014'}</p>
              </div>
            </div>

            {/* Items */}
            {canManage && ['IN_PROGRESS', 'REVIEW'].includes(selectedCount.status) && staleItems.length > 0 && <div role="alert" className="p-3 rounded border border-warning bg-warning/10 space-y-2">
              <p>{staleItems.length} items changed since this count began. Recount these items before approval.</p>
              <Button variant="outline" onClick={() => setConfirmState({ title: 'Recount changed items?', message: 'Only changed items will have their entered counts cleared. Count those items again using the current stock snapshot.', confirmLabel: 'Prepare recount', action: handleRefresh })}>Recount changed items</Button>
            </div>}
            <div>
              <h4 className="text-sm font-medium mb-2">
                Items ({selectedCount.items.length})
                {selectedCount.status === 'IN_PROGRESS' && (
                  <span className="text-muted-foreground font-normal ml-2">
                    {uncountedItems ? `${uncountedItems} still to count` : 'All items counted'}{unsavedItems.length ? ` · ${unsavedItems.length} not saved yet` : ''}
                  </span>
                )}
              </h4>
              <div className="max-h-[300px] overflow-y-auto space-y-1">
                {selectedCount.items.map((item) => (
                  <div key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm p-2 bg-muted/50 rounded">
                    <span className="min-w-0 basis-full truncate sm:basis-0 sm:flex-1" title={item.product?.sku}>{item.product?.name || item.productId}</span>
                    <span className="ml-auto whitespace-nowrap text-right text-muted-foreground sm:ml-0">Expected: {item.expectedQty}</span>
                    {selectedCount.status === 'IN_PROGRESS' && canManage ? (
                      <div className="w-20 shrink-0"><Input
                        type="number"
                        inputMode="numeric"
                        min="0"
                        aria-label={'Count for ' + (item.product?.name || item.productId)}
                        value={itemCounts[item.id] ?? ''}
                        onChange={(e) => {
                          // A cleared field means "not counted yet", never zero.
                          const next = { ...itemCounts };
                          const parsed = Number.parseInt(e.target.value, 10);
                          if (e.target.value === '' || !Number.isFinite(parsed) || parsed < 0) delete next[item.id];
                          else next[item.id] = parsed;
                          setItemCounts(next);
                        }}
                        placeholder="Count"
                        className="text-right"
                      /></div>
                    ) : (
                      <>
                        <span className="ml-auto whitespace-nowrap text-right sm:ml-0">Counted: {item.countedQty ?? '\u2014'}</span>
                        {item.discrepancy !== null && item.discrepancy !== 0 && (
                          <span className={`w-16 text-right font-medium ${item.discrepancy > 0 ? 'text-success' : 'text-destructive'}`}>
                            {item.discrepancy > 0 ? '+' : ''}{item.discrepancy}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Summary for review/approved */}
            {(selectedCount.status === 'REVIEW' || selectedCount.status === 'APPROVED') && (
              <div className="p-3 bg-muted/50 rounded-lg text-sm">
                <p className="font-medium mb-1">Discrepancy Summary</p>
                <p className="text-muted-foreground">
                  Items with discrepancies: {selectedCount.items.filter(i => i.discrepancy && i.discrepancy !== 0).length} / {selectedCount.items.length}
                </p>
              </div>
            )}

            <div className="flex flex-wrap justify-end gap-2 pt-2">
              {selectedCount.status === 'IN_PROGRESS' && canManage && (
                <>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setConfirmState({
                      title: 'Cancel cycle count?',
                      message: 'Entered counts will be discarded and no inventory will be adjusted.',
                      destructive: true,
                      confirmLabel: 'Cancel Count',
                      action: handleCancel,
                    })}
                  >
                    <XCircle className="w-4 h-4 mr-1" /> Cancel
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleSaveItems} disabled={busy || !unsavedItems.length}>
                    <Eye className="w-4 h-4 mr-1" /> Save Progress
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={busy || uncountedItems > 0}
                    title={uncountedItems > 0 ? `${uncountedItems} item${uncountedItems === 1 ? '' : 's'} still need a count` : undefined}
                    onClick={() => setConfirmState({
                      title: 'Submit for review?',
                      message: unsavedItems.length ? 'Your entered counts will be saved, then the count goes to review.' : 'The count goes to review; counts can no longer be changed.',
                      confirmLabel: 'Submit',
                      action: handleSubmit,
                    })}
                  >
                    <Send className="w-4 h-4 mr-1" /> Submit for Review
                  </Button>
                </>
              )}
              {selectedCount.status === 'REVIEW' && isAdmin && !isReadOnly && (
                <>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setConfirmState({
                      title: 'Reject cycle count?',
                      message: 'The count will be cancelled and no inventory will be adjusted.',
                      destructive: true,
                      confirmLabel: 'Reject',
                      action: handleCancel,
                    })}
                  >
                    Reject
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => setConfirmState({
                      title: 'Approve cycle count?',
                      message: `${selectedCount.items.filter(i => i.discrepancy && i.discrepancy !== 0).length} item(s) with discrepancies will have their inventory adjusted.`,
                      confirmLabel: 'Approve & Adjust',
                      action: handleApprove,
                    })}
                  >
                    <CheckCircle className="w-4 h-4 mr-1" /> Approve & Adjust
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={confirmState !== null}
        onClose={() => setConfirmState(null)}
        onConfirm={() => confirmState?.action()}
        title={confirmState?.title || ''}
        message={confirmState?.message || ''}
        destructive={confirmState?.destructive}
        confirmLabel={confirmState?.confirmLabel}
      />
    </ManagementPage>
  );
};
