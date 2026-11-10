import { useCartStore } from '../store/cartStore';
import { useStoreSettingsStore } from '../store/storeSettingsStore';
import { useAdminViewStore } from '../store/adminViewStore';
import { offlineDb } from './offlineDb';
import { cancelApproval } from '../store/approvalStore';
import { useRegisterStore } from '../store/registerStore';

/**
 * Clears every piece of per-account/per-store client state. Called from
 * both logout paths (explicit button and silent token-expiry) so a
 * different cashier logging into a different store on the same browser
 * never sees a held sale, cart, store name/settings, favorites, or admin
 * "viewing store" state left over from the previous session.
 */
export const clearSessionState = async (): Promise<void> => {
  cancelApproval();
  localStorage.removeItem('pos-checkout-attempt');
  useCartStore.getState().resetForLogout();
  useStoreSettingsStore.getState().reset();
  // Favorites are this register's quick keys (product ids, nothing personal): they stay.
  useAdminViewStore.getState().exitAdminView();
  // The register setup belongs to this computer and stays; a lock never outlives its session.
  useRegisterStore.getState().unlock();
  try {
    await offlineDb.clearCachesForLogout();
  } catch {
    // IndexedDB may be unavailable (private browsing, etc.) — not fatal to logout
  }
};
