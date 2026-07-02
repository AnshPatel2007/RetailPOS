import React, { useState } from 'react';
import { CartItem } from '@/types';
import { formatCurrency } from '@/lib/utils';
import { Card } from '@/components/ui/Card';
import {
  X,
  Plus,
  Minus,
  Percent,
  StickyNote,
  Pencil,
} from 'lucide-react';
import toast from 'react-hot-toast';

interface CartItemCardProps {
  item: CartItem;
  onUpdateQuantity: (productId: string, quantity: number) => void;
  onRemove: (productId: string) => void;
  onUpdateDiscount: (productId: string, discount: number) => void;
  onUpdateNotes: (productId: string, notes: string) => void;
  onUpdatePrice?: (productId: string, price: number) => void;
  canOverridePrice?: boolean;
}

export const CartItemCard: React.FC<CartItemCardProps> = ({
  item,
  onUpdateQuantity,
  onRemove,
  onUpdateDiscount,
  onUpdateNotes,
  onUpdatePrice,
  canOverridePrice,
}) => {
  const [showDiscount, setShowDiscount] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [editingPrice, setEditingPrice] = useState(false);
  const [discountMode, setDiscountMode] = useState<'$' | '%'>('$');
  const [discountInput, setDiscountInput] = useState('');
  const [priceInput, setPriceInput] = useState('');
  const [noteInput, setNoteInput] = useState(item.notes || '');

  const lineTotal = item.product.price * item.quantity;
  const discountedTotal = lineTotal - item.discount;

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

    onUpdateDiscount(item.product.id, Math.round(discountAmount * 100) / 100);
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
    <Card className="p-3 animate-slideUp">
      <div className="flex justify-between items-start mb-2">
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-sm truncate">{item.product.name}</h4>
          <p className="text-xs text-muted-foreground">{item.product.sku}</p>
        </div>
        <div className="flex items-center gap-0.5 ml-2 shrink-0">
          <button
            onClick={() => setShowNotes(!showNotes)}
            className={`p-1 rounded hover:bg-accent transition-colors ${item.notes ? 'text-primary' : 'text-muted-foreground/50'}`}
            title="Item notes"
          >
            <StickyNote className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setShowDiscount(!showDiscount)}
            className={`p-1 rounded hover:bg-accent transition-colors ${item.discount > 0 ? 'text-primary' : 'text-muted-foreground/50'}`}
            title="Item discount"
          >
            <Percent className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => onRemove(item.product.id)}
            className="p-1 hover:bg-destructive/10 rounded"
          >
            <X className="h-4 w-4 text-destructive" />
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <button
            onClick={() => onUpdateQuantity(item.product.id, item.quantity - 1)}
            className="p-1 border rounded hover:bg-accent"
          >
            <Minus className="h-4 w-4" />
          </button>
          <span className="w-12 text-center font-medium">{item.quantity}</span>
          <button
            onClick={() => {
              if (item.product.trackInventory && item.quantity + 1 > item.product.stockQuantity) {
                toast.error(`Only ${item.product.stockQuantity} in stock`);
                return;
              }
              onUpdateQuantity(item.product.id, item.quantity + 1);
            }}
            className="p-1 border rounded hover:bg-accent"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        <div className="text-right">
          {item.discount > 0 ? (
            <>
              <p className="text-xs text-muted-foreground line-through">{formatCurrency(lineTotal)}</p>
              <p className="font-bold text-primary">{formatCurrency(discountedTotal)}</p>
            </>
          ) : (
            <p className="font-bold">{formatCurrency(lineTotal)}</p>
          )}
          <div className="flex items-center justify-end gap-1">
            {editingPrice ? (
              <div className="flex items-center gap-1 mt-0.5">
                <input
                  type="number"
                  value={priceInput}
                  onChange={(e) => setPriceInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleApplyPrice(); if (e.key === 'Escape') setEditingPrice(false); }}
                  className="w-16 text-xs px-1 py-0.5 border rounded text-right bg-background"
                  autoFocus
                  step="0.01"
                />
                <button onClick={handleApplyPrice} className="text-xs text-primary hover:underline">OK</button>
              </div>
            ) : (
              <button
                onClick={() => {
                  if (!canOverridePrice) return;
                  setPriceInput(item.product.price.toFixed(2));
                  setEditingPrice(true);
                }}
                className={`text-xs text-muted-foreground ${canOverridePrice ? 'hover:text-primary cursor-pointer' : ''}`}
                title={canOverridePrice ? 'Click to override price' : undefined}
                disabled={!canOverridePrice}
              >
                {formatCurrency(item.product.price)} each
                {canOverridePrice && <Pencil className="h-2.5 w-2.5 inline ml-0.5" />}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Inline discount editor */}
      {showDiscount && (
        <div className="mt-2 pt-2 border-t border-border space-y-2">
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
        <div className="mt-2 pt-2 border-t border-border">
          <div className="flex gap-2">
            <input
              type="text"
              value={noteInput}
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
    </Card>
  );
};
