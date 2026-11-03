import React from 'react';
import { Package, Tag, DollarSign, BarChart3 } from 'lucide-react';
import { Product } from '@/types';
import { Modal } from '@/components/ui/Modal';
import { formatCurrency, formatDate } from '@/lib/utils';

interface InventoryDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: Product | null;
}

export const InventoryDetailsModal: React.FC<InventoryDetailsModalProps> = ({
  isOpen,
  onClose,
  product,
}) => {
  if (!isOpen || !product) return null;

  const profitMargin = product.price && product.cost
    ? ((product.price - product.cost) / product.price) * 100
    : 0;

  const inventoryValue = product.inventoryValue ?? null;
  const retailValue = product.price * product.stockQuantity;

  const getStockStatus = () => {
    if (!product.trackInventory) return { label: 'Not Tracked', color: 'text-muted-foreground' };
    if (product.stockQuantity === 0) return { label: 'Out of Stock', color: 'text-destructive' };
    if (product.stockQuantity <= product.lowStockAlert) return { label: 'Low Stock', color: 'text-warning' };
    return { label: 'In Stock', color: 'text-success' };
  };

  const stockStatus = getStockStatus();

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Product Details" size="lg">
      <div className="space-y-6">
          {/* Header with Image */}
          <div className="flex items-start gap-4">
            {product.image ? (
              <img
                src={product.image}
                alt={product.name}
                className="w-24 h-24 object-cover rounded-md border"
              />
            ) : (
              <div className="w-24 h-24 bg-muted rounded-md flex items-center justify-center">
                <Package className="h-12 w-12 text-muted-foreground" />
              </div>
            )}
            <div className="flex-1">
              <h3 className="text-2xl font-bold">{product.name}</h3>
              <p className="text-sm text-muted-foreground font-mono">{product.sku}</p>
              <div className="mt-2 flex items-center gap-2">
                <span
                  className={`px-2 py-1 rounded text-xs font-medium ${
                    product.isActive
                      ? 'bg-success/10 text-success'
                      : 'bg-destructive/10 text-destructive'
                  }`}
                >
                  {product.isActive ? 'Active' : 'Inactive'}
                </span>
                <span className={`px-2 py-1 rounded text-xs font-medium bg-muted ${stockStatus.color}`}>
                  {stockStatus.label}
                </span>
              </div>
            </div>
          </div>

          {/* Description */}
          {product.description && (
            <div>
              <p className="text-sm text-muted-foreground mb-1">Description</p>
              <p className="text-sm bg-muted p-3 rounded-md">{product.description}</p>
            </div>
          )}

          {/* Product Info Grid */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Category</p>
              <p className="font-medium">{product.category?.name || 'Uncategorized'}</p>
            </div>
            {product.barcode && (
              <div>
                <p className="text-sm text-muted-foreground">Barcode</p>
                <p className="font-medium font-mono">{product.barcode}</p>
              </div>
            )}
          </div>

          {/* Pricing Section */}
          <div>
            <h4 className="font-medium mb-3 flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Pricing & Profit
            </h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Cost</p>
                <p className="font-medium">{formatCurrency(product.cost)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Price</p>
                <p className="font-medium text-success">{formatCurrency(product.price)}</p>
              </div>
              {product.compareAtPrice && (
                <div>
                  <p className="text-sm text-muted-foreground">Compare at Price</p>
                  <p className="font-medium">{formatCurrency(product.compareAtPrice)}</p>
                </div>
              )}
              <div>
                <p className="text-sm text-muted-foreground">Profit Margin</p>
                <p className={`font-medium ${profitMargin > 0 ? 'text-success' : 'text-destructive'}`}>
                  {profitMargin.toFixed(1)}%
                </p>
              </div>
            </div>
          </div>

          {/* Inventory Section */}
          <div>
            <h4 className="font-medium mb-3 flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Inventory Details
            </h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Stock Quantity</p>
                <p className="font-medium text-lg">
                  {product.trackInventory ? product.stockQuantity : 'Not tracked'}
                </p>
              </div>
              {product.trackInventory && (
                <div>
                  <p className="text-sm text-muted-foreground">Low Stock Alert</p>
                  <p className="font-medium">{product.lowStockAlert}</p>
                </div>
              )}
              <div>
                <p className="text-sm text-muted-foreground">Inventory Value (Cost)</p>
                <p className="font-medium">{inventoryValue === null ? 'Unavailable' : formatCurrency(inventoryValue)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Retail Value</p>
                <p className="font-medium text-success">{formatCurrency(retailValue)}</p>
              </div>
            </div>
          </div>

          {/* Product Settings */}
          <div>
            <h4 className="font-medium mb-3 flex items-center gap-2">
              <Tag className="h-4 w-4" />
              Product Settings
            </h4>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center">
                <input
                  type="checkbox"
                  checked={product.trackInventory}
                  disabled
                  className="mr-2"
                />
                <span className="text-sm">Track Inventory</span>
              </div>
              <div className="flex items-center">
                <input
                  type="checkbox"
                  checked={product.isTaxable}
                  disabled
                  className="mr-2"
                />
                <span className="text-sm">Taxable</span>
              </div>
              <div className="flex items-center">
                <input
                  type="checkbox"
                  checked={product.allowBackorder}
                  disabled
                  className="mr-2"
                />
                <span className="text-sm">Allow Backorder</span>
              </div>
              <div className="flex items-center">
                <input
                  type="checkbox"
                  checked={product.isActive}
                  disabled
                  className="mr-2"
                />
                <span className="text-sm">Active</span>
              </div>
            </div>
          </div>

          {/* Metadata */}
          <div className="pt-4 border-t text-xs text-muted-foreground space-y-1">
            <p>Created: {formatDate(product.createdAt)}</p>
            <p>Last Updated: {formatDate(product.updatedAt)}</p>
          </div>
              </div>
    </Modal>
  );
};
