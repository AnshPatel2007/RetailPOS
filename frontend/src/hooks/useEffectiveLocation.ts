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
    // Older login responses only included location.id. Keep existing sessions usable
    // while respecting an explicit null assignment and super-admin preview rules.
    const assignedLocationId = user?.locationId === undefined ? user?.location?.id : user.locationId;
    const effectiveLocationId = isValidAdminView ? viewingLocationId : assignedLocationId;

    // Platform admins never perform store operations, including direct URLs
    // outside an explicitly selected preview. Platform management is separate.
    const isReadOnly = isSuperAdmin;

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
