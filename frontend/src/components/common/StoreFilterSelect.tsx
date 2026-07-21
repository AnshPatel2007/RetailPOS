import React, { useEffect, useState } from 'react';
import { Store } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { locationService } from '@/services/api';

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
  const [locations, setLocations] = useState<Location[]>([]);

  useEffect(() => {
    if (user?.role !== 'SUPER_ADMIN') return;
    locationService
      .getAll()
      .then((res) => setLocations(res.data.data ?? res.data))
      .catch(() => {});
  }, [user?.role]);

  if (user?.role !== 'SUPER_ADMIN') return null;

  return (
    <div className={`relative ${className ?? ''}`}>
      <Store className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pl-8 pr-3 py-1.5 rounded-md border text-sm bg-background appearance-none"
      >
        <option value="">All Stores</option>
        {locations.map((loc) => (
          <option key={loc.id} value={loc.id}>{loc.name}</option>
        ))}
      </select>
    </div>
  );
};
