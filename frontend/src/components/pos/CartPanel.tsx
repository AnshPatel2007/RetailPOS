import React from 'react';
import { useCartStore } from '@/store/cartStore';
import { useAuthStore } from '@/store/authStore';
import { formatCurrency } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { CartItemCard } from '@/components/pos/CartItemCard';
import { RecentTransactions } from '@/components/pos/RecentTransactions';
import { CustomerLinkSection, LinkedCustomer } from '@/components/pos/CustomerLinkSection';
import { Receipt } from '@/services/hardware';
import { hardware } from '@/services/hardware';
import {
  Trash2,
  Printer,
  List,
  RotateCcw,
  PauseCircle,
} from 'lucide-react';

interface CartPanelProps {
  linkedCustomer: LinkedCustomer | null;
  onCustomerChange: (customer: LinkedCustomer | null) => void;
  lastReceipt: Receipt | null;
  onPrintReceipt: () => void;
  onShowHeldSales: () => void;
  onShowRefund: () => void;
  onCheckout: () => void;
  onHoldSale: () => void;
  saleRefreshTrigger: number;
}

export const CartPanel: React.FC<CartPanelProps> = ({
  linkedCustomer,
  onCustomerChange,
  lastReceipt,
  onPrintReceipt,
  onShowHeldSales,
  onShowRefund,
  onCheckout,
  onHoldSale,
  saleRefreshTrigger,
}) => {
  const {
    items,
    removeItem,
    updateQuantity,
    updateDiscount,
    updateNotes,
    updatePrice,
    clearCart,
    notes,
    setNotes,
    getSubtotal,
    getTax,
    getTotal,
    getItemCount,
    heldSales,
  } = useCartStore();

  const { user } = useAuthStore();
  const canOverridePrice = user?.role === 'ADMIN' || user?.role === 'MANAGER';
  const isManagerOrAdmin = user?.role === 'ADMIN' || user?.role === 'MANAGER';

  return (
    <div className="w-full md:w-80 lg:w-96 bg-card md:border-l border-border flex flex-col">
      {/* Cart header */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xl font-bold">Current Sale</h2>
          <div className="flex gap-1 items-center">
            {/* Held sales button */}
            <button
              onClick={onShowHeldSales}
              className="relative p-1.5 rounded hover:bg-accent transition-colors"
              title="Held sales (F6)"
            >
              <List className="h-4 w-4 text-muted-foreground" />
              {heldSales.length > 0 && (
                <span className="absolute -top-1 -right-1 bg-amber-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center font-bold">
                  {heldSales.length}
                </span>
              )}
            </button>

            {isManagerOrAdmin && (
              <button
                onClick={onShowRefund}
                className="p-1.5 rounded hover:bg-accent transition-colors"
                title="Quick refund"
              >
                <RotateCcw className="h-4 w-4 text-muted-foreground" />
              </button>
            )}

            {lastReceipt && hardware.printer.isEnabled() && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onPrintReceipt}
                title="Print last receipt"
              >
                <Printer className="h-4 w-4" />
              </Button>
            )}
            {items.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearCart}
                className="text-destructive"
                title="Clear cart"
              >
                <Trash2 className="h-4 w-4 mr-1" />
                Clear
              </Button>
            )}
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          {getItemCount()} {getItemCount() === 1 ? 'item' : 'items'}
        </p>
      </div>

      {/* Cart items */}
      <div className="flex-1 overflow-auto p-4 space-y-3">
        {items.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">Cart is empty</p>
            <p className="text-sm text-muted-foreground mt-1">
              Click a product or scan a barcode
            </p>
            {heldSales.length > 0 && (
              <button
                onClick={onShowHeldSales}
                className="mt-3 text-sm text-primary hover:underline"
              >
                {heldSales.length} sale{heldSales.length > 1 ? 's' : ''} on hold
              </button>
            )}
          </div>
        ) : (
          items.map((item) => (
            <CartItemCard
              key={item.product.id}
              item={item}
              onUpdateQuantity={updateQuantity}
              onRemove={removeItem}
              onUpdateDiscount={updateDiscount}
              onUpdateNotes={updateNotes}
              onUpdatePrice={updatePrice}
              canOverridePrice={canOverridePrice}
            />
          ))
        )}
      </div>

      {/* Recent Transactions */}
      <RecentTransactions refreshTrigger={saleRefreshTrigger} />

      {/* Cart footer */}
      <div className="border-t border-border p-4 space-y-3">
        {/* Customer Linking Section */}
        <CustomerLinkSection
          linkedCustomer={linkedCustomer}
          onCustomerChange={onCustomerChange}
        />

        {/* Order Notes */}
        {items.length > 0 && (
          <div className="pt-2 border-t">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Order notes..."
              rows={2}
              className="w-full text-sm px-3 py-2 border border-input rounded-md bg-background text-foreground resize-none focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        )}

        {/* Totals */}
        <div className="space-y-2 text-sm pt-3 border-t">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="font-medium">{formatCurrency(getSubtotal())}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Tax</span>
            <span className="font-medium">{formatCurrency(getTax())}</span>
          </div>
          <div className="flex justify-between text-lg font-bold pt-2 border-t">
            <span>Total</span>
            <span>{formatCurrency(getTotal())}</span>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onHoldSale}
            disabled={items.length === 0}
            className="flex-none"
            title="Hold sale (F5)"
          >
            <PauseCircle className="h-4 w-4 mr-1" />
            Hold
          </Button>
          <Button
            variant="primary"
            size="lg"
            className="flex-1"
            onClick={onCheckout}
            disabled={items.length === 0}
            title="Checkout (F4)"
          >
            Checkout
          </Button>
        </div>
        <p className="text-xs text-center text-muted-foreground">
          F4 Checkout · F5 Hold · F1 Cash · F2 Card
        </p>
      </div>
    </div>
  );
};
