import { today } from '@internationalized/date';
import { useCalendarTimezone } from '@/hooks/useCalendarTimezone';
import { formatEnumLabel } from '@/lib/utils';
import { Select } from '@/components/ui/Select';
import React, { useState, useEffect, useId } from 'react';
import { financialService } from '@/services/api';
import { useAuthStore } from '@/store/authStore';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import toast from 'react-hot-toast';
import { Checkbox } from '@/components/ui/Checkbox';

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
  const timezone = useCalendarTimezone();
  // Payroll is the store owner's to set up, as on the single-expense form.
  const role = useAuthStore(state => state.user?.role);
  const formId = useId();
  const [formData, setFormData] = useState({
    description: '',
    category: '',
    amount: '',
    frequency: 'MONTHLY',
    nextDueDate: today(timezone).toString(),
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
        nextDueDate: today(timezone).toString(),
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
    <Modal isOpen={isOpen} onClose={() => { if (!isSubmitting) onClose(); }} title={recurringExpense ? 'Edit Recurring Expense' : 'Add Recurring Expense'} size="sm" footer={<div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" form={formId} disabled={isSubmitting}>
                {isSubmitting ? 'Saving...' : recurringExpense ? 'Update' : 'Create'}
              </Button>
            </div>}>
      <div className="space-y-4">
          <form id={formId} onSubmit={handleSubmit} className="space-y-4">
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
              <Select
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground"
                required
              >
                <option value="">Select category</option>
                {EXPENSE_CATEGORIES.filter(cat => cat !== 'PAYROLL' || role === 'ADMIN' || formData.category === 'PAYROLL').map((cat) => (
                  <option key={cat} value={cat}>
                    {formatEnumLabel(cat)}
                  </option>
                ))}
              </Select>
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
                <Select
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
                </Select>
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

            {/* Pausing only matters for one that already exists; new ones always start active. */}
            {recurringExpense && <Checkbox label="Active" description="Paused recurring expenses don't create new expenses."
              checked={formData.isActive} onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })} />}

          </form>
              </div>
    </Modal>
  );
};
