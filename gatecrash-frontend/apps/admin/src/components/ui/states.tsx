import { Loader2, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Button } from './button';

/**
 * The four states every data surface has — FRONTEND.md §11.1.
 *
 * The distinction that matters is **error with cached data** vs **error with none**: the first
 * keeps rendering the cache behind a stale banner, the second takes the screen. Blanking a
 * populated table because a background refetch failed is how a dashboard loses trust.
 */

export function LoadingState({ label }: { label?: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-center gap-2 p-12 text-sm text-text-muted">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {label ?? t('common.loading')}
    </div>
  );
}

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/**
 * An empty state is not an error. "Nobody is currently inside" is a legitimate and common state
 * for a township at 3am (§8.3) — it should read as calm, not as a failure.
 */
export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center gap-2 p-12 text-center', className)}>
      {Icon ? <Icon className="size-8 text-text-muted" aria-hidden /> : null}
      <p className="font-medium text-text">{title}</p>
      {description ? <p className="max-w-sm text-sm text-text-muted">{description}</p> : null}
      {action ? <div className="pt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  message,
  correlationId,
  onRetry,
}: {
  message: string;
  correlationId?: string | null;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-3 p-12 text-center">
      <p className="font-medium text-text">{t('errors.title')}</p>
      <p className="max-w-md text-sm text-text-muted">{message}</p>
      {correlationId ? (
        <p className="font-credential text-xs text-text-muted">
          {t('errors.correlation', { id: correlationId })}
        </p>
      ) : null}
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      ) : null}
    </div>
  );
}

/** Shown above content we are still rendering from cache while a refetch is failing. */
export function StaleBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between gap-3 border-b border-warning/30 bg-warning/10 px-4 py-2 text-sm text-warning">
      <span>{message}</span>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="font-medium underline underline-offset-2">
          {t('common.retry')}
        </button>
      ) : null}
    </div>
  );
}
