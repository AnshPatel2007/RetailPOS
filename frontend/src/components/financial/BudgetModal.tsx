import { today } from '@internationalized/date';
import { useCalendarTimezone } from '@/hooks/useCalendarTimezone';
import { formatEnumLabel } from '@/lib/utils';
import { Select } from '@/components/ui/Select';
import React, { useState, useEffect, useId } from 'react';
import { financialService } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import toast from 'react-hot-toast';

interface Budget {
  id: string;
  category: string;
  period: string;
  amount: number;
  startDate?: string;
  endDate?: string;
}

interface BudgetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  budget?: Budget | null;
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

const BUDGET_PERIODS = [
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'QUARTERLY', label: 'Quarterly' },
  { value: 'YEARLY', label: 'Yearly' },
];

export const BudgetModal: React.FC<BudgetModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  budget,
}) => {
  const timezone = useCalendarTimezone();
  const formId = useId();
  const [formData, setFormData] = useState({
    category: '',
    period: 'MONTHLY',
    amount: '',
    startDate: today(timezone).toString(),
    endDate: '',
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (budget) {
      setFormData({
        category: budget.category,
        period: budget.period,
        amount: budget.amount.toString(),
        startDate: budget.startDate ? budget.startDate.split('T')[0] : today(timezone).toString(),
        endDate: budget.endDate ? budget.endDate.split('T')[0] : '',
      });
    } else {
      setFormData({
        category: '',
        period: 'MONTHLY',
        amount: '',
        startDate: today(timezone).toString(),
        endDate: '',
      });
    }
    setError('');
  }, [budget, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!formData.category || !formData.amount || !formData.period) {
      setError('Please fill in all required fields');
      return;
    }

    setIsSubmitting(true);

    try {
      const data = {
        ...formData,
        amount: parseFloat(formData.amount),
      };

      if (budget) {
        await financialService.updateBudget(budget.id, data);
        toast.success('Budget updated successfully');
      } else {
        await financialService.createBudget(data);
        toast.success('Budget created successfully');
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      const errorMessage = err.response?.data?.error || `Failed to ${budget ? 'update' : 'create'} budget`;
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={() => { if (!isSubmitting) onClose(); }} title={budget ? 'Edit Budget' : 'Create Budget'} size="sm" footer={<div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" form={formId} disabled={isSubmitting}>
                {isSubmitting ? 'Saving...' : budget ? 'Update Budget' : 'Create Budget'}
              </Button>
            </div>}>
      <div className="space-y-4">
          <form id={formId} onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div role="alert" className="bg-destructive/10 text-destructive px-4 py-2 rounded-md text-sm">
                {error}
              </div>
            )}

            {/* Category */}
            <div>
              <Select
                label="Category"
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground"
                required
              >
                <option value="">Select category</option>
                {EXPENSE_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {formatEnumLabel(cat)}
                  </option>
                ))}
              </Select>
            </div>

            {/* Period */}
            <div>
              <Select
                label="Budget Period"
                value={formData.period}
                onChange={(e) => setFormData({ ...formData, period: e.target.value })}
                className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground"
                required
              >
                {BUDGET_PERIODS.map((period) => (
                  <option key={period.value} value={period.value}>
                    {period.label}
                  </option>
                ))}
              </Select>
            </div>

            {/* Amount */}
            <div>
              <Input
                label="Budget Amount"
                type="number"
                min="0.01"
                step="0.01"
                value={formData.amount}
                onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                placeholder="0.00"
                required
              />
            </div>

            {/* Date Range */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Input
                  label="Start Date"
                  type="date"
                  value={formData.startDate}
                  onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                />
              </div>
              <div>
                <Input
                  label="End Date"
                  type="date"
                  value={formData.endDate}
                  onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                />
              </div>
            </div>

          </form>
              </div>
    </Modal>
  );
};
