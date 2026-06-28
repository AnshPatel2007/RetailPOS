import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { financialService } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
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
  const [formData, setFormData] = useState({
    category: '',
    period: 'MONTHLY',
    amount: '',
    startDate: new Date().toISOString().split('T')[0],
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
        startDate: budget.startDate ? budget.startDate.split('T')[0] : new Date().toISOString().split('T')[0],
        endDate: budget.endDate ? budget.endDate.split('T')[0] : '',
      });
    } else {
      setFormData({
        category: '',
        period: 'MONTHLY',
        amount: '',
        startDate: new Date().toISOString().split('T')[0],
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{budget ? 'Edit Budget' : 'Create Budget'}</CardTitle>
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

            {/* Period */}
            <div>
              <label className="block text-sm font-medium mb-1">
                Budget Period <span className="text-destructive">*</span>
              </label>
              <select
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
              </select>
            </div>

            {/* Amount */}
            <div>
              <label className="block text-sm font-medium mb-1">
                Budget Amount <span className="text-destructive">*</span>
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

            {/* Date Range */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Start Date</label>
                <Input
                  type="date"
                  value={formData.startDate}
                  onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">End Date</label>
                <Input
                  type="date"
                  value={formData.endDate}
                  onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Saving...' : budget ? 'Update Budget' : 'Create Budget'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};
