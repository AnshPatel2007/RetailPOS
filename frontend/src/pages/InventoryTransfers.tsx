import { ManagementPage } from '@/components/common/Workspace';
import { Select } from '@/components/ui/Select';
import { formatEnumLabel, formatDate, formatDateTime } from '@/lib/utils';
import { useLegacyPageRefresh } from '@/hooks/useLegacyPageRefresh';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ArrowLeftRight, Plus, Truck, XCircle } from 'lucide-react';
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
import { inventoryTransferService, apiErrorMessage } from '@/services/api';
import { useAuthStore } from '@/store/authStore';
import { useEffectiveLocation } from '@/hooks/useEffectiveLocation';
import toast from 'react-hot-toast';
import { useUrlFilter, useUrlPage, useResetUrlFilters } from '@/hooks/useUrlFilter';
import { ProductPicker, PickableProduct } from '@/components/common/ProductPicker';
import { can } from '@/lib/capabilities';
import { Transfer, TransferReceiptKind, outstandingTransfer, returningTransfer, transferProductName, transferRetryKey, pendingTransferReceipt } from '@/types/transfers';
import { TransferReceiptModal } from '@/components/inventory/TransferReceiptModal';
import { TransferHistory } from '@/components/inventory/TransferHistory';
import { Spinner } from '@/components/ui/LoadingState';

interface Location {
  id: string;
  name: string;
}


const statusColors: Record<string, string> = {
  PENDING: 'bg-warning/10 text-warning',
  IN_TRANSIT: 'bg-info/10 text-info',
  PARTIALLY_RECEIVED: 'bg-warning/10 text-warning',
  RETURN_IN_TRANSIT: 'bg-warning/10 text-warning',
  CLOSED: 'bg-success/10 text-success',
  RECEIVED: 'bg-success/10 text-success',
  CANCELLED: 'bg-destructive/10 text-destructive',
};

