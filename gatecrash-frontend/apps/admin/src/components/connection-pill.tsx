import { useConnectionStatus } from '@gatecrash/realtime';
import { formatTime } from '@gatecrash/core';
import * as Popover from '@radix-ui/react-popover';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';

/**
 * The connection pill — FRONTEND.md §10.4.
 *
 * A **functional control, not decoration**. A silent dead socket looks exactly like a quiet gate,
 * so the state has to be visible and the offline case has to say *when* the data is from —
 * "Offline" alone leaves an admin unable to tell whether the board they are reading is minutes or
 * hours stale.
 */
export function ConnectionPill() {
  const { t } = useTranslation();
  const status = useConnectionStatus();

  const { label, dot, className } = (() => {
    switch (status.state) {
      case 'connected':
        return {
          label: t('connection.live'),
          dot: 'bg-success',
          className: 'border-success/30 text-success',
        };
      case 'connecting':
        return {
          label: t('connection.connecting'),
          dot: 'bg-warning animate-pulse',
          className: 'border-warning/30 text-warning',
        };
      case 'reconnecting':
        return {
          label: t('connection.reconnecting'),
          dot: 'bg-warning animate-pulse',
          className: 'border-warning/30 text-warning',
        };
      case 'offline':
        return {
          label: t('connection.offline'),
          dot: 'bg-danger',
          className: 'border-danger/30 text-danger',
        };
      default:
        return {
          label: t('connection.disabled'),
          dot: 'bg-text-muted',
          className: 'border-border text-text-muted',
        };
    }
  })();

  const detail = (() => {
    if (status.state === 'connected') return t('connection.detailLive');
    if (status.state === 'reconnecting' || status.state === 'connecting') {
      return t('connection.detailReconnecting');
    }
    return t('connection.detailOffline', {
      time: status.lastMessageAt
        ? formatTime(new Date(status.lastMessageAt).toISOString())
        : t('common.never'),
    });
  })();

  return (
    <Popover.Root>
      <Popover.Trigger
        className={cn(
          'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium',
          className,
        )}
      >
        <span className={cn('size-2 rounded-full', dot)} aria-hidden />
        {label}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={8}
          align="end"
          className="z-50 w-64 rounded-md border border-border bg-surface p-3 text-sm shadow-lg"
        >
          <p className="text-text">{detail}</p>
          {status.lastError ? (
            <p className="pt-1 text-xs text-text-muted">{status.lastError}</p>
          ) : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
