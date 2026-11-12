import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Store } from 'lucide-react';
import toast from 'react-hot-toast';
import { Select } from '@/components/ui/Select';
import { apiErrorMessage, locationService } from '@/services/api';
import { useScopedQuery } from '@/hooks/useScopedQuery';
import { useAdminViewStore } from '@/store/adminViewStore';
import { useAuthStore } from '@/store/authStore';

interface Location { id: string; name: string; isActive?: boolean }

/**
 * The store picker in the sidebar. Platform owners open any store's screens
 * (read-only) from here; staff with more than one store move their sign-in to
 * another of their stores.
 */
export function StoreSwitcher({ className }: { className?: string }) {
  const role = useAuthStore(state => state.user?.role);
  return role === 'SUPER_ADMIN' ? <PlatformStoreSwitcher className={className} /> : <MyStoreSwitcher className={className} />;
}

/** Platform owners switch between stores without going back through Stores → details → Preview. */
function PlatformStoreSwitcher({ className }: { className?: string }) {
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

/**
 * Staff with access to several stores work in one at a time. Switching is refused
 * (with the reason) while the register still holds this store's work: a sale in the
 * cart, held sales, an open payment, sales saved offline, or an open drawer.
 */
function MyStoreSwitcher({ className }: { className?: string }) {
  const navigate = useNavigate();
  const user = useAuthStore(state => state.user);
  const switchStore = useAuthStore(state => state.switchStore);
  const [switching, setSwitching] = useState(false);
  const stores = user?.stores || [];

  const choose = async (locationId: string) => {
    if (!user || switching || locationId === user.locationId) return;
    const target = stores.find(store => store.locationId === locationId);
    setSwitching(true);
    try {
      await switchStore(locationId);
      const now = useAuthStore.getState().user;
      toast.success(`Now working in ${now?.location?.name || target?.name || 'the selected store'}`);
      // A different role here may not open the current screen: start from the dashboard.
      if (now && now.role !== user.role) navigate('/dashboard');
    } catch (error) {
      toast.error(error instanceof Error && !(error as { response?: unknown }).response
        ? error.message
        : apiErrorMessage(error, 'Could not switch stores. Try again.'));
    } finally {
      setSwitching(false);
    }
  };

  return <div className={className}>
    <div className="relative">
      <Store className="pointer-events-none absolute left-2.5 top-1/2 z-[1] h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <Select aria-label="Switch store" disabled={switching} value={user?.locationId || ''} onChange={event => { void choose(event.target.value); }}
        className="w-full pl-8 text-sm" data-store-switcher>
        {stores.map(store => <option key={store.locationId} value={store.locationId}>{store.name}{store.isActive === false ? ' (inactive)' : ''}</option>)}
      </Select>
    </div>
  </div>;
}
