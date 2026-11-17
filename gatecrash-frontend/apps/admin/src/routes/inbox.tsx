import { useInbox, useMarkAllRead, useMarkRead, type InboxItemResponse } from '@gatecrash/api';
import { formatDateTime } from '@gatecrash/core';
import { Bell, CheckCheck, MailOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState, LoadingState } from '@/components/ui/states';
import { cn } from '@/lib/cn';
import { useHighlight } from '@/lib/use-highlight';

/**
 * Everyone's notifications page — the notices the society office sent them, in two columns:
 * unread and read. Opening an unread one marks it read and it moves across. The bell links here
 * with `?highlight=<id>`, and that notification blinks for a few seconds.
 */
export function InboxRoute() {
  const { t } = useTranslation();
  const inbox = useInbox({ page: 1, size: 100 });
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();
  const highlighted = useHighlight(Boolean(inbox.data));

  const items = inbox.data?.content ?? [];
  const unread = items.filter((i) => !i.read);
  const read = items.filter((i) => i.read);

  const column = (title: string, list: InboxItemResponse[], empty: string, kind: 'unread' | 'read') => (
    <section aria-label={title} className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-text">
        {kind === 'unread' ? <Bell className="size-4" aria-hidden /> : <MailOpen className="size-4" aria-hidden />}
        {title}
        <span className="rounded-full bg-surface-raised px-2 text-xs text-text">{list.length}</span>
      </h2>
      {list.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-text-muted">{empty}</CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {list.map((item) => (
            <Card
              key={item.id}
              data-highlight-id={item.id}
              className={cn(
                'transition-shadow',
                kind === 'unread' && 'cursor-pointer border-accent/40 hover:shadow-raised',
                highlighted === item.id && 'highlight-blink',
              )}
              onClick={kind === 'unread' ? () => markRead.mutate(item.id) : undefined}
              role={kind === 'unread' ? 'button' : undefined}
              tabIndex={kind === 'unread' ? 0 : undefined}
              onKeyDown={
                kind === 'unread'
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') markRead.mutate(item.id);
                    }
                  : undefined
              }
            >
              <CardContent className="space-y-1.5">
                <div className="flex items-start justify-between gap-3">
                  <p className={cn('text-text', kind === 'unread' ? 'font-semibold' : 'font-medium')}>{item.title}</p>
                  {kind === 'unread' ? <span className="mt-2 size-2 shrink-0 rounded-full bg-accent" aria-hidden /> : null}
                </div>
                <p className="whitespace-pre-wrap text-sm text-text-muted">{item.body}</p>
                <p className="text-[0.6875rem] text-text-muted">
                  {formatDateTime(item.sentAt)}
                  {item.readAt ? ` · ${t('inbox.readAt', { time: formatDateTime(item.readAt) })}` : ''}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  );

  return (
    <>
      <PageHeader
        eyebrow={t('pageEyebrow.communication')}
        title={t('inbox.title')}
        description={t('inbox.subtitle')}
        actions={
          <Button variant="secondary" disabled={unread.length === 0 || markAll.isPending} onClick={() => markAll.mutate()}>
            <CheckCheck aria-hidden />
            {t('bell.markAllRead')}
          </Button>
        }
      />
      {inbox.isPending ? <LoadingState /> : null}
      {inbox.data && items.length === 0 ? (
        <Card>
          <EmptyState icon={Bell} title={t('inbox.empty')} description={t('inbox.emptyHint')} />
        </Card>
      ) : null}
      {items.length > 0 ? (
        <div className="grid items-start gap-6 lg:grid-cols-2">
          {column(t('inbox.unread'), unread, t('inbox.allCaughtUp'), 'unread')}
          {column(t('inbox.read'), read, t('inbox.nothingRead'), 'read')}
        </div>
      ) : null}
    </>
  );
}
