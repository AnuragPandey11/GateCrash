import { create } from 'zustand';

/**
 * Theme — FRONTEND.md §8.1: `prefers-color-scheme` plus a manual toggle persisted to
 * `localStorage`. "system" is a real, and the default, state — not a synonym for light.
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

function apply(theme: Theme): void {
  const dark = theme === 'dark' || (theme === 'system' && prefersDark());
  document.documentElement.classList.toggle('dark', dark);
}

interface ThemeStore {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

export const useThemeStore = create<ThemeStore>((set) => ({
  theme: readStored(),
  setTheme: (theme) => {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Private mode: the choice holds for this tab and reverts on reload. Acceptable.
    }
    apply(theme);
    set({ theme });
  },
}));

/** Call once at boot, before first paint, to avoid a flash of the wrong theme. */
export function initTheme(): void {
  apply(useThemeStore.getState().theme);
  globalThis
    .matchMedia?.('(prefers-color-scheme: dark)')
    .addEventListener('change', () => {
      // Only "system" should follow the OS; an explicit choice must not be overridden.
      if (useThemeStore.getState().theme === 'system') apply('system');
    });
}
