import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { financialService } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import toast from 'react-hot-toast';

interface RecurringExpense {
  id: string;
  description: string;
  category: string;
  amount: number;
  frequency: string;
  nextDueDate: string;
  vendor?: string;
  isActive: boolean;
}

interface RecurringExpenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  recurringExpense?: RecurringExpense | null;
}

const EXPENSE_CATEGORIES = [
  'UTILITIES',
  'RENT',
  'PAYROLL',
  'SUPPLIES',
  'INVENTORY_PURCHASE',
  'MARKETING',
  'MAINTENANCE',
  'INSURANCE',
  'TAXES',
  'SHIPPING',
  'SOFTWARE',
  'EQUIPMENT',
  'OTHER',
];

const FREQUENCIES = [
  { value: 'DAILY', label: 'Daily' },
  { value: 'WEEKLY', label: 'Weekly' },
  { value: 'BIWEEKLY', label: 'Bi-weekly' },
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'QUARTERLY', label: 'Quarterly' },
  { value: 'YEARLY', label: 'Yearly' },
];

export const RecurringExpenseModal: React.FC<RecurringExpenseModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  recurringExpense,
}) => {
  const [formData, setFormData] = useState({
    description: '',
    category: '',
    amount: '',
    frequency: 'MONTHLY',
    nextDueDate: new Date().toISOString().split('T')[0],
    vendor: '',
    isActive: true,
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (recurringExpense) {
      setFormData({
        description: recurringExpense.description,
        category: recurringExpense.category,
        amount: recurringExpense.amount.toString(),
        frequency: recurringExpense.frequency,
        nextDueDate: recurringExpense.nextDueDate.split('T')[0],
        vendor: recurringExpense.vendor || '',
        isActive: recurringExpense.isActive,
      });
    } else {
      setFormData({
        description: '',
        category: '',
        amount: '',
        frequency: 'MONTHLY',
        nextDueDate: new Date().toISOString().split('T')[0],
        vendor: '',
        isActive: true,
      });
    }
    setError('');
  }, [recurringExpense, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!formData.description || !formData.category || !formData.amount || !formData.frequency) {
      setError('Please fill in all required fields');
      return;
    }

    setIsSubmitting(true);

    try {
      const data = {
        ...formData,
        amount: parseFloat(formData.amount),
      };

      if (recurringExpense) {
        await financialService.updateRecurringExpense(recurringExpense.id, data);
        toast.success('Recurring expense updated successfully');
      } else {
        await financialService.createRecurringExpense(data);
        toast.success('Recurring expense created successfully');
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      const errorMessage = err.response?.data?.error || `Failed to ${recurringExpense ? 'update' : 'create'} recurring expense`;
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{recurringExpense ? 'Edit Recurring Expense' : 'Add Recurring Expense'}</CardTitle>
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

            {/* Description */}
            <div>
              <label className="block text-sm font-medium mb-1">
                Description <span className="text-destructive">*</span>
              </label>
              <Input
                type="text"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="e.g., Monthly rent payment"
                required
              />
            </div>

            {/* Category */}
            <div>
              <label className="block text-sm font-medium mb-1">
                Category <span className="text-destructive">*</span>
              </label>
              <select
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground"
                required
              >
                <option value="">Select category</option>
                {EXPENSE_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Amount */}
              <div>
                <label className="block text-sm font-medium mb-1">
                  Amount <span className="text-destructive">*</span>
                </label>
                <Input
                  type="number"
                  step="0.01"
                  value={formData.amount}
                  onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                  placeholder="0.00"
                  required
                />
              </div>

              {/* Frequency */}
              <div>
                <label className="block text-sm font-medium mb-1">
                  Frequency <span className="text-destructive">*</span>
                </label>
                <select
                  value={formData.frequency}
                  onChange={(e) => setFormData({ ...formData, frequency: e.target.value })}
                  className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground"
                  required
                >
                  {FREQUENCIES.map((freq) => (
                    <option key={freq.value} value={freq.value}>
                      {freq.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Vendor */}
            <div>
              <label className="block text-sm font-medium mb-1">Vendor</label>
              <Input
                type="text"
                value={formData.vendor}
                onChange={(e) => setFormData({ ...formData, vendor: e.target.value })}
                placeholder="Vendor name"
              />
            </div>

            {/* Next Due Date */}
            <div>
              <label className="block text-sm font-medium mb-1">
                Next Due Date <span className="text-destructive">*</span>
              </label>
              <Input
                type="date"
                value={formData.nextDueDate}
                onChange={(e) => setFormData({ ...formData, nextDueDate: e.target.value })}
                required
              />
            </div>

            {/* Active Status */}
            <div>
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={formData.isActive}
                  onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                  className="rounded border-input"
                />
                <span className="text-sm">Active</span>
              </label>
              <p className="text-xs text-muted-foreground mt-1">
                Inactive recurring expenses won't generate new expenses
              </p>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Saving...' : recurringExpense ? 'Update' : 'Create'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};
