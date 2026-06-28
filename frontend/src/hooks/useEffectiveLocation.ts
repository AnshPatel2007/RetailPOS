import { useMemo } from 'react';
import { useAuthStore } from '../store/authStore';
import { useAdminViewStore } from '../store/adminViewStore';

export interface EffectiveLocation {
  locationId: string | null | undefined;
  isReadOnly: boolean;
  isAdminViewing: boolean;
  storeName: string | null;
  isSuperAdmin: boolean;
}

/**
 * Hook to determine the effective location for the current user
 * Takes into account admin view mode for SUPER_ADMIN users
 *
 * @returns {EffectiveLocation} Object containing location info and read-only status
 */
export const useEffectiveLocation = (): EffectiveLocation => {
  const { user } = useAuthStore();
  const { isAdminViewing, viewingLocationId, viewingStoreName } = useAdminViewStore();

  const result = useMemo(() => {
    const isSuperAdmin = user?.role === 'SUPER_ADMIN';

    // Check if this is a valid admin view scenario
    const isValidAdminView = Boolean(isSuperAdmin && isAdminViewing && viewingLocationId);

    // Determine effective location ID
    const effectiveLocationId = isValidAdminView ? viewingLocationId : user?.locationId;

    // Determine if we're in read-only mode
    // Read-only when SUPER_ADMIN is viewing a different store
    const isReadOnly = Boolean(isValidAdminView && viewingLocationId !== user?.locationId);

    return {
      locationId: effectiveLocationId,
      isReadOnly,
      isAdminViewing: isValidAdminView,
      storeName: isValidAdminView ? viewingStoreName : null,
      isSuperAdmin,
    };
  }, [user, isAdminViewing, viewingLocationId, viewingStoreName]);

  return result;
};
