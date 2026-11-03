import { create } from 'zustand';
import { User } from '../types';
import { authService } from '../services/api';
import { clearSessionState } from '../services/session';
import { changeSessionGeneration, sessionGeneration } from '../services/sessionGeneration';
import toast from 'react-hot-toast';

let logoutPending: Promise<void> | null = null;

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isSigningOut: boolean;
  error: string | null;

  login: (email: string, password: string, twoFactorCode?: string) => Promise<{ requiresTwoFactor: boolean }>;
  logout: () => Promise<void>;
  loadUser: () => Promise<void>;
  clearError: () => void;
}

/**
 * Auth store using Zustand
 */
export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: localStorage.getItem('token'),
  isAuthenticated: false,
  isLoading: !!localStorage.getItem('token'),
  isSigningOut: false,
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

  logout: async () => {
    if (logoutPending) return logoutPending;
    const token = localStorage.getItem('token');
    changeSessionGeneration();
    localStorage.removeItem('token'); localStorage.removeItem('user');
    set({ user: null, token: null, isAuthenticated: false, isLoading: false, isSigningOut: true, error: null });
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

    set({ isLoading: true });
    try {
      const response = await authService.getMe();
      const user = response.data.data;

      set({
        user,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (error) {
      if (generation !== sessionGeneration()) return;
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      set({
        user: null,
        token: null,
        isAuthenticated: false,
        isLoading: false,
      });
    }
  },

  clearError: () => set({ error: null }),
}));
