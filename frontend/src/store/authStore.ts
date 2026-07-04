import { create } from 'zustand';
import { User } from '../types';
import { authService } from '../services/api';
import { useStoreSettingsStore } from './storeSettingsStore';

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  login: (email: string, password: string) => Promise<void>;
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
  error: null,

  login: async (email: string, password: string) => {
    set({ isLoading: true, error: null });

    // Clear any existing tokens before attempting login
    localStorage.removeItem('token');
    localStorage.removeItem('user');

    try {
      const response = await authService.login(email, password);

      // Handle 2FA requirement
      if (response.data.requiresTwoFactor) {
        set({ isLoading: false, error: 'Two-factor authentication is not yet supported in this client.' });
        throw new Error('2FA required');
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
    } catch (error: any) {
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
    try {
      // Call backend logout endpoint for activity logging
      await authService.logout();
    } catch (error) {
      // Log error but continue with logout
      console.error('Logout error:', error);
    } finally {
      // Always clear local state
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      useStoreSettingsStore.getState().reset();
      set({
        user: null,
        token: null,
        isAuthenticated: false,
        error: null, // Clear any errors
      });
    }
  },

  loadUser: async () => {
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
