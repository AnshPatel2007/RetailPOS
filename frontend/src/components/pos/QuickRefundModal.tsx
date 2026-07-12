import React, { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { saleService } from '@/services/api';
import { formatCurrency } from '@/lib/utils';
import { Search, AlertTriangle, RotateCcw, Minus, Plus } from 'lucide-react';
import toast from 'react-hot-toast';

interface SaleItem {
  id: string;
  quantity: number;
  price: number;
  discount: number;
  tax: number;
  total: number;
  product: { name: string; sku: string };
}

interface RefundItemRecord {
  saleItemId: string;
  quantity: number;
}

interface RefundRecord {
  id: string;
  amount: number;
  reason: string;
  createdAt: string;
  method?: string | null;
  items?: RefundItemRecord[];
}

interface SalePaymentRecord {
  paymentMethod: string;
  reference?: string | null;
}

interface SaleDetails {
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
type RefundMethod = 'CASH' | 'GIFT_CARD' | 'STORE_CREDIT';

interface QuickRefundModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRefundComplete?: () => void;
}

export const QuickRefundModal: React.FC<QuickRefundModalProps> = ({
  isOpen,
  onClose,
  onRefundComplete,
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
  const [refundMethod, setRefundMethod] = useState<RefundMethod>('CASH');

  const handleSearch = async () => {
    if (!saleNumber.trim()) return;
    setIsSearching(true);
    setSale(null);
    setRefundQtys({});
    setMode('items');
    setRestock(true);
    setRefundMethod('CASH');
    try {
      const response = await saleService.getAll({ saleNumber: saleNumber.trim() });
      const sales = response.data.data || [];
      if (sales.length === 0) {
        toast.error('Sale not found');
        return;
      }
      const detailResponse = await saleService.getById(sales[0].id);
      const saleData = detailResponse.data.data;
      setSale(saleData);
      // Default to the remaining refundable amount
      const previouslyRefunded = (saleData.refunds || []).reduce((s: number, r: RefundRecord) => s + r.amount, 0);
      const refundable = Math.round((saleData.total - previouslyRefunded) * 100) / 100;
      setRefundAmount(Math.max(0, refundable).toString());
    } catch {
      toast.error('Failed to find sale');
    } finally {
      setIsSearching(false);
    }
  };

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

  const unitTotal = (item: SaleItem) => item.total / item.quantity;

  // Amount computed from the selected return quantities (matches the backend math)
  const getItemsAmount = () => {
    if (!sale) return 0;
    const total = sale.items.reduce((sum, item) => {
      const qty = refundQtys[item.id] || 0;
      return sum + Math.round(unitTotal(item) * qty * 100) / 100;
    }, 0);
    return Math.round(total * 100) / 100;
  };

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

  // Refund destinations available for this sale
  const giftCardPayment = sale?.payments?.find((p) => p.paymentMethod === 'GIFT_CARD' && p.reference);
  const methodOptions: { value: RefundMethod; label: string; available: boolean }[] = [
    { value: 'CASH', label: 'Cash', available: true },
    { value: 'GIFT_CARD', label: 'Gift card', available: !!giftCardPayment },
    { value: 'STORE_CREDIT', label: 'Store credit', available: !!sale?.customer },
  ];

  const effectiveAmount = mode === 'items' ? getItemsAmount() : (parseFloat(refundAmount) || 0);
  const hasSelectedItems = Object.values(refundQtys).some((q) => q > 0);

  const handleRefund = async () => {
    if (!sale) return;
    const maxRefundable = getRefundableAmount();
    if (!effectiveAmount || effectiveAmount <= 0 || effectiveAmount > maxRefundable + 0.01) {
      toast.error(effectiveAmount > maxRefundable
        ? `Max refundable: ${formatCurrency(maxRefundable)}`
        : 'Select items or enter a valid amount');
      return;
    }

    const methodLabel = methodOptions.find((m) => m.value === refundMethod)?.label || 'Cash';
    if (!window.confirm(`Refund ${formatCurrency(effectiveAmount)} to ${methodLabel.toLowerCase()} for sale #${sale.saleNumber}?`)) {
      return;
    }

    setIsProcessing(true);
    try {
      const payload: any = {
        reason: refundReason || 'Refund from POS',
        refundMethod,
      };
      if (mode === 'items') {
        payload.items = Object.entries(refundQtys)
          .filter(([, qty]) => qty > 0)
          .map(([saleItemId, quantity]) => ({ saleItemId, quantity }));
        payload.restock = restock;
      } else {
        payload.amount = effectiveAmount;
      }
      await saleService.refund(sale.id, payload);
      toast.success(`Refund of ${formatCurrency(effectiveAmount)} processed`);
      onRefundComplete?.();
      handleReset();
      onClose();
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Refund failed');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReset = () => {
    setSaleNumber('');
    setSale(null);
    setRefundReason('');
    setRefundAmount('');
    setRefundQtys({});
    setMode('items');
    setRestock(true);
    setRefundMethod('CASH');
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => { handleReset(); onClose(); }}
      title="Quick Refund"
      size="md"
    >
      <div className="space-y-4">
        {/* Sale lookup */}
        <div className="flex gap-2">
          <Input
            type="text"
            placeholder="Enter sale number..."
            value={saleNumber}
            onChange={(e) => setSaleNumber(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
            autoFocus
          />
          <Button variant="outline" onClick={handleSearch} disabled={isSearching}>
            <Search className="h-4 w-4" />
          </Button>
        </div>

        {/* Sale details */}
        {sale && (
          <>
            <Card className={`p-4 ${sale.status === 'REFUNDED' ? 'border-destructive/50' : ''}`}>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="font-medium">#{sale.saleNumber}</span>
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
                    <span>{r.reason}</span>
                    <span>{formatCurrency(r.amount)}</span>
                  </div>
                ))}
                <div className="flex justify-between text-xs font-bold text-warning pt-1 border-t border-warning/20">
                  <span>Remaining refundable</span>
                  <span>{formatCurrency(getRefundableAmount())}</span>
                </div>
              </div>
            )}

            {sale.status === 'REFUNDED' || getRefundableAmount() <= 0 ? (
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
                            className={`flex items-center justify-between gap-2 p-2 rounded-lg border ${
                              qty > 0 ? 'border-primary bg-primary/5' : 'border-border'
                            }`}
                          >
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium truncate">{item.product.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {formatCurrency(unitTotal(item))} each · {refundable} of {item.quantity} refundable
                              </p>
                            </div>
                            {refundable > 0 ? (
                              <div className="flex items-center gap-1.5 shrink-0">
                                <button
                                  onClick={() => setItemQty(item, qty - 1)}
                                  className="h-8 w-8 flex items-center justify-center border rounded-md hover:bg-accent disabled:opacity-40"
                                  disabled={qty <= 0}
                                >
                                  <Minus className="h-4 w-4" />
                                </button>
                                <span className="w-8 text-center font-semibold tabular-nums text-sm">{qty}</span>
                                <button
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

                {/* Refund destination */}
                <div>
                  <label className="block text-sm font-medium mb-1.5">Refund to</label>
                  <div className="flex gap-2">
                    {methodOptions.filter((m) => m.available).map((m) => (
                      <button
                        key={m.value}
                        onClick={() => setRefundMethod(m.value)}
                        className={`flex-1 px-3 py-2 border rounded-lg text-sm font-medium transition-colors truncate ${
                          refundMethod === m.value
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border hover:border-primary/50'
                        }`}
                        title={m.label}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                  {refundMethod === 'GIFT_CARD' && giftCardPayment && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Credits back to card {giftCardPayment.reference}
                    </p>
                  )}
                </div>

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
                  disabled={isProcessing || (mode === 'items' ? !hasSelectedItems : !refundAmount)}
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
