import { Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { useThemeStore } from '@/lib/theme';
import { Button } from './ui/button';

/**
 * One button, one flip: light ↔ dark on every click.
 *
 * Both icons are always rendered and cross-fade with a quarter turn, so the switch reads as a
 * single motion rather than one glyph popping into another's place. The label names the theme the
 * click will switch *to*, which is what a screen-reader user needs to decide whether to press it.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { t } = useTranslation();
  const dark = useThemeStore((s) => s.dark);
  const toggle = useThemeStore((s) => s.toggle);
  const label = dark ? t('common.theme.switchToLight') : t('common.theme.switchToDark');

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      aria-pressed={dark}
      onClick={toggle}
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
  );
}
