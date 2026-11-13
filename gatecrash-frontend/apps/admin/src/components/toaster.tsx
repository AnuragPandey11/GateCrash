import { CheckCircle2, Info, TriangleAlert, X, XCircle } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { useToastStore, type Toast, type ToastTone } from '@/lib/toast';

const TONE: Record<ToastTone, { border: string; icon: typeof Info | null }> = {
  default: { border: 'border-border', icon: null },
  success: { border: 'border-success/40', icon: CheckCircle2 },
  danger: { border: 'border-danger/40', icon: XCircle },
  warning: { border: 'border-warning/40', icon: TriangleAlert },
  info: { border: 'border-info/40', icon: Info },
};

const ICON_COLOUR: Record<ToastTone, string> = {
  default: 'text-text-muted',
  success: 'text-success',
  danger: 'text-danger',
  warning: 'text-warning',
  info: 'text-info',
};

function ToastCard({ toast }: { toast: Toast }) {
  const { t } = useTranslation();
  const dismiss = useToastStore((s) => s.dismiss);
  const tone = TONE[toast.tone];
  const Icon = tone.icon;

  useEffect(() => {
    const timer = setTimeout(() => dismiss(toast.id), toast.durationMs);
    return () => clearTimeout(timer);
  }, [dismiss, toast.id, toast.durationMs]);

  return (
    <div
      // `alert` for failures interrupts a screen reader; `status` for the rest waits politely so
      // an occupancy toast does not talk over what the admin is reading.
      role={toast.tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'pointer-events-auto relative flex w-[22rem] items-start gap-3 overflow-hidden rounded-[14px] border bg-surface/95 p-4 shadow-overlay backdrop-blur-md animate-slide-in-right',
        tone.border,
      )}
    >
      {Icon ? <Icon className={cn('mt-0.5 size-4 shrink-0', ICON_COLOUR[toast.tone])} aria-hidden /> : null}
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm font-medium text-text">{toast.title}</p>
        {toast.description ? (
          <p className="break-words text-sm text-text-muted">{toast.description}</p>
        ) : null}
        {toast.correlationId ? (
          // §11.3: support greps one string, so it has to be selectable, not just displayed.
          <p className="font-credential select-all pt-1 text-xs text-text-muted">
            {t('errors.correlation', { id: toast.correlationId })}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => dismiss(toast.id)}
        className="shrink-0 rounded-sm text-text-muted transition-colors hover:text-text"
        aria-label={t('common.close')}
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col gap-2"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
