import React, { useState } from 'react';
import { X } from 'lucide-react';
import { productService } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Product } from '@/types';
import toast from 'react-hot-toast';

interface StockAdjustmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  product: Product | null;
}

const ADJUSTMENT_REASONS = [
  { value: 'MANUAL_COUNT', label: 'Manual Count / Cycle Count' },
  { value: 'DAMAGED', label: 'Damaged Goods' },
  { value: 'LOST', label: 'Lost / Missing' },
  { value: 'THEFT', label: 'Theft' },
  { value: 'RECEIVED', label: 'Received Shipment' },
  { value: 'RETURNED', label: 'Customer Return' },
  { value: 'EXPIRED', label: 'Expired' },
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

    setIsSubmitting(true);

    try {
      let newQuantity: number;
      switch (adjustmentType) {
        case 'add':
          newQuantity = product.stockQuantity + qty;
          break;
        case 'remove':
          newQuantity = product.stockQuantity - qty;
          break;
        case 'set':
          newQuantity = qty;
          break;
      }

      await productService.adjustInventory(product.id, {
        quantity: newQuantity,
        adjustmentType,
        adjustmentQuantity: qty,
        reason,
        notes: notes || undefined,
      });

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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Adjust Stock</CardTitle>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </CardHeader>
        <CardContent>
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
                      ? 'bg-green-500/10 border-green-500 text-green-500'
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
                      ? 'bg-red-500/10 border-red-500 text-red-500'
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
              <select
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
              </select>
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
        </CardContent>
      </Card>
    </div>
  );
};
