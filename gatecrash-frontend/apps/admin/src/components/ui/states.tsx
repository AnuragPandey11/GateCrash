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
    <div className="flex flex-col items-center justify-center gap-4 p-12 text-sm text-text-muted animate-fade-in">
      <span className="relative flex size-10 items-center justify-center">
        <span className="absolute inset-0 rounded-full border border-accent/20" />
        <Loader2 className="size-5 animate-spin text-accent" aria-hidden />
      </span>
      <span className="tracking-wide">{label ?? t('common.loading')}</span>
    </div>
  );
}

/** Placeholder rows with a slow sheen, for lists whose shape is known before the data lands. */
export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3 p-5" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4">
          <div className="skeleton size-9 rounded-full" />
          <div className="flex-1 space-y-2">
            <div className="skeleton h-3 w-1/3" />
            <div className="skeleton h-3 w-2/3" />
          </div>
        </div>
      ))}
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
    <div className={cn('flex flex-col items-center gap-2 p-14 text-center animate-enter', className)}>
      {Icon ? (
        <span className="mb-2 flex size-14 items-center justify-center rounded-full border border-accent/25 bg-accent-soft text-accent shadow-soft">
          <Icon className="size-6" aria-hidden />
        </span>
      ) : null}
      <p className="font-display text-lg text-text">{title}</p>
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
    <div className="flex flex-col items-center gap-3 p-12 text-center animate-enter">
      <p className="font-display text-lg text-text">{t('errors.title')}</p>
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
