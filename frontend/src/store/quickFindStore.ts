import { create } from 'zustand';

interface QuickFindState { isOpen: boolean; open: () => void; close: () => void }

export const useQuickFindStore = create<QuickFindState>(set => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}));
