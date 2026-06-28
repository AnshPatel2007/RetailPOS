import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface FavoritesState {
  favoriteIds: string[];
  toggleFavorite: (productId: string) => void;
  isFavorite: (productId: string) => boolean;
}

export const useFavoritesStore = create<FavoritesState>()(
  persist(
    (set, get) => ({
      favoriteIds: [],

      toggleFavorite: (productId: string) => {
        const ids = get().favoriteIds;
        if (ids.includes(productId)) {
          set({ favoriteIds: ids.filter((id) => id !== productId) });
        } else {
          set({ favoriteIds: [...ids, productId] });
        }
      },

      isFavorite: (productId: string) => {
        return get().favoriteIds.includes(productId);
      },
    }),
    { name: 'pos-favorites' }
  )
);
