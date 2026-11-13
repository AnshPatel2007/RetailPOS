import { create } from 'zustand';

/** Two looks exist while the owner compares them on real screens; the one not chosen is removed. */
export type Look = 'classic' | 'new';

interface ThemeState {
  theme: 'light' | 'dark';
  look: Look;
  toggleTheme: () => void;
  setTheme: (theme: 'light' | 'dark') => void;
  setLook: (look: Look) => void;
}

// Saved per browser, like the theme. VITE_DEFAULT_LOOK lets the browser tests run under either look.
const savedLook = (): Look => (localStorage.getItem('look') || import.meta.env.VITE_DEFAULT_LOOK) === 'new' ? 'new' : 'classic';
const applyLook = (look: Look) => { document.documentElement.dataset.look = look; };
applyLook(savedLook());

export const useThemeStore = create<ThemeState>((set) => ({
  theme: (localStorage.getItem('theme') as 'light' | 'dark') || 'light',
  look: savedLook(),

  setLook: (look: Look) => {
    localStorage.setItem('look', look);
    applyLook(look);
    set({ look });
  },

  setTheme: (theme: 'light' | 'dark') => {
    localStorage.setItem('theme', theme);
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    set({ theme });
  },

  toggleTheme: () => {
    set((state) => {
      const newTheme = state.theme === 'light' ? 'dark' : 'light';
      localStorage.setItem('theme', newTheme);
      if (newTheme === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
      return { theme: newTheme };
    });
  },
}));
