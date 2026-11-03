import { formatEnumLabel } from '@/lib/utils';
import React from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { FilterSection } from '@/components/common/FilterSection';

interface ExpenseFiltersProps {
  filters: {
    category: string[];
    status: string[];
    startDate: string;
    endDate: string;
    minAmount: string;
    maxAmount: string;
    showCharts: boolean;
  };
  onFilterChange: (filters: any) => void;
  onClear: () => void;
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

const EXPENSE_STATUSES = ['PENDING', 'APPROVED', 'PAID', 'REJECTED'];

export const ExpenseFilters: React.FC<ExpenseFiltersProps> = ({
  filters,
  onFilterChange,
  onClear,
}) => {
  const handleCategoryToggle = (category: string) => {
    const newCategories = filters.category.includes(category)
      ? filters.category.filter((c) => c !== category)
      : [...filters.category, category];
    onFilterChange({ ...filters, category: newCategories });
  };

  const handleStatusToggle = (status: string) => {
    const newStatuses = filters.status.includes(status)
      ? filters.status.filter((s) => s !== status)
      : [...filters.status, status];
    onFilterChange({ ...filters, status: newStatuses });
  };

  const hasActiveFilters =
    filters.category.length > 0 ||
    filters.status.length > 0 ||
    filters.minAmount ||
    filters.maxAmount;


  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b">
        <h3 className="font-medium text-sm">Filters</h3>
        {hasActiveFilters && (
          <Button variant="outline" size="sm" onClick={onClear}>
            <X className="h-3 w-3 mr-1" />
            <span className="text-xs">Clear All</span>
          </Button>
        )}
      </div>

      {/* Horizontal Filter Layout with Wrapping */}
      <div className="flex flex-wrap gap-4">
        {/* Amount Range Section */}
        <div className="min-w-[200px] flex-1">
          <FilterSection
            title="Amount Range"
            summary={
              filters.minAmount || filters.maxAmount
                ? `$${filters.minAmount || '0'} - $${filters.maxAmount || '∞'}`
                : ''
            }
            defaultOpen={false}
          >
            <div className="grid grid-cols-2 gap-1.5">
              <Input
                type="number"
                step="0.01"
                value={filters.minAmount}
                onChange={(e) =>
                  onFilterChange({ ...filters, minAmount: e.target.value })
                }
                placeholder="Min"
                className="text-xs"
              />
              <Input
                type="number"
                step="0.01"
                value={filters.maxAmount}
                onChange={(e) =>
                  onFilterChange({ ...filters, maxAmount: e.target.value })
                }
                placeholder="Max"
                className="text-xs"
              />
            </div>
          </FilterSection>
        </div>

        {/* Status Section */}
        <div className="min-w-[200px] flex-1">
          <FilterSection
            title="Status"
            summary={
              filters.status.length > 0 ? `${filters.status.length} selected` : ''
            }
            defaultOpen={false}
          >
            <div className="grid grid-cols-2 gap-1">
              {EXPENSE_STATUSES.map((status) => (
                <button
                  key={status}
                  onClick={() => handleStatusToggle(status)} aria-pressed={filters.status.includes(status)}
                  className={`px-1.5 py-0.5 text-xs rounded border transition-colors ${
                    filters.status.includes(status)
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background border-border hover:bg-accent'
                  }`}
                >
                  {formatEnumLabel(status)}
                </button>
              ))}
            </div>
          </FilterSection>
        </div>

        {/* Categories Section */}
        <div className="min-w-[280px] flex-1">
          <FilterSection
            title="Categories"
            summary={
              filters.category.length > 0
                ? `${filters.category.length} selected`
                : ''
            }
            defaultOpen={false}
          >
            <div className="grid grid-cols-2 gap-1 max-h-32 overflow-y-auto">
              {EXPENSE_CATEGORIES.map((category) => (
                <button
                  key={category}
                  onClick={() => handleCategoryToggle(category)} aria-pressed={filters.category.includes(category)}
                  className={`px-1.5 py-0.5 text-xs rounded border transition-colors text-left ${
                    filters.category.includes(category)
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background border-border hover:bg-accent'
                  }`}
                >
                  {formatEnumLabel(category)}
                </button>
              ))}
            </div>
          </FilterSection>
        </div>
      </div>
    </div>
  );
};
