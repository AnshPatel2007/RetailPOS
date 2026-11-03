import { useScopedQuery } from '@/hooks/useScopedQuery';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useState } from 'react';
import { api } from '@/services/api';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

export interface PickableProduct { id: string; name: string; sku: string; stockQuantity: number; }
export function ProductPicker({ locationId, selectedIds, onSelect, inStockOnly = false }: { locationId: string; selectedIds: string[]; onSelect: (product: PickableProduct) => void; inStockOnly?: boolean }) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const settled = useDebouncedValue(search);
  const query = useScopedQuery<{ data: PickableProduct[]; pagination: { totalPages: number } }>(['product-picker', locationId, settled, page, inStockOnly], async signal =>
    (await api.get('/products', { params: { locationId, search: settled, page, limit: 20, isActive: true, trackInventory: true, ...(inStockOnly ? { inStock: true } : {}) }, signal })).data, !!locationId && search === settled, 0, { autoRefresh: false });
  const products = query.data?.data || [];
  const pages = Math.max(1, query.data?.pagination.totalPages || 1);
  const loading = query.loading || search !== settled;
  const error = query.error;
  return <div className="space-y-2">
    <Input label="Search products to add" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="Name, SKU or barcode" />
    {loading ? <p role="status" className="text-sm">Searching products...</p> : error ? <div role="alert">Unable to load products. <Button type="button" variant="outline" onClick={query.refresh}>Retry</Button></div> :
      <div className="max-h-48 overflow-auto border rounded">
        {products.map(product => <button type="button" key={product.id} disabled={selectedIds.includes(product.id)} className="flex justify-between gap-3 w-full text-left p-3 hover:bg-accent disabled:opacity-50" onClick={() => onSelect(product)}>
          <span>{product.name}<span className="block text-xs text-muted-foreground">{product.sku}</span></span><span className="text-sm whitespace-nowrap">{selectedIds.includes(product.id) ? 'Added' : product.stockQuantity + ' in stock'}</span>
        </button>)}
        {!products.length && <p className="p-3 text-sm text-muted-foreground">{inStockOnly ? 'No stocked products match this search.' : 'No tracked products match this search.'}</p>}
      </div>}
    <div className="flex justify-between items-center text-xs">
      <Button type="button" size="sm" variant="outline" disabled={loading || page <= 1} onClick={() => setPage(n => n - 1)}>Previous</Button>
      <span>Page {page} of {pages}</span>
      <Button type="button" size="sm" variant="outline" disabled={loading || page >= pages} onClick={() => setPage(n => n + 1)}>Next</Button>
    </div>
  </div>;
}
