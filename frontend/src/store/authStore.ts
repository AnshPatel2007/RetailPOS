import { create } from 'zustand';
import { User } from '../types';
import { authService } from '../services/api';
import { clearSessionState } from '../services/session';
import { changeSessionGeneration, sessionGeneration } from '../services/sessionGeneration';
import { useRegisterStore } from './registerStore';
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
  clearError: () => void;
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
    // person signed in, cart and all. The server ends this browser's previous session.
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

  clearError: () => set({ error: null }),
}));

// A register that started without a connection checks its session as soon as the server answers again.
subscribeConnection(offline => {
  const state = useAuthStore.getState();
  if (!offline && state.sessionUnverified && state.isAuthenticated) void state.loadUser();
});
