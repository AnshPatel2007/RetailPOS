import { Select } from '@/components/ui/Select';
import React, { useState } from 'react';
import { productService } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Product } from '@/types';
import toast from 'react-hot-toast';

interface StockAdjustmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  product: Product | null;
}

export const ADJUSTMENT_REASONS = [
  { value: 'MANUAL_COUNT', label: 'Manual Count / Cycle Count' },
  { value: 'WRONG_SKU_SOLD', label: 'Similar product sold under this item' },
  { value: 'MISSING_RECEIPT', label: 'Delivery not received in system' },
  { value: 'TRANSFER_NOT_RECORDED', label: 'Transfer from another store not recorded' },
  { value: 'SOLD_WITHOUT_SCANNING', label: 'Sold without scanning (misc key)' },
  { value: 'MISCOUNT', label: 'Earlier count was wrong' },
  { value: 'DAMAGED', label: 'Damaged Goods' },
  { value: 'LOST', label: 'Lost / Missing' },
  { value: 'THEFT', label: 'Theft' },
  { value: 'RECEIVED', label: 'Received Shipment' },
  { value: 'RETURNED', label: 'Customer Return' },
  { value: 'EXPIRED', label: 'Expired' },
  { value: 'WASTE', label: 'Waste / Spoilage' },
  { value: 'CORRECTION', label: 'Data Correction' },
  { value: 'OTHER', label: 'Other' },
];

export const StockAdjustmentModal: React.FC<StockAdjustmentModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  product,
}) => {
  const [adjustmentType, setAdjustmentType] = useState<'add' | 'remove' | 'set'>('add');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('MANUAL_COUNT');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  // One key per intended adjustment: a retried submit cannot apply it twice.
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!product) return;

    const qty = parseInt(quantity);
    if (isNaN(qty) || qty < 0) {
      setError('Please enter a valid quantity');
      return;
    }

    if (adjustmentType === 'remove' && qty > product.stockQuantity) {
      setError(`Cannot remove more than current stock (${product.stockQuantity})`);
      return;
    }

    if (reason === 'OTHER' && !notes.trim()) {
      setError('Describe the reason when choosing Other');
      return;
    }

    setIsSubmitting(true);

    try {
      // Backend expects `quantity` as a delta (added to current stock)
      // and `type` as the reason string
      let delta: number;
      switch (adjustmentType) {
        case 'add':
          delta = qty;
          break;
        case 'remove':
          delta = -qty;
          break;
        case 'set':
          delta = qty - product.stockQuantity;
          break;
      }

      await productService.adjustInventory(product.id, {
        quantity: delta,
        type: reason,
        notes: notes || undefined,
        idempotencyKey: requestKey,
      });
      setRequestKey(crypto.randomUUID());

      toast.success('Stock adjusted successfully');
      resetForm();
      onSuccess();
      onClose();
    } catch (err: any) {
      const errorMessage = err.response?.data?.error || 'Failed to adjust stock';
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForm = () => {
    setAdjustmentType('add');
    setQuantity('');
    setReason('MANUAL_COUNT');
    setNotes('');
    setError('');
  };

  const getNewQuantity = () => {
    if (!product || !quantity) return null;
    const qty = parseInt(quantity);
    if (isNaN(qty)) return null;

    switch (adjustmentType) {
      case 'add':
        return product.stockQuantity + qty;
      case 'remove':
        return Math.max(0, product.stockQuantity - qty);
      case 'set':
        return qty;
    }
  };

  if (!isOpen || !product) return null;

  const newQuantity = getNewQuantity();

  return (
    <Modal isOpen={isOpen} onClose={() => { if (!isSubmitting) onClose(); }} title="Adjust Stock" size="sm">
      <div className="space-y-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="bg-destructive/10 text-destructive px-4 py-2 rounded-md text-sm">
                {error}
              </div>
            )}

            {/* Product Info */}
            <div className="p-3 bg-muted rounded-md">
              <p className="font-medium">{product.name}</p>
              <p className="text-sm text-muted-foreground">SKU: {product.sku}</p>
              <p className="text-sm mt-1">
                Current Stock: <span className="font-bold">{product.stockQuantity}</span>
              </p>
            </div>

            {/* Adjustment Type */}
            <div>
              <label className="block text-sm font-medium mb-2">
                Adjustment Type <span className="text-destructive">*</span>
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setAdjustmentType('add')}
                  className={`p-2 text-sm rounded-md border ${
                    adjustmentType === 'add'
                      ? 'bg-success/10 border-success text-success'
                      : 'border-input hover:bg-accent'
                  }`}
                >
                  Add
                </button>
                <button
                  type="button"
                  onClick={() => setAdjustmentType('remove')}
                  className={`p-2 text-sm rounded-md border ${
                    adjustmentType === 'remove'
                      ? 'bg-destructive/10 border-destructive text-destructive'
                      : 'border-input hover:bg-accent'
                  }`}
                >
                  Remove
                </button>
                <button
                  type="button"
                  onClick={() => setAdjustmentType('set')}
                  className={`p-2 text-sm rounded-md border ${
                    adjustmentType === 'set'
                      ? 'bg-primary/10 border-primary text-primary'
                      : 'border-input hover:bg-accent'
                  }`}
                >
                  Set To
                </button>
              </div>
            </div>

            {/* Quantity */}
            <div>
              <label className="block text-sm font-medium mb-1">
                Quantity <span className="text-destructive">*</span>
              </label>
              <Input
                type="number"
                min="0"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder={adjustmentType === 'set' ? 'New quantity' : 'Amount to adjust'}
                required
              />
              {newQuantity !== null && (
                <p className="text-sm mt-1">
                  New quantity will be:{' '}
                  <span className={`font-bold ${
                    newQuantity < 0 ? 'text-destructive' :
                    newQuantity === 0 ? 'text-warning' : 'text-success'
                  }`}>
                    {newQuantity}
                  </span>
                </p>
              )}
            </div>

            {/* Reason */}
            <div>
              <label className="block text-sm font-medium mb-1">
                Reason <span className="text-destructive">*</span>
              </label>
              <Select
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground"
                required
              >
                {ADJUSTMENT_REASONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium mb-1">Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional notes about this adjustment"
                className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground min-h-[80px]"
              />
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Adjusting...' : 'Adjust Stock'}
              </Button>
            </div>
          </form>
              </div>
    </Modal>
  );
};
