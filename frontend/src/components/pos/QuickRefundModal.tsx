import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { saleService } from '@/services/api';
import { formatCurrency } from '@/lib/utils';
import { Search, AlertTriangle, RotateCcw, Minus, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/store/authStore';
import { RefundTenderEditor } from './RefundTenderEditor';
import { refundTenderSelection, RefundTenderEdits, RefundTenderOption } from '@/services/refundTenderSelection';
import { cashOperationKey, cashOperationRejected, hasExternalRefundEvidence, readCashOperation, PendingCashOperation } from '@/services/pendingCashOperation';
import { sessionGeneration } from '@/services/sessionGeneration';
import { invalidateScopedQueries } from '@/hooks/useScopedQuery';
import { RecentTransactions } from './RecentTransactions';
import { hardware } from '@/services/hardware';
import { isSaleReference, normalizeSaleReference } from '@/lib/receiptReference';

interface SaleItem {
  productName?: string;
  pointsRedeemed?: number | null;
  pointsEarned?: number | null;
  id: string;
  quantity: number;
  price: number;
  discount: number;
  tax: number;
  total: number;
  product: { name: string; sku: string };
  /** Set when the line was a pack (e.g. a 12-pack) of the product. */
  sellingUnitId?: string | null;
}

interface RefundItemRecord {
  amount: number;
  pointsRestored?: number | null;
  pointsReversed?: number | null;
  saleItemId: string;
  quantity: number;
}

interface RefundRecord {
  id: string;
  amount: number;
  reason: string;
  createdAt: string;
  method?: string | null;
  tenders?: { method: string; amount: number }[] | null;
  items?: RefundItemRecord[];
}

interface SalePaymentRecord {
  paymentMethod: string;
  reference?: string | null;
}

interface SaleDetails {
  refundTenderOptions?: RefundTenderOption[];
  refundTenderError?: string | null;
  pricingVersion?: number | null;
  id: string;
  saleNumber: string;
  total: number;
  paymentMethod: string;
  status: string;
  createdAt: string;
  items: SaleItem[];
  customer?: { firstName: string; lastName: string } | null;
  refunds?: RefundRecord[];
  payments?: SalePaymentRecord[];
}

type RefundMode = 'items' | 'amount';


interface QuickRefundModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRefundComplete?: () => void;
  initialSaleId?: string;
}

