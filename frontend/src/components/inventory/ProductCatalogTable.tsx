import { RotateCcw, Trash2 } from 'lucide-react';
import type { Product } from '@/types';
import { formatCurrency } from '@/lib/utils';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ActionMenu } from '@/components/ui/ActionMenu';
import { ProductImage } from './ProductImage';

export function ProductCatalogTable({ products, canManage, onEdit, onAdjustStock, onDelete }: {
  products: Product[];
  canManage: boolean;
  onEdit: (product: Product) => void;
  onAdjustStock: (product: Product) => void;
  onDelete: (product: Product) => void;
}) {
  return <div className="products-table"><Table aria-label="Products">
    <TableHeader><TableRow>
      <TableHead>Product Name</TableHead>
      <TableHead className="text-right">Price</TableHead>
      <TableHead className="text-right">Cost</TableHead>
      <TableHead className="text-right">Stock</TableHead>
      <TableHead>Status</TableHead>
      <TableHead className="text-right">Actions</TableHead>
    </TableRow></TableHeader>
    <TableBody>{products.map(product => {
      const outOfStock = product.trackInventory && product.stockQuantity <= 0;
      const lowStock = product.trackInventory && product.stockQuantity > 0 && product.stockQuantity <= product.lowStockAlert;
      return <TableRow key={product.id}>
        <TableCell className="product-identity-cell">
          <div className="product-identity">
            <ProductImage src={product.image} name={product.name} />
            <div className="min-w-0">
              <p className="product-name">{product.name}</p>
              <p className="product-reference"><span>{product.sku}</span>{product.category && <><span aria-hidden="true"> · </span><span>{product.category.name}</span></>}</p>
            </div>
          </div>
        </TableCell>
        <TableCell className="product-price-cell text-right tabular-nums"><span className="product-mobile-label" aria-hidden="true">Price</span><span className="font-semibold">{formatCurrency(product.price)}</span></TableCell>
        <TableCell className="product-cost-cell text-right tabular-nums"><span className="product-mobile-label" aria-hidden="true">Cost</span><span>{formatCurrency(product.cost)}</span></TableCell>
        <TableCell className="product-stock-cell text-right tabular-nums">
          <span className="product-mobile-label" aria-hidden="true">Stock</span>
          <span className="font-medium">{product.trackInventory ? product.stockQuantity : '—'}</span>
          <span className="product-stock-threshold">{product.trackInventory ? `Min: ${product.lowStockAlert}` : 'Not tracked'}</span>
        </TableCell>
        <TableCell className="product-status-cell">
          {!product.isActive ? <Badge variant="secondary">Inactive</Badge>
            : outOfStock ? <Badge variant="destructive">Out of Stock</Badge>
              : lowStock ? <Badge variant="warning">Low Stock</Badge>
                : <span className="product-available-status"><span aria-hidden="true" />{product.trackInventory ? 'In Stock' : 'Stock not tracked'}</span>}
        </TableCell>
        <TableCell className="product-actions-cell text-right">
          {canManage && <div className="product-row-actions">
            <Button variant="ghost" size="sm" onClick={() => onEdit(product)} aria-label={`Edit ${product.name}`}>Edit</Button>
            <ActionMenu iconOnly label={`More actions for ${product.name}`} items={[
              { id: 'stock', label: 'Adjust Stock', icon: <RotateCcw size={16} />, onAction: () => onAdjustStock(product) },
              { id: 'delete', label: 'Delete product', icon: <Trash2 size={16} />, destructive: true, onAction: () => onDelete(product) },
            ]} />
          </div>}
        </TableCell>
      </TableRow>;
    })}</TableBody>
  </Table></div>;
}
