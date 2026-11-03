import { useScopedQuery } from '@/hooks/useScopedQuery';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useState } from 'react';
import { api } from '@/services/api';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

export interface PickableSupplier { id: string; name: string; minimumOrder?: number }
export function SupplierPicker({ locationId, selected, onSelect }: { locationId?: string; selected: PickableSupplier | null; onSelect: (supplier: PickableSupplier) => void }) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const settled = useDebouncedValue(search);
  const query = useScopedQuery<{ data: PickableSupplier[]; pagination: { totalPages: number } }>(['supplier-picker', locationId, settled, page], async signal =>
    (await api.get('/suppliers', { params: { locationId, search: settled, page, limit: 10, isActive: true }, signal })).data, search === settled, 0, { autoRefresh: false });
  const rows = query.data?.data || [];
  const pages = Math.max(1, query.data?.pagination.totalPages || 1);
  const loading = query.loading || search !== settled;
  const error = query.error;
  return <div className="space-y-2">
    <Input label="Search suppliers to select" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} placeholder="Supplier name, contact or email" />
    {selected && <p className="text-sm font-medium" role="status">Selected supplier: {selected.name}</p>}
    {loading ? <p role="status" className="text-sm">Searching suppliers…</p> : error ? <div role="alert">Unable to load suppliers. <Button type="button" variant="outline" onClick={query.refresh}>Retry</Button></div> :
      <div className="max-h-40 overflow-auto border rounded">
        {rows.map(supplier => <button type="button" key={supplier.id} aria-pressed={selected?.id === supplier.id} className="block min-h-11 w-full text-left p-3 hover:bg-accent aria-pressed:bg-primary/10" onClick={() => onSelect(supplier)}>{supplier.name}{supplier.minimumOrder ? <span className="block text-xs text-muted-foreground">Minimum order: ${supplier.minimumOrder.toFixed(2)}</span> : null}</button>)}
        {!rows.length && <p className="p-3 text-sm text-muted-foreground">No active suppliers match. Add a supplier in the Suppliers view first.</p>}
      </div>}
    <div className="flex justify-between items-center text-xs">
      <Button type="button" size="sm" variant="outline" disabled={loading || page <= 1} onClick={() => setPage(value => value - 1)}>Previous suppliers</Button>
      <span>Page {page} of {pages}</span>
      <Button type="button" size="sm" variant="outline" disabled={loading || page >= pages} onClick={() => setPage(value => value + 1)}>Next suppliers</Button>
    </div>
  </div>;
}
