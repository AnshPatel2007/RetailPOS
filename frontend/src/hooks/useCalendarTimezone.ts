import { useAuthStore } from '@/store/authStore';
import { useStoreSettingsStore } from '@/store/storeSettingsStore';
import { useEffectiveLocation } from './useEffectiveLocation';

/** Reuse scoped store metadata already loaded by App, including platform previews. */
export function useCalendarTimezone() {
  const { locationId } = useEffectiveLocation();
  const assigned = useAuthStore(state => state.user?.location?.timezone);
  const scoped = useStoreSettingsStore(state => state.locationId === locationId && state.isLoaded ? state.timezone : null);
  return scoped || assigned || 'UTC';
}
