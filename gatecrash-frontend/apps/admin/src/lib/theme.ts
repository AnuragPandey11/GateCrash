import { create } from 'zustand';

/**
 * Theme — FRONTEND.md §8.1: `prefers-color-scheme` plus a manual toggle persisted to
 * `localStorage`. "system" is the default until the user clicks the toggle; after that their
 * explicit choice sticks, and the OS setting no longer overrides it.
 */

export type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'gc.theme';

function readStored(): Theme {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
  } catch {
    return 'system';
  }
}

function prefersDark(): boolean {
  return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

/** Applies the theme to <html> and returns whether the page is now dark. */
function apply(theme: Theme): boolean {
  const dark = theme === 'dark' || (theme === 'system' && prefersDark());
  document.documentElement.classList.toggle('dark', dark);
  return dark;
}

interface ThemeStore {
  theme: Theme;
  /** What is actually on screen — "system" resolved against the OS. */
  dark: boolean;
  setTheme: (theme: Theme) => void;
  /** One click, one flip: whatever is showing now, switch to the other. */
  toggle: () => void;
}

export const useThemeStore = create<ThemeStore>((set, get) => ({
  theme: readStored(),
  dark: false,
  setTheme: (theme) => {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Private mode: the choice holds for this tab and reverts on reload. Acceptable.
    }
    set({ theme, dark: apply(theme) });
  },
  toggle: () => get().setTheme(get().dark ? 'light' : 'dark'),
}));

/** Call once at boot, before first paint, to avoid a flash of the wrong theme. */
export function initTheme(): void {
  useThemeStore.setState({ dark: apply(useThemeStore.getState().theme) });
  globalThis
    .matchMedia?.('(prefers-color-scheme: dark)')
    .addEventListener('change', () => {
      // Only "system" should follow the OS; an explicit choice must not be overridden.
      if (useThemeStore.getState().theme === 'system') {
        useThemeStore.setState({ dark: apply('system') });
      }
    });
}
