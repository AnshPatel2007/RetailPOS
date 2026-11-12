import { create } from 'zustand';
import { User } from '../types';
import { authService } from '../services/api';
import { clearSessionState, clearStoreState } from '../services/session';
import { changeSessionGeneration, sessionGeneration, trackSignIn } from '../services/sessionGeneration';
import { changeStoreContextGeneration } from '../services/storeContextGeneration';
import { offlineDb } from '../services/offlineDb';
import { useRegisterStore } from './registerStore';
import { useCartStore } from './cartStore';
import { connectionSettled, isOffline, subscribeConnection } from '../services/connection';
import toast from 'react-hot-toast';

let logoutPending: Promise<void> | null = null;

/** The person saved at sign-in on this browser, if it still holds their session token. */
function rememberedUser(): User | null {
  try {
    if (!localStorage.getItem('token')) return null;
    const user = JSON.parse(localStorage.getItem('user') || 'null');
    return user && typeof user.id === 'string' && typeof user.role === 'string' ? user as User : null;
  } catch { return null; }
}

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isSigningOut: boolean;
  /** Signed in from this register's memory because the server could not be reached at startup. */
  sessionUnverified: boolean;
  error: string | null;

  login: (email: string, password: string, twoFactorCode?: string) => Promise<{ requiresTwoFactor: boolean }>;
  /** Name + PIN on this register; replaces whoever is signed in only once the PIN is right. */
  pinLogin: (userId: string, pin: string) => Promise<void>;
  logout: () => Promise<void>;
  loadUser: () => Promise<void>;
  /**
   * Work in another of this person's stores. Refused while anything on this
   * register still belongs to the current store (cart, held sales, a payment,
   * a sale saved offline); the server also refuses while their drawer is open.
   */
  switchStore: (locationId: string) => Promise<void>;
  /** The server said access to the current store ended and moved this sign-in home. */
  storeAccessEnded: () => Promise<void>;
  clearError: () => void;
}

let storeAccessEndedPending: Promise<void> | null = null;

const unfinishedWorkMessages = {
  payment: 'Finish the open payment before switching stores.',
  terminal: 'Confirm the card terminal payment on the register before switching stores.',
  'offline-sale': 'Sales saved while offline must reach the server before switching stores.',
} as const;

/** Why this register cannot leave the current store yet, or null. */
async function switchBlocker(user: User): Promise<string | null> {
  if (isOffline()) return 'Switching stores needs a connection to the POS server.';
  const cart = useCartStore.getState();
  if (cart.items.length) return 'Finish or clear the sale in the cart before switching stores.';
  if (cart.heldSales.length && (cart.heldLocationId === null || cart.heldLocationId === user.locationId)) {
    return 'Held sales stay with this store. Finish or discard them before switching stores.';
  }
  try {
    const work = user.locationId ? await offlineDb.unfinishedStoreWork(user.id, user.locationId) : null;
    return work ? unfinishedWorkMessages[work] : null;
  } catch {
    return 'This register could not check its saved payments. Reload the page and try again.';
  }
}

/** Replace the signed-in person's store-specific view after the server moved the session. */
async function enterStore(user: User) {
  await clearStoreState();
  changeStoreContextGeneration();
  localStorage.setItem('user', JSON.stringify(user));
  useAuthStore.setState({ user });
}

/**
 * Auth store using Zustand
 */
