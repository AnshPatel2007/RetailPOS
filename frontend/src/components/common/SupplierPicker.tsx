import { useState } from 'react';
import { Truck } from 'lucide-react';
import { api } from '@/services/api';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/LoadingState';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useScopedQuery } from '@/hooks/useScopedQuery';
import { formatCurrency } from '@/lib/utils';

export interface PickableSupplier { id: string; name: string; minimumOrder?: number }

const SHOWN = 8;

/** Type to find a supplier; once chosen it collapses to a card with a Change button. */
export function SupplierPicker({ locationId, selected, onSelect }: { locationId?: string; selected: PickableSupplier | null; onSelect: (supplier: PickableSupplier) => void }) {
  const [search, setSearch] = useState('');
  const [changing, setChanging] = useState(false);
  const settled = useDebouncedValue(search);
  const picking = !selected || changing;
  const query = useScopedQuery<{ data: PickableSupplier[]; pagination: { total?: number; totalPages: number } }>(['supplier-picker', locationId, settled], async signal =>
    (await api.get('/suppliers', { params: { locationId, search: settled, page: 1, limit: SHOWN, isActive: true }, signal })).data, picking && search === settled, 0, { autoRefresh: false });
  const rows = query.data?.data || [];
  const more = (query.data?.pagination.totalPages || 1) > 1;
  const loading = query.loading || search !== settled;

  if (!picking && selected) return <div className="flex items-center gap-3 rounded-md border bg-muted/40 p-3">
    <Truck className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
    <div className="min-w-0 flex-1">
      <p className="text-xs text-muted-foreground" aria-hidden="true">Supplier</p>
      <p className="truncate text-sm font-medium" role="status"><span className="sr-only">Selected supplier: </span>{selected.name}</p>
      {selected.minimumOrder ? <p className="text-xs text-muted-foreground">Minimum order {formatCurrency(selected.minimumOrder)}</p> : null}
    </div>
    <Button type="button" variant="outline" size="sm" onClick={() => setChanging(true)}>Change</Button>
  </div>;

  return <div className="space-y-2">
    <Input label="Supplier" autoFocus={changing} value={search} onChange={event => setSearch(event.target.value)} placeholder="Type a name, contact or email" />
    <div className="max-h-56 overflow-auto rounded-md border" aria-busy={loading}>
      {loading ? <div role="status" className="flex items-center gap-2 p-3 text-sm text-muted-foreground"><Spinner size="sm" />Finding suppliers…</div>
        : query.error ? <div role="alert" className="flex items-center justify-between gap-2 p-3 text-sm">Suppliers didn't load.<Button type="button" size="sm" variant="outline" onClick={query.refresh}>Retry</Button></div>
        : <>
          {rows.map(supplier => <button type="button" key={supplier.id} aria-pressed={selected?.id === supplier.id}
            className="block min-h-11 w-full border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-accent aria-pressed:bg-primary/10"
            onClick={() => { onSelect(supplier); setChanging(false); setSearch(''); }}>
            <span className="font-medium">{supplier.name}</span>
            {supplier.minimumOrder ? <span className="block text-xs text-muted-foreground">Minimum order {formatCurrency(supplier.minimumOrder)}</span> : null}
          </button>)}
          {!rows.length && <p className="p-3 text-sm text-muted-foreground">{settled ? 'No active supplier matches. Check the spelling, or add the supplier in the Suppliers tab.' : 'No active suppliers yet. Add one in the Suppliers tab first.'}</p>}
          {more && <p className="px-3 py-2 text-xs text-muted-foreground">Showing the first {SHOWN}. Keep typing to narrow the list.</p>}
        </>}
    </div>
    {changing && selected && <Button type="button" variant="ghost" size="sm" onClick={() => { setChanging(false); setSearch(''); }}>Keep {selected.name}</Button>}
  </div>;
}
