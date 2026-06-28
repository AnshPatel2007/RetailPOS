import React, { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card } from '@/components/ui/Card';
import { saleService } from '@/services/api';
import { formatCurrency } from '@/lib/utils';
import { Search, AlertTriangle, RotateCcw } from 'lucide-react';
import toast from 'react-hot-toast';

interface SaleItem {
  id: string;
  quantity: number;
  price: number;
  discount: number;
  product: { name: string; sku: string };
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
}

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

  const handleSearch = async () => {
    if (!saleNumber.trim()) return;
    setIsSearching(true);
    setSale(null);
    try {
      const response = await saleService.getAll({ search: saleNumber.trim() });
      const sales = response.data.data || [];
      if (sales.length === 0) {
        toast.error('Sale not found');
        return;
      }
      // Fetch full details
      const detailResponse = await saleService.getById(sales[0].id);
      setSale(detailResponse.data.data);
      setRefundAmount(detailResponse.data.data.total.toString());
    } catch {
      toast.error('Failed to find sale');
    } finally {
      setIsSearching(false);
    }
  };

  const handleRefund = async () => {
    if (!sale) return;
    const amount = parseFloat(refundAmount);
    if (!amount || amount <= 0 || amount > sale.total) {
      toast.error('Invalid refund amount');
      return;
    }

    setIsProcessing(true);
    try {
      await saleService.refund(sale.id, {
        amount,
        reason: refundReason || 'Refund from POS',
      });
      toast.success(`Refund of ${formatCurrency(amount)} processed`);
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
                    sale.status === 'COMPLETED' ? 'bg-green-500/10 text-green-500' :
                    sale.status === 'REFUNDED' ? 'bg-red-500/10 text-red-500' :
                    'bg-muted text-muted-foreground'
                  }`}>
                    {sale.status}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {new Date(sale.createdAt).toLocaleString()} · {sale.paymentMethod}
                  {sale.customer && ` · ${sale.customer.firstName} ${sale.customer.lastName}`}
                </p>

                <div className="border-t pt-2 space-y-1">
                  {sale.items.map((item) => (
                    <div key={item.id} className="flex justify-between text-sm">
                      <span>{item.quantity}x {item.product.name}</span>
                      <span>{formatCurrency(item.price * item.quantity - item.discount)}</span>
                    </div>
                  ))}
                </div>

                <div className="border-t pt-2 flex justify-between font-bold">
                  <span>Total</span>
                  <span>{formatCurrency(sale.total)}</span>
                </div>
              </div>
            </Card>

            {sale.status === 'REFUNDED' ? (
              <div className="flex items-center gap-2 text-destructive text-sm">
                <AlertTriangle className="h-4 w-4" />
                This sale has already been refunded.
              </div>
            ) : (
              <div className="space-y-3">
                <Input
                  type="number"
                  label="Refund Amount"
                  value={refundAmount}
                  onChange={(e) => setRefundAmount(e.target.value)}
                  step="0.01"
                  max={sale.total}
                />
                <Input
                  type="text"
                  label="Reason (optional)"
                  placeholder="Reason for refund..."
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                />
                <Button
                  variant="primary"
                  className="w-full"
                  onClick={handleRefund}
                  disabled={isProcessing || !refundAmount}
                >
                  <RotateCcw className="h-4 w-4 mr-2" />
                  {isProcessing ? 'Processing...' : `Refund ${formatCurrency(parseFloat(refundAmount) || 0)}`}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
};
