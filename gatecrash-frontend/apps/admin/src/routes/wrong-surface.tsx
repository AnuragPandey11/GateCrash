import { Smartphone } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { signOut } from '@/lib/session';

/**
 * The dead end for a non-admin who found the web URL — FRONTEND.md §8.2.
 *
 * This is a real case, not a theoretical one: a resident will try the dashboard address. Landing
 * them on a login loop or a permission error would be baffling. Naming the situation and offering
 * the way out is the whole screen.
 */
export function WrongSurfaceRoute() {
  const { t } = useTranslation();

  return (
    <div className="ink-panel flex min-h-screen items-center justify-center p-4">
      <div className="max-w-sm space-y-4 rounded-3xl border border-border bg-surface p-8 text-center shadow-overlay animate-enter">
        <span className="icon-tile mx-auto size-12">
          <Smartphone className="size-5" aria-hidden />
        </span>
        <h1 className="font-display text-2xl text-text">{t('login.wrongSurfaceTitle')}</h1>
        <p className="text-sm text-text-muted">{t('login.wrongSurfaceBody')}</p>
        <Button variant="secondary" onClick={() => void signOut()}>
          {t('common.signOut')}
        </Button>
      </div>
    </div>
  );
}
