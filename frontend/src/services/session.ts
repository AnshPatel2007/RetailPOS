import { useCartStore } from '../store/cartStore';
import { useStoreSettingsStore } from '../store/storeSettingsStore';
import { useFavoritesStore } from '../store/favoritesStore';
import { useAdminViewStore } from '../store/adminViewStore';
import { offlineDb } from './offlineDb';

/**
 * Clears every piece of per-account/per-store client state. Called from
 * both logout paths (explicit button and silent token-expiry) so a
 * different cashier logging into a different store on the same browser
 * never sees a held sale, cart, store name/settings, favorites, or admin
 * "viewing store" state left over from the previous session.
 */
export const clearSessionState = async (): Promise<void> => {
  useCartStore.getState().resetForLogout();
  useStoreSettingsStore.getState().reset();
  useFavoritesStore.getState().reset();
  useAdminViewStore.getState().exitAdminView();
  try {
    await offlineDb.clearCachesForLogout();
  } catch {
    // IndexedDB may be unavailable (private browsing, etc.) — not fatal to logout
  }
};
