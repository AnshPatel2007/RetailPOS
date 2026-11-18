import { Select } from '@/components/ui/Select';
import React from 'react';
import { Store } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { locationService } from '@/services/api';
import { useScopedQuery } from '@/hooks/useScopedQuery';
import { Button } from '@/components/ui/Button';

interface Location {
  id: string;
  name: string;
}

interface StoreFilterSelectProps {
  value: string;
  onChange: (locationId: string) => void;
  className?: string;
}

/**
 * Store-selector dropdown for report/analytics pages — visible only to
 * SUPER_ADMIN, since ADMIN/MANAGER/CASHIER are always locked server-side to
 * their own store regardless of any locationId they send. Empty value means
 * "all stores blended", matching the backend's getLocationFilter contract.
 */
export const StoreFilterSelect: React.FC<StoreFilterSelectProps> = ({ value, onChange, className }) => {
  const { user } = useAuthStore();
  const choices = useScopedQuery<Location[]>(['store-selector'], signal => locationService.getAll(signal).then(res => res.data.data ?? res.data), user?.role === 'SUPER_ADMIN', 30000, { autoRefresh: false });
  const locations = choices.data || [];

  if (user?.role !== 'SUPER_ADMIN') return null;

  return (
    <div className={`relative ${className ?? ''}`}>
      <Store className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
      <Select
        aria-label="Store"
        searchable
        disabled={choices.loading}
        description={choices.loading ? 'Loading stores...' : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pl-8 pr-3 py-1.5 rounded-md border text-sm bg-background appearance-none"
      >
        <option value="">All Stores</option>
        {locations.map((loc) => (
          <option key={loc.id} value={loc.id}>{loc.name}</option>
        ))}
      </Select>
      {choices.error && <div role="status" className="flex items-center gap-2 text-xs"><span>Stores unavailable</span><Button type="button" variant="ghost" onClick={choices.refresh}>Retry</Button></div>}
    </div>
  );
};
