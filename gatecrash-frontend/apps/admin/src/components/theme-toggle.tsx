import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useThemeStore, type Theme } from '@/lib/theme';
import { Button } from './ui/button';

const ICONS = { light: Sun, dark: Moon, system: Monitor } as const;

export function ThemeToggle() {
  const { t } = useTranslation();
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const Icon = ICONS[theme];

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('common.theme.toggle')}>
          <Icon />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-36 rounded-md border border-border bg-surface p-1 shadow-lg"
        >
          {(['light', 'dark', 'system'] as Theme[]).map((option) => {
            const OptionIcon = ICONS[option];
            return (
              <DropdownMenu.Item
                key={option}
                onSelect={() => setTheme(option)}
                className="flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-text outline-none data-[highlighted]:bg-surface-raised"
              >
                <OptionIcon className="size-4" aria-hidden />
                {t(`common.theme.${option}`)}
                {theme === option ? <span className="ml-auto text-xs text-text-muted">●</span> : null}
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
