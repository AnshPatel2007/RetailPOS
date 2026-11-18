import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface LayoutState {
  isMobileMenuOpen: boolean;
  /** The one menu section shown open in the phone drawer (accordion); null = all titled sections closed. */
  openSection: string | null;
  setOpenSection: (title: string | null) => void;
  setMobileMenuOpen: (open: boolean) => void;
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      isMobileMenuOpen: false,
      openSection: null,
      setOpenSection: (title: string | null) => set({ openSection: title }),
      setMobileMenuOpen: (open: boolean) => set({ isMobileMenuOpen: open }),
    }),
    {
      name: 'pos-layout',
      partialize: (state) => ({ openSection: state.openSection }),
    }
  )
);
