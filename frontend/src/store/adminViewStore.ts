import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AdminViewState {
  isAdminViewing: boolean;
  viewingLocationId: string | null;
  viewingStoreName: string | null;

  enterAdminView: (locationId: string, storeName: string) => void;
  exitAdminView: () => void;
}

/**
 * Admin View Store - Persists admin view state across tab switches and page refreshes
 * Used when SUPER_ADMIN views a specific store in read-only mode
 */
export const useAdminViewStore = create<AdminViewState>()(
  persist(
    (set) => ({
      isAdminViewing: false,
      viewingLocationId: null,
      viewingStoreName: null,

      enterAdminView: (locationId: string, storeName: string) => {
        set({
          isAdminViewing: true,
          viewingLocationId: locationId,
          viewingStoreName: storeName,
        });
      },

      exitAdminView: () => {
        set({
          isAdminViewing: false,
          viewingLocationId: null,
          viewingStoreName: null,
        });
      },
    }),
    {
      name: 'admin-view-storage', // localStorage key
    }
  )
);