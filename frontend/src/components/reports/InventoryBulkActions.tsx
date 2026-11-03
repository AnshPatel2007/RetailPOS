import { ADJUSTMENT_REASONS } from '@/components/inventory/StockAdjustmentModal';
import { Select } from '@/components/ui/Select';
import React, { useEffect, useState } from 'react';
import { Package, DollarSign, Tag, Power, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { productService } from '@/services/api';

interface InventoryBulkActionsProps {
  selectedIds: string[];
  onClearSelection: () => void;
  onSuccess: () => void;
  categories?: Array<{ id: string; name: string }>;
}

export const InventoryBulkActions: React.FC<InventoryBulkActionsProps> = ({
  selectedIds,
  onClearSelection,
  onSuccess,
  categories = [],
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [showStockInput, setShowStockInput] = useState(false);
  const [showPriceInput, setShowPriceInput] = useState(false);
  const [showCategoryInput, setShowCategoryInput] = useState(false);
  const [stockQuantity, setStockQuantity] = useState('');
  const [stockType, setStockType] = useState<'set' | 'add'>('add');
  const [priceUpdate, setPriceUpdate] = useState('');
  const [costUpdate, setCostUpdate] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [stockVersions, setStockVersions] = useState<Record<string, number>>({});
  const [stockReason, setStockReason] = useState('MANUAL_COUNT');
  const selectionKey = selectedIds.join(',');
  useEffect(() => {
    if (!showStockInput) return;
    let active = true;
    setStockVersions({});
    productService.getAll({ ids: selectionKey, limit: 1000 }).then(({ data }) => {
      if (active) setStockVersions(Object.fromEntries(data.data.map((p: { id: string; stockVersion: number }) => [p.id, p.stockVersion])));
    }).catch(() => { if (active) setError('Could not load current stock. Close and reopen stock adjustment to retry.'); });
    return () => { active = false; };
  }, [showStockInput, selectionKey]);

  const handleBulkStockUpdate = async () => {
    if (!stockQuantity) {
      setError('Please enter a stock quantity');
      return;
    }

    const quantity = Number(stockQuantity);
    if (!Number.isSafeInteger(quantity)) {
      setError('Invalid stock quantity');
      return;
    }
    if (stockType === 'set' && selectedIds.some(id => stockVersions[id] === undefined)) {
      setError('Current stock is still loading. Close and reopen stock adjustment if it cannot load.');
      return;
    }

    if (!confirm(`Are you sure you want to ${stockType === 'set' ? 'set' : 'add'} ${quantity} units for ${selectedIds.length} product(s)?`)) {
      return;
    }

    setIsLoading(true);
    setError('');
    try {
      const updates = selectedIds.map((productId) => ({
        productId,
        quantity,
        type: stockType,
        expectedVersion: stockType === 'set' ? stockVersions[productId] : undefined,
      }));
      await productService.bulkUpdateStock(updates, stockReason);
      onSuccess();
      onClearSelection();
      setShowStockInput(false);
      setStockQuantity('');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to update stock');
    } finally {
      setIsLoading(false);
    }
  };

  const handleBulkPriceUpdate = async () => {
    if (!priceUpdate && !costUpdate) {
      setError('Please enter price or cost update');
      return;
    }

    const price = priceUpdate ? parseFloat(priceUpdate) : undefined;
    const cost = costUpdate ? parseFloat(costUpdate) : undefined;

    if ((price !== undefined && isNaN(price)) || (cost !== undefined && isNaN(cost))) {
      setError('Invalid price or cost value');
      return;
    }

    if (!confirm(`Are you sure you want to update pricing for ${selectedIds.length} product(s)?`)) {
      return;
    }

    setIsLoading(true);
    setError('');
    try {
      await productService.bulkUpdatePrice(selectedIds, price, cost);
      onSuccess();
      onClearSelection();
      setShowPriceInput(false);
      setPriceUpdate('');
      setCostUpdate('');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to update prices');
    } finally {
      setIsLoading(false);
    }
  };

  const handleBulkCategoryUpdate = async () => {
    if (!selectedCategory) {
      setError('Please select a category');
      return;
    }

    if (!confirm(`Are you sure you want to update category for ${selectedIds.length} product(s)?`)) {
      return;
    }

    setIsLoading(true);
    setError('');
    try {
      await productService.bulkUpdateCategory(selectedIds, selectedCategory);
      onSuccess();
      onClearSelection();
      setShowCategoryInput(false);
      setSelectedCategory('');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to update category');
    } finally {
      setIsLoading(false);
    }
  };

  const handleBulkActivate = async (isActive: boolean) => {
    if (!confirm(`Are you sure you want to ${isActive ? 'activate' : 'deactivate'} ${selectedIds.length} product(s)?`)) {
      return;
    }

    setIsLoading(true);
    setError('');
    try {
      await productService.bulkToggleActive(selectedIds, isActive);
      onSuccess();
      onClearSelection();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to update product status');
    } finally {
      setIsLoading(false);
    }
  };

  if (selectedIds.length === 0) return null;

  return (
    <div className="bg-primary/10 border border-primary/20 rounded-md p-4 mb-4">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm font-medium">
            {selectedIds.length} product{selectedIds.length > 1 ? 's' : ''} selected
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={onClearSelection}
            disabled={isLoading}
          >
            <X className="h-4 w-4 mr-1" />
            Deselect All
          </Button>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setShowStockInput(!showStockInput);
              setShowPriceInput(false);
              setShowCategoryInput(false);
            }}
            disabled={isLoading}
          >
            <Package className="h-4 w-4 mr-1" />
            Update Stock
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setShowPriceInput(!showPriceInput);
              setShowStockInput(false);
              setShowCategoryInput(false);
            }}
            disabled={isLoading}
          >
            <DollarSign className="h-4 w-4 mr-1" />
            Update Price
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setShowCategoryInput(!showCategoryInput);
              setShowStockInput(false);
              setShowPriceInput(false);
            }}
            disabled={isLoading}
          >
            <Tag className="h-4 w-4 mr-1" />
            Change Category
          </Button>
          <Button
            size="sm"
            variant="default"
            onClick={() => handleBulkActivate(true)}
            disabled={isLoading}
            className="bg-success hover:bg-success/90"
          >
            <Power className="h-4 w-4 mr-1" />
            Activate
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => handleBulkActivate(false)}
            disabled={isLoading}
          >
            <Power className="h-4 w-4 mr-1" />
            Deactivate
          </Button>
        </div>

        {/* Stock Update Input */}
        {showStockInput && (
          <div className="border-t pt-3 space-y-2">
            <div className="flex gap-2">
              <Select
                value={stockType}
                onChange={(e) => setStockType(e.target.value as 'set' | 'add')}
                className="px-3 py-1 border rounded-md text-sm"
              >
                <option value="add">Add to existing</option>
                <option value="set">Set quantity</option>
              </Select>
              <Input
                type="number"
                value={stockQuantity}
                onChange={(e) => setStockQuantity(e.target.value)}
                placeholder="Enter quantity"
                className="flex-1"
              />
              <Button size="sm" onClick={handleBulkStockUpdate} disabled={isLoading}>
                Apply
              </Button>
            </div>
            <Select value={stockReason} onChange={(e) => setStockReason(e.target.value)} aria-label="Reason for stock change" className="px-3 py-1 border rounded-md text-sm">
              {ADJUSTMENT_REASONS.filter(r => r.value !== 'OTHER').map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </Select>
          </div>
        )}

        {/* Price Update Input */}
        {showPriceInput && (
          <div className="border-t pt-3 space-y-2">
            <div className="grid grid-cols-3 gap-2">
              <Input
                type="number"
                step="0.01"
                value={priceUpdate}
                onChange={(e) => setPriceUpdate(e.target.value)}
                placeholder="New price"
              />
              <Input
                type="number"
                step="0.01"
                value={costUpdate}
                onChange={(e) => setCostUpdate(e.target.value)}
                placeholder="New cost"
              />
              <Button size="sm" onClick={handleBulkPriceUpdate} disabled={isLoading}>
                Apply
              </Button>
            </div>
          </div>
        )}

        {/* Category Update Input */}
        {showCategoryInput && (
          <div className="border-t pt-3 space-y-2">
            <div className="flex gap-2">
              <Select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="flex-1 px-3 py-2 border rounded-md text-sm"
              >
                <option value="">Select a category</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </Select>
              <Button size="sm" onClick={handleBulkCategoryUpdate} disabled={isLoading}>
                Apply
              </Button>
            </div>
          </div>
        )}

        {error && (
          <div className="text-sm text-destructive">{error}</div>
        )}
      </div>
    </div>
  );
};
