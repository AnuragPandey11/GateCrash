import { Loader2, Moon, Sun } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { useThemeStore } from '@/lib/theme';
import { Button } from './ui/button';

/** How the switch is paced: cover the page, flip underneath, hold briefly, uncover. */
const COVER_MS = 180;
const HOLD_MS = 650;
const FADE_OUT_MS = 280;

interface Cover {
  /** Captured from the theme being left, so the screen keeps those colours while the page flips. */
  bg: string;
  fg: string;
  accent: string;
  leaving: boolean;
}

function captureColours(): Omit<Cover, 'leaving'> {
  const css = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => {
    const value = css.getPropertyValue(name).trim();
    return value ? `hsl(${value})` : fallback;
  };
  return {
    bg: read('--gc-bg', '#111'),
    fg: read('--gc-text', '#eee'),
    accent: read('--gc-accent', '#7c83ff'),
  };
}

/**
 * One button, one flip: light ↔ dark on every click.
 *
 * Repainting every surface at once stutters, so the flip happens behind a brief "Loading…"
 * screen drawn in the colours of the theme being left — dark when leaving dark mode, light when
 * leaving light — which then fades away to reveal the new theme. Transitions are paused for the
 * instant of the swap itself.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { t } = useTranslation();
  const dark = useThemeStore((s) => s.dark);
  const toggle = useThemeStore((s) => s.toggle);
  const label = dark ? t('common.theme.switchToLight') : t('common.theme.switchToDark');
  const [cover, setCover] = useState<Cover | null>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => () => timers.current.forEach((id) => window.clearTimeout(id)), []);

  const later = (fn: () => void, ms: number) => timers.current.push(window.setTimeout(fn, ms));

  const onToggle = () => {
    if (cover) return; // a switch is already under way
    setCover({ ...captureColours(), leaving: false });

    later(() => {
      const root = document.documentElement;
      root.classList.add('theme-switching');
      toggle();
      // Two frames: let the new colours paint with transitions off, then restore them.
      requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-switching')));
    }, COVER_MS);
    later(() => setCover((c) => (c ? { ...c, leaving: true } : c)), COVER_MS + HOLD_MS);
    later(() => setCover(null), COVER_MS + HOLD_MS + FADE_OUT_MS);
  };

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label={label}
        title={label}
        aria-pressed={dark}
        onClick={onToggle}
        className={cn('relative overflow-hidden', className)}
      >
        <Sun
          aria-hidden
          className={cn(
            'absolute transition-all duration-500 ease-out-expo',
            dark ? 'rotate-90 scale-50 opacity-0' : 'rotate-0 scale-100 opacity-100',
          )}
        />
        <Moon
          aria-hidden
          className={cn(
            'absolute transition-all duration-500 ease-out-expo',
            dark ? 'rotate-0 scale-100 opacity-100' : '-rotate-90 scale-50 opacity-0',
          )}
        />
      </Button>

      {cover
        ? createPortal(
            <div
              role="status"
              aria-live="polite"
              className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 animate-fade-in"
              style={{
                backgroundColor: cover.bg,
                color: cover.fg,
                opacity: cover.leaving ? 0 : 1,
                transition: `opacity ${FADE_OUT_MS}ms ease-out`,
              }}
            >
              <Loader2 className="size-9 animate-spin" style={{ color: cover.accent }} aria-hidden />
              <p className="text-sm font-semibold tracking-wide">{t('common.theme.switching')}</p>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