export const QuickRefundModal: React.FC<QuickRefundModalProps> = ({
  isOpen,
  onClose,
  onRefundComplete,
  initialSaleId,
}) => {
  const [saleNumber, setSaleNumber] = useState('');
  const [sale, setSale] = useState<SaleDetails | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [refundReason, setRefundReason] = useState('');
  const [refundAmount, setRefundAmount] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [mode, setMode] = useState<RefundMode>('items');
  const [refundQtys, setRefundQtys] = useState<Record<string, number>>({});
  const [restock, setRestock] = useState(true);
  // Pack lines whose packs came back opened (default: returned unopened).
  const [openedPacks, setOpenedPacks] = useState<Record<string, boolean>>({});
  const [tenderEdits, setTenderEdits] = useState<RefundTenderEdits>({});
  const user = useAuthStore(state => state.user);
  const pendingKey = cashOperationKey('refund', user?.id, user?.locationId);
  const [pending, setPending] = useState<PendingCashOperation | null>(null);
  const [storageError, setStorageError] = useState(false);
  const [operationError, setOperationError] = useState('');
  const flight = useRef(false), active = useRef(false), searchSequence = useRef(0);
  const searchAbort = useRef<AbortController>();
  const readPending = useCallback(() => {
    const saved = readCashOperation(pendingKey);
    if (saved && (!saved.saleId || !Number.isFinite(saved.amount) || saved.amount < 0 || !saved.payload?.idempotencyKey || typeof saved.label !== 'string')) throw new Error('Invalid refund recovery data');
    return saved;
  }, [pendingKey]);
  const refreshStorage = useCallback(() => {
    try { setPending(readPending()); setStorageError(false); setOperationError(''); }
    catch { setStorageError(true); setOperationError('Saved refund data cannot be read. Restore browser storage and reconcile it before another refund.'); }
  }, [readPending]);
  useEffect(() => {
    active.current = true; refreshStorage();
    const changed = (event: StorageEvent) => { if (!flight.current && (event.key === pendingKey || event.key === null)) refreshStorage(); };
    window.addEventListener('storage', changed);
    return () => { active.current = false; searchSequence.current++; window.removeEventListener('storage', changed); };
  }, [pendingKey, refreshStorage]);
  useEffect(() => { if (isOpen) refreshStorage(); }, [isOpen, refreshStorage]);
  useEffect(() => { window.dispatchEvent(new Event('pos-reversal-recovery')); }, [pending, storageError]);
  useEffect(() => { setSale(null); setRefundQtys({}); setTenderEdits({}); setRefundReason(''); setRefundAmount(''); setIsProcessing(false); }, [pendingKey]);

  const submitRefund = async (operation: PendingCashOperation) => {
    if (flight.current || storageError) return;
    const generation = sessionGeneration(), current = () => active.current && generation === sessionGeneration();
    const externalEvidence = hasExternalRefundEvidence(operation.payload);
    let recovering = false, confirmed = false;
    try {
      const saved = readPending(); recovering = !!saved;
      if (saved && saved.payload.idempotencyKey !== operation.payload.idempotencyKey) { setPending(saved); setOperationError('Review and confirm the saved refund before another request.'); return; }
      if (!saved && (localStorage.getItem(`pos-pending-bulk-void:${user?.locationId}:${user?.id}`) || localStorage.getItem(`pos-pending-void:${user?.locationId}:${user?.id}`) || localStorage.getItem(`pos-pending-operation:bulk-refund:${user?.locationId}:${user?.id}`))) { setOperationError('Confirm the saved reversal before recording another refund.'); return; }
      localStorage.setItem(pendingKey, JSON.stringify(operation)); setPending(operation);
    } catch { setStorageError(true); setOperationError('Nothing was sent. Restore browser recovery storage before continuing.'); return; }
    flight.current = true;
    setIsProcessing(true);
    setOperationError('');
    try {
      const result = await saleService.refund(operation.saleId!, operation.payload);
      confirmed = true;
      if (readPending()?.payload.idempotencyKey === operation.payload.idempotencyKey) localStorage.removeItem(pendingKey);
      if (!current()) return;
      setPending(readPending()); invalidateScopedQueries();
      const savedRefund = result.data.refund || result.data.data?.refund;
      toast.success(`Return recorded: ${formatCurrency(operation.amount)}${savedRefund?.pointsRestored != null ? `, ${savedRefund.pointsRestored} points restored` : ''}. Pay the customer only once.`);
      onRefundComplete?.(); handleReset(); onClose();
    } catch (error: any) {
      if (!current()) return;
      if (confirmed) { setStorageError(true); setOperationError('The refund is confirmed, but its recovery record could not be cleared. Restore storage and retry confirmation.'); return; }
      if (!recovering && !externalEvidence && cashOperationRejected(error)) {
        try { if (readPending()?.payload.idempotencyKey === operation.payload.idempotencyKey) localStorage.removeItem(pendingKey); setPending(readPending()); }
        catch { setStorageError(true); }
      }
      const message = (error.response?.data?.error || 'Refund result is unconfirmed. Retry the saved request before issuing another refund.')
        + (externalEvidence && cashOperationRejected(error) ? ' The terminal refund evidence remains saved. Retry this exact request; if the conflict persists, an owner must reconcile it. Do not refund the terminal again.' : '');
      setOperationError(message); toast.error(message);
    } finally { flight.current = false; if (current()) setIsProcessing(false); }
  };

  useEffect(() => {
    if (!isOpen || !initialSaleId) return;
    void handleSearch('', initialSaleId);
    return () => { searchAbort.current?.abort(); searchSequence.current++; };
  }, [isOpen, initialSaleId, pendingKey]);

  const handleSearch = async (reference = saleNumber, id?: string) => {
    if ((!reference.trim() && !id) || pending || isProcessing || storageError) return;
    searchAbort.current?.abort();
    const abort = new AbortController(); searchAbort.current = abort;
    const sequence = ++searchSequence.current, generation = sessionGeneration();
    const current = () => sequence === searchSequence.current && generation === sessionGeneration() && active.current;
    setIsSearching(true);
    setSale(null); setRefundReason(''); setRefundAmount('');
    setRefundQtys({});
    setMode('items');
    setRestock(true);
    setOpenedPacks({});
    setTenderEdits({});
    try {
      let saleId = id;
      if (!saleId) {
        const response = await saleService.getAll({ saleNumber: normalizeSaleReference(reference) }, abort.signal);
        if (!current()) return;
        const sales = response.data.data || [];
        if (sales.length !== 1) { toast.error(sales.length ? 'Enter the full receipt number' : 'Sale not found'); return; }
        saleId = sales[0].id;
      }
      const detailResponse = await saleService.getById(saleId!, abort.signal);
      if (!current()) return;
      const saleData = detailResponse.data.data;
      setSale(saleData); setSaleNumber(saleData.saleNumber);
      // Default to the remaining refundable amount
      const previouslyRefunded = (saleData.refunds || []).reduce((s: number, r: RefundRecord) => s + r.amount, 0);
      const refundable = Math.round((saleData.total - previouslyRefunded) * 100) / 100;
      setRefundAmount(Math.max(0, refundable).toString());
    } catch {
      if (current()) toast.error('Failed to find sale');
    } finally {
      if (current()) setIsSearching(false);
    }
  };

  useEffect(() => {
    if (!isOpen) { handleReset(); return; }
    const scan = (value: string) => {
      if (isSaleReference(value)) void handleSearch(value);
      else toast.error('Scan a receipt barcode to find the original sale');
    };
    hardware.scanner.onScan(scan);
    return () => { hardware.scanner.offScan(scan); searchAbort.current?.abort(); searchSequence.current++; };
  }, [isOpen, pending, isProcessing, storageError, pendingKey]);

  const getRefundableAmount = () => {
    if (!sale) return 0;
    const previouslyRefunded = (sale.refunds || []).reduce((s, r) => s + r.amount, 0);
    return Math.round((sale.total - previouslyRefunded) * 100) / 100;
  };

  // Quantity of a sale item already refunded via item-level refunds
  const getRefundedQty = (saleItemId: string) => {
    if (!sale?.refunds) return 0;
    return sale.refunds.reduce(
      (sum, r) => sum + (r.items || [])
        .filter((ri) => ri.saleItemId === saleItemId)
        .reduce((s, ri) => s + ri.quantity, 0),
      0
    );
  };

  const getRefundableQty = (item: SaleItem) => item.quantity - getRefundedQty(item.id);

  const selectedReturn = (item: SaleItem) => {
    const quantity = refundQtys[item.id] || 0;
    const previous = (sale?.refunds || []).flatMap(r => r.items || []).filter(r => r.saleItemId === item.id);
    const returned = getRefundedQty(item.id);
    const share = (total: number) => Number(BigInt(total) * BigInt(returned + quantity) / BigInt(item.quantity)) - Number(BigInt(total) * BigInt(returned) / BigInt(item.quantity));
    const remainingCash = Math.round(item.total * 100) - previous.reduce((n, r) => n + Math.round(r.amount * 100), 0);
    const final = quantity > 0 && quantity + returned === item.quantity;
    const amount = (sale?.pricingVersion ? final ? remainingCash : Math.min(remainingCash, share(Math.round(item.total * 100))) : share(Math.round(item.total * 100))) / 100;
    const remainingPoints = (item.pointsRedeemed || 0) - previous.reduce((n, r) => n + (r.pointsRestored || 0), 0);
    const points = final ? remainingPoints : Math.max(0, Math.min(remainingPoints, share(item.pointsRedeemed || 0)));
    return { amount: quantity ? amount : 0, points: quantity ? points : 0 };
  };
  const getItemsAmount = () => Math.round((sale?.items || []).reduce((n, item) => n + selectedReturn(item).amount, 0) * 100) / 100;
  const restoredPoints = (sale?.items || []).reduce((n, item) => n + selectedReturn(item).points, 0);

  const setItemQty = (item: SaleItem, qty: number) => {
    const clamped = Math.max(0, Math.min(qty, getRefundableQty(item)));
    setRefundQtys((prev) => ({ ...prev, [item.id]: clamped }));
  };

  const selectAllItems = () => {
    if (!sale) return;
    const all: Record<string, number> = {};
    sale.items.forEach((item) => { all[item.id] = getRefundableQty(item); });
    setRefundQtys(all);
  };

  const effectiveAmount = mode === 'items' ? getItemsAmount() : (parseFloat(refundAmount) || 0);
  const hasSelectedItems = Object.values(refundQtys).some((q) => q > 0);
  const tenderSelection = refundTenderSelection(sale?.refundTenderOptions || [], effectiveAmount, tenderEdits);

  const handleRefund = async () => {
    if (!sale || isProcessing || pending) return;
    const maxRefundable = getRefundableAmount();
    if (effectiveAmount < 0 || (effectiveAmount === 0 && !(mode === 'items' && hasSelectedItems && sale.pricingVersion)) || effectiveAmount > maxRefundable + 0.001) {
      toast.error(effectiveAmount > maxRefundable
        ? `Max refundable: ${formatCurrency(maxRefundable)}`
        : 'Select items or enter a valid amount');
      return;
    }

    if (sale.refundTenderError || tenderSelection.invalid) { toast.error(sale.refundTenderError || 'Review original-tender amounts and terminal references'); return; }
    const methodLabel = tenderSelection.tenders.map(part => part.method.replace(/_/g, ' ')).join(' and ') || 'no monetary payout';
    if (!window.confirm(`Refund ${formatCurrency(effectiveAmount)} to ${methodLabel.toLowerCase()} for sale #${sale.saleNumber}?`)) {
      return;
    }

      const payload: any = {
        expectedAmount: effectiveAmount,
        reason: refundReason || 'Refund from POS',
        refundTenders: tenderSelection.tenders,
        idempotencyKey: crypto.randomUUID(),
      };
      if (mode === 'items') {
        payload.items = Object.entries(refundQtys)
          .filter(([, qty]) => qty > 0)
          .map(([saleItemId, quantity]) => ({ saleItemId, quantity,
            ...(restock && sale.items.find(item => item.id === saleItemId)?.sellingUnitId ? { restockAsSealed: !openedPacks[saleItemId] } : {}) }));
        payload.restock = restock;
      } else {
        payload.amount = effectiveAmount;
      }
      await submitRefund({ saleId: sale.id, label: sale.saleNumber, amount: effectiveAmount, payload });
  };

  const handleReset = () => {
    searchAbort.current?.abort(); setIsSearching(false);
    searchSequence.current++;
    setSaleNumber('');
    setSale(null);
    setRefundReason('');
    setRefundAmount('');
    setRefundQtys({});
    setMode('items');
    setRestock(true);
    setOpenedPacks({});
    setTenderEdits({});
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => { if (!isProcessing) { handleReset(); onClose(); } }}
      title="Quick Refund"
      size="md"
    >
      <div className="space-y-4">
        {operationError && <p role="alert" className="text-sm text-destructive">{operationError}</p>}
        {storageError && <Button onClick={refreshStorage}>Retry recovery storage</Button>}
        {pending && <div role="status" className="p-3 rounded-lg border border-warning/40 bg-warning/10 space-y-2">
          <p className="text-sm">Saved refund: {formatCurrency(pending.amount)} for {pending.label}. Confirm this request before starting another refund. Do not pay the customer twice.</p>
          {hasExternalRefundEvidence(pending.payload) && <p className="text-sm">External card refund evidence is saved. Retry this exact POS record. A persistent conflict requires owner review; do not refund the terminal again.</p>}
          <Button onClick={() => submitRefund(pending)} disabled={isProcessing || storageError}>Retry saved refund</Button>
        </div>}
        {isSearching && <p role="status">Loading sale...</p>}
        {/* Sale lookup */}
        <div data-receipt-lookup className="flex gap-2">
          <Input
            type="text"
            placeholder="Enter sale number..."
            aria-label="Receipt number"
            value={saleNumber}
            onChange={(e) => setSaleNumber(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleSearch(); } }}
            autoFocus
          />
          <Button variant="outline" aria-label="Find sale" onClick={() => handleSearch()} disabled={isSearching || !!pending || storageError}>
            <Search className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Scan the receipt, enter its number, or choose a recent sale.</p>
        {!sale && <RecentTransactions initiallyExpanded disabled={isSearching || !!pending || storageError} onViewReceipt={id => handleSearch('', id)} />}

        {/* Sale details */}
        {sale && (
          <>
            <div className="flex justify-end"><Button type="button" variant="ghost" onClick={handleReset} disabled={isProcessing || !!pending}>Choose another sale</Button></div>
            <Card className={`p-4 ${sale.status === 'REFUNDED' ? 'border-destructive/50' : ''}`}>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="font-medium break-all min-w-0">#{sale.saleNumber}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    sale.status === 'COMPLETED' ? 'bg-success/10 text-success' :
                    sale.status === 'REFUNDED' ? 'bg-destructive/10 text-destructive' :
                    'bg-muted text-muted-foreground'
                  }`}>
                    {sale.status}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {new Date(sale.createdAt).toLocaleString()} · {sale.paymentMethod.replace(/_/g, ' ')}
                  {sale.customer && ` · ${sale.customer.firstName} ${sale.customer.lastName}`}
                </p>
                <div className="border-t pt-2 flex justify-between font-bold">
                  <span>Total</span>
                  <span>{formatCurrency(sale.total)}</span>
                </div>
              </div>
            </Card>

            {/* Show previous refunds */}
            {sale.refunds && sale.refunds.length > 0 && (
              <div className="space-y-1 p-3 rounded-lg bg-warning/10 border border-warning/20">
                <p className="text-xs font-medium text-warning">Previous Refunds:</p>
                {sale.refunds.map((r) => (
                  <div key={r.id} className="flex justify-between text-xs text-warning">
                    <span>{r.reason}{Array.isArray(r.tenders) ? ` · ${r.tenders.map(part => part.method.replace(/_/g, ' ') + ' ' + formatCurrency(part.amount)).join(', ')}` : ''}</span>
                    <span>{formatCurrency(r.amount)}</span>
                  </div>
                ))}
                <div className="flex justify-between text-xs font-bold text-warning pt-1 border-t border-warning/20">
                  <span>Remaining refundable</span>
                  <span>{formatCurrency(getRefundableAmount())}</span>
                </div>
              </div>
            )}

            {!sale.pricingVersion && <p className="text-sm text-muted-foreground">Original loyalty allocations and cost details are unavailable for this older sale.</p>}
            {sale.status === 'REFUNDED' || sale.status === 'VOIDED' || (!sale.pricingVersion && getRefundableAmount() <= 0) ? (
              <div className="flex items-center gap-2 text-destructive text-sm">
                <AlertTriangle className="h-4 w-4" />
                This sale has been fully refunded.
              </div>
            ) : (
              <div className="space-y-3">
                {/* Mode tabs */}
                <div className="flex border-b border-border">
                  <button
                    onClick={() => setMode('items')}
                    className={`flex-1 py-2 px-4 font-medium text-sm transition-colors ${
                      mode === 'items'
                        ? 'border-b-2 border-primary text-primary'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Return items
                  </button>
                  <button
                    onClick={() => setMode('amount')}
                    className={`flex-1 py-2 px-4 font-medium text-sm transition-colors ${
                      mode === 'amount'
                        ? 'border-b-2 border-primary text-primary'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Amount only
                  </button>
                </div>

                {mode === 'items' ? (
                  <>
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-muted-foreground">
                        Select returned quantities — stock is restored per item.
                      </p>
                      <button onClick={selectAllItems} className="text-xs text-primary hover:underline shrink-0 ml-2">
                        Select all
                      </button>
                    </div>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {sale.items.map((item) => {
                        const refundable = getRefundableQty(item);
                        const qty = refundQtys[item.id] || 0;
                        return (
                          <div
                            key={item.id}
                            className={`flex flex-wrap items-center justify-between gap-2 p-2 rounded-lg border ${
                              qty > 0 ? 'border-primary bg-primary/5' : 'border-border'
                            }`}
                          >
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium truncate">{item.productName || item.product.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {formatCurrency(item.total)} paid on this line · {refundable} of {item.quantity} refundable
                              </p>
                            </div>
                            {refundable > 0 ? (
                              <div className="flex items-center gap-1.5 shrink-0">
                                <button
                                  aria-label={`Return fewer ${item.productName || item.product.name}`}
                                  onClick={() => setItemQty(item, qty - 1)}
                                  className="h-8 w-8 flex items-center justify-center border rounded-md hover:bg-accent disabled:opacity-40"
                                  disabled={qty <= 0}
                                >
                                  <Minus className="h-4 w-4" />
                                </button>
                                <span className="w-8 text-center font-semibold tabular-nums text-sm">{qty}</span>
                                <button
                                  aria-label={`Return more ${item.productName || item.product.name}`}
                                  onClick={() => setItemQty(item, qty + 1)}
                                  className="h-8 w-8 flex items-center justify-center border rounded-md hover:bg-accent disabled:opacity-40"
                                  disabled={qty >= refundable}
                                >
                                  <Plus className="h-4 w-4" />
                                </button>
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground shrink-0">Refunded</span>
                            )}
                            {item.sellingUnitId && qty > 0 && restock && (
                              <label className="flex w-full items-center gap-2 text-xs cursor-pointer">
                                <input type="checkbox" checked={!openedPacks[item.id]} className="h-4 w-4 rounded border-border accent-primary"
                                  onChange={(e) => setOpenedPacks(current => ({ ...current, [item.id]: !e.target.checked }))} />
                                Returned unopened (back on the shelf as a pack)
                              </label>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={restock}
                        onChange={(e) => setRestock(e.target.checked)}
                        className="h-4 w-4 rounded border-border accent-primary"
                      />
                      Return items to inventory
                    </label>
                  </>
                ) : (
                  <Input
                    type="number"
                    label={`Refund Amount (max: ${formatCurrency(getRefundableAmount())})`}
                    value={refundAmount}
                    onChange={(e) => setRefundAmount(e.target.value)}
                    step="0.01"
                    max={getRefundableAmount()}
                  />
                )}

                {sale.refundTenderError ? <p role="alert" className="text-sm text-destructive">{sale.refundTenderError}</p> : <RefundTenderEditor options={sale.refundTenderOptions || []} amount={effectiveAmount} hasCustomer={!!sale.customer} edits={tenderEdits} onChange={setTenderEdits} />}

                {!!sale.pricingVersion && <p className="text-sm text-muted-foreground">{mode === 'items' ? restoredPoints + ' redeemed points will be restored. Earned points are reversed from the original allocation.' : 'Points and tax are allocated from the original purchase. Earlier refunds are deducted.'}</p>}
                <Input
                  type="text"
                  label="Reason (optional)"
                  placeholder="Reason for refund..."
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                />
                <Button
                  variant="primary"
                  className="w-full h-11"
                  onClick={handleRefund}
                  disabled={isProcessing || !!pending || storageError || !!sale.refundTenderError || tenderSelection.invalid || (mode === 'items' ? !hasSelectedItems : !refundAmount)}
                >
                  <RotateCcw className="h-4 w-4 mr-2" />
                  {isProcessing ? 'Processing...' : `Refund ${formatCurrency(effectiveAmount)}`}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
};
