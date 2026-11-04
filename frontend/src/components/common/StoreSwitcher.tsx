import { useNavigate } from 'react-router-dom';
import { Store } from 'lucide-react';
import { Select } from '@/components/ui/Select';
import { locationService } from '@/services/api';
import { useScopedQuery } from '@/hooks/useScopedQuery';
import { useAdminViewStore } from '@/store/adminViewStore';

interface Location { id: string; name: string; isActive?: boolean }

/**
 * Platform owners open any store's screens (read-only) from here, and switch
 * between stores without going back through Stores → details → Preview.
 */
export function StoreSwitcher({ className }: { className?: string }) {
  const navigate = useNavigate();
  const { isAdminViewing, viewingLocationId, enterAdminView } = useAdminViewStore();
  const stores = useScopedQuery<Location[]>(['store-switcher'], signal => locationService.getAll(signal).then(res => res.data.data ?? res.data), true, 60000, { autoRefresh: false });
  const choose = (id: string) => {
    const store = stores.data?.find(item => item.id === id);
    if (!store || id === viewingLocationId) return;
    enterAdminView(store.id, store.name);
    // Already inside a store: stay on the same screen for the new store. From the admin shell: open its dashboard.
    if (!isAdminViewing) navigate('/dashboard');
  };
  return <div className={className}>
    <div className="relative">
      <Store className="pointer-events-none absolute left-2.5 top-1/2 z-[1] h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <Select aria-label={isAdminViewing ? 'Switch store' : 'Open a store'} placeholder={stores.loading ? 'Loading stores…' : 'Open a store…'}
        disabled={stores.loading || !!stores.error} value={isAdminViewing ? viewingLocationId || '' : ''} onChange={event => choose(event.target.value)}
        className="w-full pl-8 text-sm">
        {(stores.data || []).map(store => <option key={store.id} value={store.id}>{store.name}{store.isActive === false ? ' (inactive)' : ''}</option>)}
      </Select>
    </div>
    {stores.error && <button type="button" className="mt-1 text-xs text-muted-foreground underline" onClick={stores.refresh}>Stores unavailable — retry</button>}
  </div>;
}
