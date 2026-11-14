import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@/lib/i18n';
import { useThemeStore } from '@/lib/theme';
import { ThemeToggle } from './theme-toggle';

describe('theme toggle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useThemeStore.getState().setTheme('dark');
  });
  afterEach(() => vi.useRealTimers());

  it('covers the page with a loading screen in the old theme, flips underneath, then uncovers', () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole('button', { name: 'Switch to light mode' }));

    // Shown at once, before anything changes underneath it.
    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
    expect(useThemeStore.getState().dark).toBe(true);

    act(() => vi.advanceTimersByTime(200));
    expect(useThemeStore.getState().dark).toBe(false);
    expect(screen.getByRole('status')).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1200));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('ignores a second click while a switch is under way', () => {
    render(<ThemeToggle />);
    const button = screen.getByRole('button', { name: 'Switch to light mode' });
    fireEvent.click(button);
    fireEvent.click(button);
    act(() => vi.advanceTimersByTime(1500));
    expect(useThemeStore.getState().dark).toBe(false);
  });
});
