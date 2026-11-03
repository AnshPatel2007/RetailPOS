import { lineMoney, roundMoney } from '@/lib/money';
import React, { useState } from 'react';
import { CartItem } from '@/types';
import { formatCurrency } from '@/lib/utils';
import { ActionMenu } from '@/components/ui/ActionMenu';
import {
  X,
  Plus,
  Minus,
  Percent,
  StickyNote,
  Pencil,
  Tag,
} from 'lucide-react';
import toast from 'react-hot-toast';

interface CartItemCardProps {
  onEditQuantity: () => void;
  item: CartItem;
  onUpdateQuantity: (productId: string, quantity: number) => void;
  onRemove: (productId: string) => void;
  onUpdateDiscount: (productId: string, discount: number) => void;
  onUpdateNotes: (productId: string, notes: string) => void;
  onUpdatePrice?: (productId: string, price: number) => void;
  canOverridePrice?: boolean;
  /** Automatic promotion applied to this line (display only — server recomputes) */
  promoDiscount?: number;
  promoName?: string;
}

export const CartItemCard: React.FC<CartItemCardProps> = ({
  onEditQuantity,
  item,
  onUpdateQuantity,
  onRemove,
  onUpdateDiscount,
  onUpdateNotes,
  onUpdatePrice,
  canOverridePrice,
  promoDiscount = 0,
  promoName,
}) => {
  const [showDiscount, setShowDiscount] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [editingPrice, setEditingPrice] = useState(false);
  const [discountMode, setDiscountMode] = useState<'$' | '%'>('$');
  const [discountInput, setDiscountInput] = useState('');
  const [priceInput, setPriceInput] = useState('');
  const [noteInput, setNoteInput] = useState(item.notes || '');

  const lineTotal = lineMoney(item.product.price, item.quantity);
  const effectiveDiscount = Math.min(item.discount + promoDiscount, lineTotal);
  const discountedTotal = roundMoney(lineTotal - effectiveDiscount);

  const handleApplyDiscount = () => {
    const val = parseFloat(discountInput);
    if (!val || val <= 0) {
      onUpdateDiscount(item.product.id, 0);
      setShowDiscount(false);
      setDiscountInput('');
      return;
    }

    let discountAmount: number;
    if (discountMode === '%') {
      discountAmount = (lineTotal * Math.min(val, 100)) / 100;
    } else {
      discountAmount = Math.min(val, lineTotal);
    }

    onUpdateDiscount(item.product.id, roundMoney(discountAmount));
    setShowDiscount(false);
    setDiscountInput('');
  };

  const handleClearDiscount = () => {
    onUpdateDiscount(item.product.id, 0);
    setShowDiscount(false);
    setDiscountInput('');
  };

  const handleApplyPrice = () => {
    const val = parseFloat(priceInput);
    if (!val || val <= 0) {
      setEditingPrice(false);
      return;
    }
    onUpdatePrice?.(item.product.id, val);
    setEditingPrice(false);
  };

  const handleSaveNotes = () => {
    onUpdateNotes(item.product.id, noteInput);
    setShowNotes(false);
  };

  return (
    <div className="pos-cart-line" data-cart-line>
      <div className="pos-cart-line-main">
        <div className="pos-cart-line-name">
          <h4>{item.product.name}</h4>
        </div>
        <div className="pos-quantity" aria-label={`Quantity for ${item.product.name}`}>
          <button
            onClick={() => onUpdateQuantity(item.product.id, item.quantity - 1)}
            className="pos-quantity-button"
            title="Decrease quantity"
          >
            <Minus className="h-4 w-4" />
          </button>
          <button type="button" onClick={onEditQuantity} aria-label={`Change quantity for ${item.product.name}`}
            className="pos-quantity-button pos-quantity-value tabular-nums">{item.quantity}</button>
          <button
            onClick={() => {
              if (item.product.trackInventory && item.quantity + 1 > item.product.stockQuantity) {
                toast.error(`Only ${item.product.stockQuantity} in stock`);
                return;
              }
              onUpdateQuantity(item.product.id, item.quantity + 1);
            }}
            className="pos-quantity-button"
            title="Increase quantity"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        <div className="pos-cart-line-amount tabular-nums">
          {effectiveDiscount > 0 ? (
            <>
              <p className="text-xs text-muted-foreground line-through">{formatCurrency(lineTotal)}</p>
              <p className="font-semibold">{formatCurrency(discountedTotal)}</p>
            </>
          ) : (
            <p className="font-semibold">{formatCurrency(lineTotal)}</p>
          )}
          <div className="flex items-center justify-end gap-1">
            <span className="text-xs text-muted-foreground">{formatCurrency(item.product.price)} each</span>
          </div>
        </div>
        <ActionMenu iconOnly label={`Actions for ${item.product.name}`} items={[
          { id: 'notes', label: 'Item notes', icon: <StickyNote size={16} />, onAction: () => setShowNotes(!showNotes) },
          { id: 'discount', label: 'Item discount', icon: <Percent size={16} />, onAction: () => setShowDiscount(!showDiscount) },
          ...(canOverridePrice ? [{ id: 'price', label: 'Override price', icon: <Pencil size={16} />, onAction: () => { setPriceInput(item.product.price.toFixed(2)); setEditingPrice(true); } }] : []),
          { id: 'remove', label: 'Remove item', icon: <X size={16} />, destructive: true, onAction: () => onRemove(item.product.id) },
        ]} />
      </div>

      {editingPrice && <div className="pos-line-editor flex items-center gap-2">
        <label className="text-xs" htmlFor={`price-${item.product.id}`}>Unit price</label>
        <input id={`price-${item.product.id}`} type="number" value={priceInput} aria-label={`Unit price for ${item.product.name}`}
          onChange={e => setPriceInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleApplyPrice(); if (e.key === 'Escape') { e.stopPropagation(); setEditingPrice(false); } }}
          className="min-w-0 flex-1 text-sm px-2 border rounded bg-background" autoFocus step="0.01" />
        <button type="button" onClick={handleApplyPrice} className="text-sm text-primary">Apply</button>
        <button type="button" onClick={() => setEditingPrice(false)} className="text-sm text-muted-foreground">Cancel</button>
      </div>}

      {/* Automatic promotion badge */}
      {promoDiscount > 0 && promoName && (
        <div className="mt-1.5 flex items-center gap-1 text-xs text-success">
          <Tag className="h-3 w-3 shrink-0" />
          <span className="truncate">{promoName}</span>
          <span className="ml-auto font-medium tabular-nums shrink-0">-{formatCurrency(promoDiscount)}</span>
        </div>
      )}

      {/* Inline discount editor */}
      {showDiscount && (
        <div className="pos-line-editor mt-2 pt-2 border-t border-border space-y-2">
          <div className="flex items-center gap-2">
            <div className="flex border rounded overflow-hidden">
              <button
                onClick={() => setDiscountMode('$')}
                className={`px-2 py-1 text-xs font-medium ${discountMode === '$' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}
              >
                $
              </button>
              <button
                onClick={() => setDiscountMode('%')}
                className={`px-2 py-1 text-xs font-medium ${discountMode === '%' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}
              >
                %
              </button>
            </div>
            <input
              type="number"
              value={discountInput}
              aria-label="Item discount amount"
              onChange={(e) => setDiscountInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleApplyDiscount(); }}
              placeholder={discountMode === '$' ? '0.00' : '0'}
              className="flex-1 text-sm px-2 py-1 border rounded bg-background"
              autoFocus
              step={discountMode === '$' ? '0.01' : '1'}
            />
            <button onClick={handleApplyDiscount} className="text-xs font-medium text-primary hover:underline">Apply</button>
            {item.discount > 0 && (
              <button onClick={handleClearDiscount} className="text-xs text-destructive hover:underline">Clear</button>
            )}
          </div>
          {item.discount > 0 && (
            <p className="text-xs text-primary">-{formatCurrency(item.discount)} discount applied</p>
          )}
        </div>
      )}

      {/* Inline notes editor */}
      {showNotes && (
        <div className="pos-line-editor mt-2 pt-2 border-t border-border">
          <div className="flex gap-2">
            <input
              type="text"
              value={noteInput}
              aria-label={`Note for ${item.product.name}`}
              onChange={(e) => setNoteInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSaveNotes(); }}
              placeholder="Item note..."
              className="flex-1 text-sm px-2 py-1 border rounded bg-background"
              autoFocus
            />
            <button onClick={handleSaveNotes} className="text-xs font-medium text-primary hover:underline">Save</button>
          </div>
        </div>
      )}

      {/* Show saved note inline */}
      {!showNotes && item.notes && (
        <p className="mt-1 text-xs text-muted-foreground italic truncate">Note: {item.notes}</p>
      )}
    </div>
  );
};
