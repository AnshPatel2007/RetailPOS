import React, { useState } from 'react';
import { useCartStore } from '@/store/cartStore';
import { Product } from '@/types';
import { useAuthStore } from '@/store/authStore';
import { formatCurrency } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { CartItemCard } from '@/components/pos/CartItemCard';
import { Receipt } from '@/services/hardware';
import { hardware } from '@/services/hardware';
import {
  Trash2,
  Printer,
  List,
  RotateCcw,
  PauseCircle,
  StickyNote,
  ShoppingCart,
  X,
} from 'lucide-react';

interface CartPanelProps {
  onEditQuantity: (product: Product) => void;
  lastReceipt: Receipt | null;
  onPrintReceipt: () => void;
  onShowHeldSales: () => void;
  onShowRefund: () => void;
  onCheckout: () => void;
  onHoldSale: () => void;
  onClose?: () => void;
}

export const CartPanel: React.FC<CartPanelProps> = ({
  onEditQuantity,
  lastReceipt,
  onPrintReceipt,
  onShowHeldSales,
  onShowRefund,
  onCheckout,
  onHoldSale,
  onClose,
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
    getLineBreakdown,
    heldSales,
  } = useCartStore();

  const lineBreakdown = getLineBreakdown();

  const { user } = useAuthStore();
  const canOverridePrice = ['ADMIN', 'MANAGER', 'CASHIER'].includes(user?.role || '');
  const canRequestRefund = ['ADMIN', 'MANAGER', 'CASHIER'].includes(user?.role || '');
  const [showNotes, setShowNotes] = useState(false);

  return (
    <div data-sale-cart className="pos-cart">
      {/* Cart header */}
      <div className="pos-cart-header">
        <div className="flex items-center justify-between gap-2">
          <div className="pos-cart-heading">
            <h2 className="text-base font-semibold whitespace-nowrap">Current Sale</h2>
            <span className="text-xs text-muted-foreground whitespace-nowrap">{getItemCount()} {getItemCount() === 1 ? 'item' : 'items'}</span>
          </div>
          <div className="flex gap-0.5 items-center">
            {/* Held sales button */}
            <button
              onClick={onShowHeldSales}
              className="pos-cart-tool relative"
              title="Held sales (F6)"
            >
              <List className="h-4 w-4 text-muted-foreground" />
              {heldSales.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 bg-warning text-warning-foreground text-xs rounded-full w-4 h-4 flex items-center justify-center font-bold">
                  {heldSales.length}
                </span>
              )}
            </button>

            {canRequestRefund && (
              <button
                onClick={onShowRefund}
                className="pos-cart-tool"
                title="Quick refund"
              >
                <RotateCcw className="h-4 w-4 text-muted-foreground" />
              </button>
            )}

            {lastReceipt && hardware.printer.isEnabled() && (
              <Button
                variant="ghost"
                size="sm"
                className="pos-cart-tool"
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
                onClick={() => {
                  if (window.confirm(`Clear all ${getItemCount()} item${getItemCount() > 1 ? 's' : ''} from cart?`)) {
                    clearCart();
                  }
                }}
                className="text-destructive pos-cart-tool"
                title="Clear cart"
                aria-label="Clear cart"
              >
                <Trash2 className="h-4 w-4 mr-1" />
              </Button>
            )}
            {onClose && <button type="button" onClick={onClose} aria-label="Close sale cart" className="pos-cart-tool"><X size={18} /></button>}
          </div>
        </div>
      </div>

      {/* Cart items */}
      <div data-cart-items className="pos-cart-items">
        {items.length === 0 ? (
          <div className="text-center py-10">
            <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
              <ShoppingCart className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="font-medium">Cart is empty</p>
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
              onEditQuantity={() => onEditQuantity(item.product)}
              key={item.product.id}
              item={item}
              onUpdateQuantity={updateQuantity}
              onRemove={removeItem}
              onUpdateDiscount={updateDiscount}
              onUpdateNotes={updateNotes}
              onUpdatePrice={updatePrice}
              canOverridePrice={canOverridePrice}
              promoDiscount={lineBreakdown[item.product.id]?.promoDiscount || 0}
              promoName={lineBreakdown[item.product.id]?.promotionName}
            />
          ))
        )}
      </div>

      {/* Cart footer */}
      <div data-assistant-avoid className="pos-cart-footer">
        {/* Notes toggle */}
        {items.length > 0 && (
          <div>
            <button
              onClick={() => setShowNotes(!showNotes)}
              className="pos-sale-note flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <StickyNote className="h-3.5 w-3.5" />
              {notes ? 'Edit note' : 'Add note'}
              {notes && <span className="w-1.5 h-1.5 rounded-full bg-primary" />}
            </button>
            {showNotes && (
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Order notes..."
                rows={2}
                className="mt-2 w-full text-sm px-3 py-2 border border-input rounded-md bg-background text-foreground resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                autoFocus
              />
            )}
          </div>
        )}

        {/* Totals — getSubtotal() is already net of all discounts, so show the
            gross amount and the discounts as separate display-only lines */}
        {(() => {
          const lines = Object.values(lineBreakdown);
          const itemDiscounts = Math.round(lines.reduce((s, l) => s + l.manualDiscount, 0) * 100) / 100;
          const promoSavings = Math.round(lines.reduce((s, l) => s + l.promoDiscount, 0) * 100) / 100;
          const grossSubtotal = Math.round(items.reduce((s, i) => s + i.product.price * i.quantity, 0) * 100) / 100;
          const anyDiscount = itemDiscounts > 0 || promoSavings > 0;
          return (
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-medium tabular-nums">
                  {formatCurrency(anyDiscount ? grossSubtotal : getSubtotal())}
                </span>
              </div>
              {itemDiscounts > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Item discounts</span>
                  <span className="font-medium text-success tabular-nums">-{formatCurrency(itemDiscounts)}</span>
                </div>
              )}
              {promoSavings > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Promo savings</span>
                  <span className="font-medium text-success tabular-nums">-{formatCurrency(promoSavings)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Tax</span>
                <span className="font-medium tabular-nums">{formatCurrency(getTax())}</span>
              </div>
              <div className="pos-cart-total flex justify-between pt-2 border-t">
                <span>Total</span>
                <span className="tabular-nums">{formatCurrency(getTotal())}</span>
              </div>
            </div>
          );
        })()}

        {/* Action buttons */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={onHoldSale}
            disabled={items.length === 0}
            className="h-12 px-4 flex-none"
            title="Hold sale (F5)"
          >
            <PauseCircle className="h-4 w-4 mr-1.5" />
            Hold
          </Button>
          <Button
            variant="primary"
            className="flex-1 h-12 text-base font-semibold"
            onClick={onCheckout}
            disabled={items.length === 0}
            title="Checkout (F4)"
          >
            {items.length > 0 ? <>Charge {formatCurrency(getTotal())}</> : 'Charge'}
          </Button>
        </div>
        <p className="pos-shortcuts text-xs text-center text-muted-foreground">
          F1 Cash · F2 Card · F4 Checkout · F5 Hold · F7 Misc
        </p>
      </div>
    </div>
  );
};