export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: localStorage.getItem('token'),
  isAuthenticated: false,
  isLoading: !!localStorage.getItem('token'),
  isSigningOut: false,
  sessionUnverified: false,
  error: null,

  login: async (email: string, password: string, twoFactorCode?: string) => {
    if (logoutPending) await logoutPending;
    const generation = changeSessionGeneration();
    set({ user: null, token: null, isAuthenticated: false, isLoading: true, error: null });

    // Clear any existing tokens before attempting login
    localStorage.removeItem('token');
    localStorage.removeItem('user');

    try {
      await clearSessionState();
      const response = await authService.login(email, password, twoFactorCode);

      // Credentials are valid but a 2FA code is needed — let the caller
      // show the code-entry step and call login again with the code
      if (response.data.requiresTwoFactor) {
        set({ isLoading: false, error: null });
        return { requiresTwoFactor: true };
      }

      const { token, user } = response.data.data;

      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));

      set({
        user,
        token,
        isAuthenticated: true,
        isLoading: false,
        sessionUnverified: false,
        error: null, // Explicitly clear error
      });
      return { requiresTwoFactor: false };
    } catch (error: any) {
      if (generation !== sessionGeneration()) throw error;
      // Clear tokens on login failure
      localStorage.removeItem('token');
      localStorage.removeItem('user');

      set({
        user: null,
        token: null,
        isAuthenticated: false,
        error: error.response?.data?.error || error.message || 'Login failed',
        isLoading: false,
      });
      throw error;
    }
  },

  pinLogin: async (userId: string, pin: string) => {
    const device = useRegisterStore.getState().device;
    if (!device) throw new Error('This computer is not set up as a register.');
    if (logoutPending) await logoutPending;
    // The PIN is checked before anything changes here: a wrong PIN leaves the current
    // person signed in, cart and all. The server ends this browser's previous session,
    // so requests the previous person still has in flight wait for this (trackSignIn).
    return trackSignIn((async () => {
      let response;
      try { response = await authService.pinLogin(device.token, userId, pin); }
      catch (error: any) {
        if (error.response?.status === 401 && /no longer set up/.test(error.response?.data?.error || '')) useRegisterStore.getState().setDevice(null);
        throw error;
      }
      const { token, user } = response.data.data;
      changeSessionGeneration();
      await clearSessionState();
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));
      set({ user, token, isAuthenticated: true, isLoading: false, sessionUnverified: false, error: null });
    })());
  },

  logout: async () => {
    if (logoutPending) return logoutPending;
    const token = localStorage.getItem('token');
    changeSessionGeneration();
    localStorage.removeItem('token'); localStorage.removeItem('user');
    set({ user: null, token: null, isAuthenticated: false, isLoading: false, isSigningOut: true, sessionUnverified: false, error: null });
    const cleanup = clearSessionState();
    logoutPending = (async () => {
      try { await authService.logout(token); }
      catch (error: unknown) {
        if ((error as { response?: { status: number } }).response?.status !== 401) toast.error('Signed out on this device. Server sign-out could not be confirmed; reconnect and sign out again.');
      } finally {
        await cleanup; set({ isSigningOut: false }); logoutPending = null;
      }
    })();
    return logoutPending;
  },

  loadUser: async () => {
    const generation = sessionGeneration();
    const token = localStorage.getItem('token');
    if (!token) {
      set({ isAuthenticated: false, isLoading: false });
      return;
    }

    // Re-checking a session already in use (after an offline start) must not blank the screen mid-sale.
    if (!get().isAuthenticated) set({ isLoading: true });
    try {
      const response = await authService.getMe();
      const user = response.data.data;

      set({
        user,
        isAuthenticated: true,
        isLoading: false,
        sessionUnverified: false,
      });
    } catch (error) {
      if (generation !== sessionGeneration()) return;
      // The server gave no answer (the register started without a connection).
      // That is not a refusal: keep the person who was signed in on this
      // register so it can sell from its saved catalog. The session is checked
      // again as soon as the server answers; a refused session signs out then.
      await connectionSettled();
      if (generation !== sessionGeneration()) return;
      const remembered = isOffline() ? rememberedUser() : null;
      if (remembered) {
        set({ user: remembered, isAuthenticated: true, isLoading: false, sessionUnverified: true });
        return;
      }
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      set({
        user: null,
        token: null,
        isAuthenticated: false,
        isLoading: false,
        sessionUnverified: false,
      });
    }
  },

  switchStore: async (locationId: string) => {
    const user = get().user;
    if (!user || user.role === 'SUPER_ADMIN' || user.locationId === locationId) return;
    const blocker = await switchBlocker(user);
    if (blocker) throw new Error(blocker);
    const generation = sessionGeneration();
    const response = await authService.switchStore(locationId);
    if (generation !== sessionGeneration()) return;
    await enterStore(response.data.data.user);
  },

  storeAccessEnded: async () => {
    if (storeAccessEndedPending) return storeAccessEndedPending;
    storeAccessEndedPending = (async () => {
      const generation = sessionGeneration();
      const leaving = get().user?.location?.name;
      try {
        // Cancel everything still aimed at the store first, then read where the session is now.
        changeStoreContextGeneration();
        const response = await authService.getMe();
        if (generation !== sessionGeneration()) return;
        const user: User = response.data.data;
        await enterStore(user);
        toast.error(`Your access to ${leaving || 'that store'} ended. You are back at ${user.location?.name || 'your home store'}.`, { duration: 8000 });
      } catch {
        // A refused session is handled by the usual sign-out path.
      } finally {
        storeAccessEndedPending = null;
      }
    })();
    return storeAccessEndedPending;
  },

  clearError: () => set({ error: null }),
}));

// A register that started without a connection checks its session as soon as the server answers again.
subscribeConnection(offline => {
  const state = useAuthStore.getState();
  if (!offline && state.sessionUnverified && state.isAuthenticated) void state.loadUser();
});