export const InventoryTransfers: React.FC = () => {
  const { user } = useAuthStore();
  const { isReadOnly, locationId } = useEffectiveLocation();
  // Mutating routes are ADMIN/MANAGER only — hide the buttons cashiers can't use
  const canManage =
    !isReadOnly &&
    can(user?.role, 'inventory.manage');
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [locations, setLocations] = useState<Location[]>([]);
  const [products, setProducts] = useState<PickableProduct[]>([]);
  const [showProductPicker, setShowProductPicker] = useState(false);
  const requestVersion = useRef(0);
  const [statusFilter, setStatusFilter] = useUrlFilter('status');
  const [page, setPage] = useUrlPage();
  const [total, setTotal] = useState(0);

  // Create modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const fromLocationId = locationId || '';
  const [source, setSource] = useState<Location | null>(null);
  const [saving, setSaving] = useState(false);
  const [toLocationId, setToLocationId] = useState('');
  const [transferItems, setTransferItems] = useState<{ productId: string; quantity: number }[]>([]);
  const [notes, setNotes] = useState('');

  // Detail modal
  const [recordId, setRecordId] = useUrlFilter('record');
  const [detailRefresh, setDetailRefresh] = useState(0);
  const [detailError, setDetailError] = useState('');
  const showDetailModal = !!recordId;
  const resetUrlFilters = useResetUrlFilters();
  const priorLocation = useRef(locationId);
  useEffect(() => {
    if (priorLocation.current !== locationId) { resetUrlFilters(); priorLocation.current = locationId; }
  }, [locationId, resetUrlFilters]);
  const [selectedTransfer, setSelectedTransfer] = useState<Transfer | null>(null);
  const [receiptKind, setReceiptKind] = useState<TransferReceiptKind | null>(null);

  const fetchTransfers = useCallback(async (quiet = false, active: () => boolean = () => true, signal?: AbortSignal) => {
    const version = ++requestVersion.current;
    if (!quiet) { setLoading(true); setLoadError(''); }
    try {
      const { data } = await inventoryTransferService.getAll({ locationId, page, limit: 20, status: statusFilter || undefined }, signal);
      if (version !== requestVersion.current || !active()) return;
      setLoadError('');
      setTransfers(data.data);
      setTotal(data.total);
    } catch (failure) {
      if (quiet) throw failure;
      if (version === requestVersion.current) setLoadError('Unable to load transfers. Try again.');
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [page, statusFilter, locationId]);

  useEffect(() => {
    fetchTransfers();
    return () => { requestVersion.current++; };
  }, [fetchTransfers]);

  useEffect(() => {
    let cancelled = false;
    setSource(null); setLocations([]); setTransfers([]);
    setShowCreateModal(false); setSelectedTransfer(null); setReceiptKind(null);
    setToLocationId(''); setTransferItems([]); setProducts([]); setNotes(''); setShowProductPicker(false);
    if (!locationId) return;
    inventoryTransferService.options(locationId).then(({ data }) => {
      if (!cancelled) { setSource(data.data.source); setLocations(data.data.destinations); }
    }).catch((err) => { if (!cancelled) toast.error(err.response?.data?.error || 'Could not load connected stores'); });
    return () => { cancelled = true; };
  }, [locationId]);

  const selectProduct = (product: PickableProduct) => {
    if (transferItems.length >= 100) { toast.error('Use up to 100 products per transfer'); return; }
    setProducts(current => [...current.filter(p => p.id !== product.id), product]);
    setTransferItems(current => current.some(i => i.productId === product.id) ? current : [...current, { productId: product.id, quantity: 1 }]);
  };

  const removeItem = (index: number) => {
    setTransferItems(transferItems.filter((_, i) => i !== index));
  };

  const updateItem = (index: number, field: string, value: string | number) => {
    setTransferItems(transferItems.map((item, i) =>
      i === index ? { ...item, [field]: value } : item
    ));
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const validItems = transferItems.filter(i => i.productId && i.quantity > 0);
    if (!validItems.length) {
      toast.error('Add at least one item');
      return;
    }
    if (saving) return;
    if (validItems.length !== transferItems.length || new Set(validItems.map(i => i.productId)).size !== validItems.length) { toast.error('Select each product once'); return; }
    if (validItems.some(i => !Number.isInteger(i.quantity) || i.quantity > (products.find(p => p.id === i.productId)?.stockQuantity ?? 0))) { toast.error('Quantity exceeds available stock'); return; }
    setSaving(true);
    try {
      await inventoryTransferService.create({
        fromLocationId,
        toLocationId,
        items: validItems,
        notes: notes || undefined,
      });
      toast.success('Transfer created');
      setShowCreateModal(false);
      resetCreateForm();
      fetchTransfers();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to create transfer');
    } finally { setSaving(false); }
  };

  const resetCreateForm = () => {

    setToLocationId('');
    setProducts([]); setShowProductPicker(false);
    setTransferItems([]);
    setNotes('');
  };

  // One shared confirm dialog for ship/receive/cancel
  const [confirmState, setConfirmState] = useState<{
    title: string;
    message: string;
    destructive?: boolean;
    confirmLabel?: string;
    action: () => void;
  } | null>(null);

  const handleShip = async (id: string) => {
    try {
      await inventoryTransferService.ship(id);
      toast.success('Transfer shipped');
      fetchTransfers();
      setRecordId('');
    } catch (err: any) {
      toast.error(apiErrorMessage(err, 'Failed to ship'));
    }
  };

  const handleCancel = async (id: string) => {
    try {
      await inventoryTransferService.cancel(id);
      toast.success('Transfer cancelled');
      fetchTransfers();
      setRecordId('');
    } catch (err: any) {
      toast.error(apiErrorMessage(err, 'Failed to cancel'));
    }
  };

  const viewDetail = (record: { id: string }) => { setRecordId(record.id); setDetailRefresh(value => value + 1); };
  useEffect(() => {
    let active = true;
    setSelectedTransfer(null); setDetailError('');
    if (recordId) inventoryTransferService.getById(recordId).then(({ data }) => {
      if (!active) return;
      setSelectedTransfer(data.data);
    }).catch(() => { if (active) setDetailError('Unable to load this record. It may no longer be available to this store.'); });
    return () => { active = false; };
  }, [recordId, locationId, detailRefresh]);
  const totalPages = Math.ceil(total / 20);

  const autoRefresh = useLegacyPageRefresh((current, signal) => fetchTransfers(true, current, signal), { key: JSON.stringify([locationId, page, statusFilter]), paused: loading });

  return (
    <ManagementPage className="">
      <PageHeader
        title="Inventory Transfers"
        secondaryTabs={<PageTabs secondary label="Transfer status" value={statusFilter} onChange={setStatusFilter}
          items={["","PENDING","IN_TRANSIT","PARTIALLY_RECEIVED","RETURN_IN_TRANSIT","RECEIVED","CLOSED","CANCELLED"].map(status => ({ id: status, label: status ? formatEnumLabel(status) : 'All' }))} />}
        subtitle="Transfer stock between locations"
        actions={canManage && !!fromLocationId && (
          <Button variant="primary" onClick={() => setShowCreateModal(true)}>
            <Plus className="w-4 h-4 mr-2" />
            New Transfer
          </Button>
        )}
      />
      {autoRefresh.notice}

      {!isReadOnly && source && locations.length === 0 && <p className="mb-4 text-sm text-muted-foreground">No connected destination stores. A super-admin can link partner stores in Store Management. Each store keeps its own staff sign-ins.</p>}
      {!fromLocationId && <p className="mb-4 text-sm text-muted-foreground">Sign in to a store account to send stock. Super-admins manage store connections in Store Management.</p>}

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle>Transfers</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <Spinner size="lg" />
            </div>
          ) : loadError ? (<div role="alert"><p>{loadError}</p><Button className="mt-3" variant="outline" onClick={() => void fetchTransfers()}>Retry</Button></div>) : transfers.length === 0 ? (
            <EmptyState
              icon={ArrowLeftRight}
              title="No transfers found"
              hint={statusFilter ? 'Try a different status filter' : 'Create a transfer to move stock between locations'}
              action={canManage && !!fromLocationId && !statusFilter ? (
                <Button variant="primary" onClick={() => setShowCreateModal(true)}>
                  <Plus className="w-4 h-4 mr-2" />New Transfer
                </Button>
              ) : undefined}
            />
          ) : (
            <Table scrollLabel="Inventory Transfers records">
              <TableHeader>
                <TableRow>
                  <TableHead>Transfer #</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead>To</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transfers.map((t) => (
                  <TableRow key={t.id} className="cursor-pointer" onClick={() => viewDetail(t)}>
                    <TableCell className="font-medium"><button type="button" className="text-left hover:underline focus-visible:underline" onClick={(event) => { event.stopPropagation(); viewDetail(t); }}>{t.transferNumber}</button></TableCell>
                    <TableCell>{t.fromLocation?.name || t.fromLocationId}</TableCell>
                    <TableCell>{t.toLocation?.name || t.toLocationId}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{t.items?.length ?? '\u2014'}</TableCell>
                    <TableCell>
                      <Badge className={statusColors[t.status] || ''}>{formatEnumLabel(t.status)}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(t.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} totalItems={total} itemName="transfers" />
        </CardContent>
      </Card>

      {/* Create Modal */}
      <Modal isOpen={showCreateModal} onClose={() => { if (!saving) { setShowCreateModal(false); resetCreateForm(); } }} title="New Inventory Transfer" size="lg">
        <form onSubmit={handleCreate} className="space-y-4">
          <fieldset disabled={saving} className="space-y-4">
          <p className="text-sm text-muted-foreground">A draft does not reserve stock. Available quantities are checked again when you ship.</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">From Location *</label>
              <Input value={source?.name || fromLocationId} readOnly aria-label="Source store" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">To Location *</label>
              <Select
                aria-label="Destination store"
                value={toLocationId}
                onChange={(e) => setToLocationId(e.target.value)}
                required
                className="w-full px-3 py-2 bg-background border border-input rounded-md text-foreground"
              >
                <option value="">Select...</option>
                {locations.filter(l => l.id !== fromLocationId).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium">Items</label>
              <button type="button" onClick={() => setShowProductPicker(current => !current)} className="text-xs text-primary hover:underline">+ Add Item</button>
            </div>
            {showProductPicker && <ProductPicker locationId={fromLocationId} selectedIds={transferItems.map(item => item.productId)} onSelect={selectProduct} inStockOnly />}
            {transferItems.length === 0 && (
              <p id="transfer-items-hint" className="text-sm text-muted-foreground text-center py-3 border border-dashed border-border rounded-lg">
                Add at least one product to create a transfer.
              </p>
            )}
            {transferItems.map((item, i) => (
              <div key={i} className="flex gap-2 mb-2">
                <div className="min-w-0 flex-1"><p className="text-sm font-medium">{products.find(p => p.id === item.productId)?.name}</p><p className="text-xs text-muted-foreground">{products.find(p => p.id === item.productId)?.stockQuantity} available</p></div>
                <Input
                  type="number"
                  min="1"
                  step="1"
                  aria-label={'Quantity for ' + products.find(p => p.id === item.productId)?.name}
                  required
                  max={products.find(p => p.id === item.productId)?.stockQuantity ?? 0}
                  value={item.quantity}
                  onChange={(e) => updateItem(i, 'quantity', Number(e.target.value))}
                  className="w-20"
                />
                <Button variant="ghost" size="sm" type="button" aria-label={'Remove ' + products.find(p => p.id === item.productId)?.name} onClick={() => removeItem(i)} className="text-destructive hover:text-destructive">
                  <XCircle className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-input rounded-md text-foreground text-sm"
              rows={2}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" type="button" disabled={saving} onClick={() => { setShowCreateModal(false); resetCreateForm(); }}>Cancel</Button>
            <Button variant="primary" type="submit" aria-describedby={!transferItems.length ? 'transfer-items-hint' : undefined} disabled={saving || !locations.length || !transferItems.length}>{saving ? 'Creating...' : 'Create Transfer'}</Button>
          </div>
          </fieldset>
        </form>
      </Modal>

      {/* Detail Modal */}
      <Modal isOpen={showDetailModal} onClose={() => { setRecordId(''); setSelectedTransfer(null); }} title="Transfer details" size="lg">
        {!selectedTransfer && (detailError ? <div role="alert"><p>{detailError}</p><Button variant="outline" onClick={() => setDetailRefresh(value => value + 1)}>Retry</Button></div> : <p role="status">Loading details...</p>)}
        {selectedTransfer && (
          <div className="space-y-4">
            <p className="text-sm font-mono break-all">{selectedTransfer.transferNumber}</p>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Status</p>
                <Badge className={statusColors[selectedTransfer.status] || ''}>{formatEnumLabel(selectedTransfer.status)}</Badge>
              </div>
              <div>
                <p className="text-muted-foreground">Created</p>
                <p>{formatDateTime(selectedTransfer.createdAt)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">From</p>
                <p>{selectedTransfer.fromLocation?.name || selectedTransfer.fromLocationId}</p>
              </div>
              <div>
                <p className="text-muted-foreground">To</p>
                <p>{selectedTransfer.toLocation?.name || selectedTransfer.toLocationId}</p>
              </div>
            </div>

            {selectedTransfer.notes && (
              <p className="text-sm text-muted-foreground">Notes: {selectedTransfer.notes}</p>
            )}

            <div>
              <h4 className="text-sm font-medium mb-2">Items ({selectedTransfer.items.length})</h4>
              <div className="space-y-1">
                {selectedTransfer.items.map(item => <div key={item.id} className="rounded border p-3 text-sm space-y-2">
                  <div className="flex justify-between gap-3"><div><p className="font-medium">{transferProductName(item)}</p><p className="text-xs text-muted-foreground">{item.productSnapshot?.sku || item.product?.sku}</p></div><span className="tabular-nums">{item.quantity} {selectedTransfer.shippedAt ? 'shipped' : 'planned'}</span></div>
                  {selectedTransfer.status === 'PENDING' ? <p className="text-xs text-muted-foreground">Draft quantity; stock is not reserved.</p> : <div className="grid grid-cols-2 gap-2 text-xs tabular-nums">
                    <p>{item.receivedQty} accepted at destination</p><p>{outstandingTransfer(item)} unresolved at destination</p>
                    {item.damagedQty > 0 && <p>{item.damagedQty} damaged at destination</p>}{item.missingQty > 0 && <p>{item.missingQty} missing at destination</p>}
                    {item.sentBackQty > 0 && <><p>{returningTransfer(item)} returning to source</p><p>{item.returnedQty} restored at source</p></>}
                    {item.returnDamagedQty > 0 && <p>{item.returnDamagedQty} returned damaged</p>}{item.returnMissingQty > 0 && <p>{item.returnMissingQty} missing on return</p>}
                  </div>}
                  {item.destinationProduct && <p className="text-xs text-muted-foreground">Destination product: {item.destinationProduct.name} ({item.destinationProduct.sku})</p>}
                </div>)}

              </div>
            </div>

            <TransferHistory key={selectedTransfer.id} transfer={selectedTransfer} />
            <div className="flex flex-wrap justify-end gap-2 pt-2">
              {selectedTransfer.status === 'PENDING' && canManage && fromLocationId === selectedTransfer.fromLocationId && (
                <>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setConfirmState({
                      title: 'Cancel transfer?',
                      message: 'This transfer has not shipped yet — no stock will change.',
                      destructive: true,
                      confirmLabel: 'Cancel Transfer',
                      action: () => handleCancel(selectedTransfer.id),
                    })}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => setConfirmState({
                      title: 'Ship transfer?',
                      message: 'Stock will be deducted from the source location.',
                      confirmLabel: 'Ship',
                      action: () => handleShip(selectedTransfer.id),
                    })}
                  >
                    <Truck className="w-4 h-4 mr-1" /> Ship
                  </Button>
                </>
              )}
              {canManage && fromLocationId === selectedTransfer.fromLocationId && <>
                {((['IN_TRANSIT', 'PARTIALLY_RECEIVED'].includes(selectedTransfer.status) && selectedTransfer.items.some(item => outstandingTransfer(item) > 0)) || pendingTransferReceipt(transferRetryKey(selectedTransfer, user?.id, 'REQUEST_RETURN'))) && <Button variant="outline" onClick={() => setReceiptKind('REQUEST_RETURN')}>Request return</Button>}
                {(selectedTransfer.items.some(item => returningTransfer(item) > 0) || pendingTransferReceipt(transferRetryKey(selectedTransfer, user?.id, 'SOURCE_RETURN'))) && <Button onClick={() => setReceiptKind('SOURCE_RETURN')}>Record returned goods</Button>}
              </>}
              {canManage && fromLocationId === selectedTransfer.toLocationId && ((['IN_TRANSIT', 'PARTIALLY_RECEIVED'].includes(selectedTransfer.status) && selectedTransfer.items.some(item => outstandingTransfer(item) > 0)) || pendingTransferReceipt(transferRetryKey(selectedTransfer, user?.id, 'RECEIVE'))) && <Button onClick={() => setReceiptKind('RECEIVE')}>Receive or resolve delivery</Button>}

            </div>
          </div>
        )}
      </Modal>

      {receiptKind && selectedTransfer && <TransferReceiptModal key={selectedTransfer.id + receiptKind} transfer={selectedTransfer} kind={receiptKind} onClose={() => setReceiptKind(null)} onSaved={() => {
        setReceiptKind(null); fetchTransfers(); viewDetail(selectedTransfer); toast.success('Transfer updated');
      }} />}

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
