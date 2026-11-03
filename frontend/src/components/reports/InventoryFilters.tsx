import React from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { FilterSection } from '@/components/common/FilterSection';

interface InventoryFiltersProps {
  filters: {
    category: string[];
    stockStatus: string[];
    minPrice: string;
    maxPrice: string;
    trackInventory: boolean | null;
    isActive: boolean | null;
    startDate: string;
    endDate: string;
    showCharts: boolean;
  };
  onFilterChange: (filters: any) => void;
  onClear: () => void;
  categories?: Array<{ id: string; name: string }>;
}

const STOCK_STATUSES = ['Low Stock', 'Out of Stock', 'In Stock', 'Overstocked'];

export const InventoryFilters: React.FC<InventoryFiltersProps> = ({
  filters,
  onFilterChange,
  onClear,
  categories = [],
}) => {
  const handleCategoryToggle = (categoryId: string) => {
    const newCategories = filters.category.includes(categoryId)
      ? filters.category.filter((c) => c !== categoryId)
      : [...filters.category, categoryId];
    onFilterChange({ ...filters, category: newCategories });
  };

  const handleStockStatusToggle = (status: string) => {
    const newStatuses = filters.stockStatus.includes(status)
      ? filters.stockStatus.filter((s) => s !== status)
      : [...filters.stockStatus, status];
    onFilterChange({ ...filters, stockStatus: newStatuses });
  };

  const hasActiveFilters =
    filters.category.length > 0 ||
    filters.stockStatus.length > 0 ||
    filters.minPrice ||
    filters.maxPrice ||
    filters.trackInventory !== null ||
    filters.isActive !== null;


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

      {/* Single Column Filter Layout with Vertical Scroll */}
      <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
        {/* Price Range Section */}
        <FilterSection
          title="Price Range"
          summary={
            filters.minPrice || filters.maxPrice
              ? `$${filters.minPrice || '0'} - $${filters.maxPrice || '∞'}`
              : ''
          }
          defaultOpen={false}
        >
          <div className="space-y-1.5">
            <Input
              type="number"
              step="0.01"
              value={filters.minPrice}
              onChange={(e) =>
                onFilterChange({ ...filters, minPrice: e.target.value })
              }
              placeholder="Min price"
              className="text-xs"
            />
            <Input
              type="number"
              step="0.01"
              value={filters.maxPrice}
              onChange={(e) =>
                onFilterChange({ ...filters, maxPrice: e.target.value })
              }
              placeholder="Max price"
              className="text-xs"
            />
          </div>
        </FilterSection>

        {/* Stock Status Section */}
        <FilterSection
          title="Stock Status"
          summary={
            filters.stockStatus.length > 0
              ? `${filters.stockStatus.length} selected`
              : ''
          }
          defaultOpen={false}
        >
          <div className="space-y-1">
            {STOCK_STATUSES.map((status) => (
              <button
                key={status}
                onClick={() => handleStockStatusToggle(status)}
                className={`w-full px-2 py-1 text-xs rounded border transition-colors text-left ${
                  filters.stockStatus.includes(status)
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background border-border hover:bg-accent'
                }`}
              >
                {status}
              </button>
            ))}
          </div>
        </FilterSection>

        {/* Inventory Tracking Section */}
        <FilterSection
          title="Inventory Tracking"
          summary={
            filters.trackInventory !== null
              ? filters.trackInventory
                ? 'Tracked'
                : 'Not Tracked'
              : ''
          }
          defaultOpen={false}
        >
          <div className="space-y-1">
            <button
              onClick={() =>
                onFilterChange({
                  ...filters,
                  trackInventory: filters.trackInventory === true ? null : true,
                })
              }
              className={`w-full px-2 py-1 text-xs rounded border transition-colors text-left ${
                filters.trackInventory === true
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background border-border hover:bg-accent'
              }`}
            >
              Tracked
            </button>
            <button
              onClick={() =>
                onFilterChange({
                  ...filters,
                  trackInventory: filters.trackInventory === false ? null : false,
                })
              }
              className={`w-full px-2 py-1 text-xs rounded border transition-colors text-left ${
                filters.trackInventory === false
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background border-border hover:bg-accent'
              }`}
            >
              Not Tracked
            </button>
          </div>
        </FilterSection>

        {/* Product Status Section */}
        <FilterSection
          title="Product Status"
          summary={
            filters.isActive !== null
              ? filters.isActive
                ? 'Active'
                : 'Inactive'
              : ''
          }
          defaultOpen={false}
        >
          <div className="space-y-1">
            <button
              onClick={() =>
                onFilterChange({
                  ...filters,
                  isActive: filters.isActive === true ? null : true,
                })
              }
              className={`w-full px-2 py-1 text-xs rounded border transition-colors text-left ${
                filters.isActive === true
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background border-border hover:bg-accent'
              }`}
            >
              Active
            </button>
            <button
              onClick={() =>
                onFilterChange({
                  ...filters,
                  isActive: filters.isActive === false ? null : false,
                })
              }
              className={`w-full px-2 py-1 text-xs rounded border transition-colors text-left ${
                filters.isActive === false
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background border-border hover:bg-accent'
              }`}
            >
              Inactive
            </button>
          </div>
        </FilterSection>

        {/* Categories Section */}
        {categories.length > 0 && (
          <FilterSection
            title="Categories"
            summary={
              filters.category.length > 0
                ? `${filters.category.length} selected`
                : ''
            }
            defaultOpen={false}
          >
            <div className="space-y-1">
              {categories.map((category) => (
                <button
                  key={category.id}
                  onClick={() => handleCategoryToggle(category.id)}
                  className={`w-full px-2 py-1 text-xs rounded border transition-colors text-left ${
                    filters.category.includes(category.id)
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background border-border hover:bg-accent'
                  }`}
                >
                  {category.name}
                </button>
              ))}
            </div>
          </FilterSection>
        )}
      </div>
    </div>
  );
};
