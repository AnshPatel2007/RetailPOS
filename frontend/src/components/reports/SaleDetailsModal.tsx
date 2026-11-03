import { QuickRefundModal } from '@/components/pos/QuickRefundModal';
import React, { useState, useEffect } from 'react';
import { XCircle, RotateCcw, CreditCard, User, Calendar } from 'lucide-react';
import { Sale } from '@/types';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { formatCurrency, formatDate } from '@/lib/utils';
import { SaleVoidDialog } from './SaleVoidDialog';
import { useAuthStore } from '@/store/authStore';

interface SaleDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  sale: Sale | null;
  onSuccess: () => void;
  refreshing?: boolean;
}

export const SaleDetailsModal: React.FC<SaleDetailsModalProps> = ({
  isOpen,
  onClose,
  sale,
  onSuccess,
  refreshing,
}) => {
  const { user } = useAuthStore();
  const [showVoid, setShowVoid] = useState(false);

  const [showRefund, setShowRefund] = useState(false);
  useEffect(() => { setShowRefund(false); setShowVoid(false); }, [isOpen, sale?.id]);

  if (!isOpen || !sale) return null;
  const historical = sale.sourceType === 'DAILY_SUMMARY';

  if (showVoid) return <SaleVoidDialog sale={sale} onClose={() => setShowVoid(false)} onSuccess={() => { onSuccess(); onClose(); }} />;

  if (showRefund) return <QuickRefundModal isOpen={true} initialSaleId={sale.id} onClose={() => setShowRefund(false)} onRefundComplete={() => { onSuccess(); onClose(); }} />;

  const canVoid = !historical && ['COMPLETED', 'VOIDED'].includes(sale.status) && ['ADMIN', 'MANAGER', 'CASHIER'].includes(user?.role || '');
  const canRefund = !historical && sale.status === 'COMPLETED' && ['ADMIN', 'MANAGER', 'CASHIER'].includes(user?.role || '');

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={historical ? 'Historical Daily Summary' : 'Sale Details'} size="xl">
        <fieldset disabled={refreshing} className="min-w-0 space-y-6">
          {refreshing && <p role="status">Refreshing sale. Actions will be available after the latest details load.</p>}
          {historical && <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Daily source totals. Individual receipts, items, costs, customers and staff were not supplied. Register figures are not classified as cash.</p>
            <div className="grid grid-cols-2 gap-3 text-sm">
              {([['Register 1', sale.sourceData?.register1Cents], ['Register 2', sale.sourceData?.register2Cents], ['Credit card', sale.sourceData?.cardCents], ['Lottery net after payouts', sale.sourceData?.lotteryNetCents]] as const).map(([label, amount]) => <div key={label}><p className="text-muted-foreground">{label}</p><p>{amount == null ? 'Not supplied' : formatCurrency(amount / 100)}</p></div>)}
            </div>
            {sale.sourceData?.caveats?.map(note => <p key={note} className="text-sm text-warning">{note}</p>)}
          </div>}


          {/* Header Info */}
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-2xl font-bold">{formatCurrency(sale.total)}</h3>
              <p className="text-sm text-muted-foreground font-mono">{sale.saleNumber}</p>
            </div>
            <span
              className={`px-3 py-1 rounded text-sm font-medium ${
                sale.status === 'COMPLETED'
                  ? 'bg-success/10 text-success'
                  : sale.status === 'PENDING'
                  ? 'bg-warning/10 text-warning'
                  : sale.status === 'HOLD'
                  ? 'bg-primary/10 text-primary'
                  : 'bg-destructive/10 text-destructive'
              }`}
            >
              {sale.status}
            </span>
          </div>

          {/* Sale Info Grid */}
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Sale Date</p>
                <p className="font-medium text-sm">{historical ? sale.sourceData?.businessDate : formatDate(sale.createdAt)}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Original primary tender</p>
                <p className="font-medium text-sm">{historical ? 'Card recorded; remaining tender unspecified' : sale.paymentMethod.replace(/_/g, ' ')}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Employee</p>
                <p className="font-medium text-sm">
                  {historical ? 'Not supplied' : sale.user ? `${sale.user.firstName} ${sale.user.lastName}` : 'N/A'}
                </p>
              </div>
            </div>
            {sale.customer && (
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground">Customer</p>
                  <p className="font-medium text-sm">
                    {sale.customer.firstName} {sale.customer.lastName}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Sale Items */}
          {!historical && <div>
            <h4 className="font-medium mb-3">Items</h4>
            <div className="border rounded-md overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="text-left p-2">Product</th>
                    <th className="text-center p-2">Qty</th>
                    <th className="text-right p-2">Price</th>
                    <th className="text-right p-2">Discount</th>
                    <th className="text-right p-2">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {sale.items.map((item) => (
                    <tr key={item.id} className="border-t">
                      <td className="p-2">
                        <div>
                          <p className="font-medium">{item.productName}</p>
                          <p className="text-xs text-muted-foreground">{item.sku}</p>
                        </div>
                      </td>
                      <td className="text-center p-2">{item.quantity}</td>
                      <td className="text-right p-2 font-mono">{formatCurrency(item.price)}</td>
                      <td className="text-right p-2 font-mono text-destructive">
                        {item.discount > 0 ? `-${formatCurrency(item.discount)}` : '-'}
                      </td>
                      <td className="text-right p-2 font-mono font-medium">
                        {formatCurrency(item.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>}

          {/* Sale Summary */}
          <div className="border-t pt-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-mono">{formatCurrency(sale.subtotal)}</span>
              </div>
              {sale.pricingVersion && <p className="text-sm text-muted-foreground">Loyalty: {sale.pointsRedeemed || 0} points redeemed ({formatCurrency(Number(sale.loyaltyDiscount || 0))}); {sale.pointsEarned || 0} points earned.</p>}
              {sale.discount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Discount</span>
                  <span className="font-mono text-destructive">-{formatCurrency(sale.discount)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Tax</span>
                <span className="font-mono">{formatCurrency(sale.tax)}</span>
              </div>
              <div className="flex justify-between font-medium text-lg border-t pt-2">
                <span>Total</span>
                <span className="font-mono">{formatCurrency(sale.total)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Amount Paid</span>
                <span className="font-mono">{formatCurrency(sale.amountPaid)}</span>
              </div>
              {sale.changeDue > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Change Due</span>
                  <span className="font-mono">{formatCurrency(sale.changeDue)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Metadata */}
          {sale.completedAt && (
            <div className="pt-4 border-t text-xs text-muted-foreground">
              <p>Completed: {formatDate(sale.completedAt)}</p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-2 pt-4">
            {canVoid && (
              <Button
                variant="destructive"
                onClick={() => setShowVoid(true)}
              >
                <XCircle className="h-4 w-4 mr-2" />
                {sale.status === 'VOIDED' ? 'Void Details / Retry' : 'Void Sale'}
              </Button>
            )}
            {canRefund && (
              <Button
                variant="outline"
                onClick={() => setShowRefund(true)}
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                Refund Sale
              </Button>
            )}
          </div>
        </fieldset>
    </Modal>
  );
};
