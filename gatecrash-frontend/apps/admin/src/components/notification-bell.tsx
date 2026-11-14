import {
  useCommunityFeed,
  useInbox,
  useMarkAllRead,
  useMarkRead,
  useUnreadCount,
  type InboxItemResponse,
  type PostResponse,
} from '@gatecrash/api';
import { formatRelative } from '@gatecrash/core';
import * as Popover from '@radix-ui/react-popover';
import * as Tabs from '@radix-ui/react-tabs';
import { Bell, CheckCheck, MessageSquare } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { useSessionStore } from '@/lib/session';

const seenKey = (userId: string) => `gc.community-seen.${userId}`;

function readSeen(userId: string): number {
  try {
    return Number(localStorage.getItem(seenKey(userId)) ?? 0) || 0;
  } catch {
    return 0;
  }
}

/** Post bodies are HTML. The bell shows a plain-text line; DOMParser never runs scripts. */
function plainText(html: string, max = 110): string {
  const text = new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * The bell, for every account that lives in a township. Two tabs: the notifications the office
 * sent this person, and the latest community posts. Opening an item takes the person to its full
 * page with that item blinking, so they can see exactly which one they tapped.
 */
export function NotificationBell() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const me = useSessionStore((s) => s.me);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'notifications' | 'community'>('notifications');
  const unread = useUnreadCount();
  const inbox = useInbox({ page: 1, size: 8 });
  const feed = useCommunityFeed({ page: 1, size: 6 });
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();
  const [seenAt, setSeenAt] = useState(() => (me ? readSeen(me.id) : 0));

  const posts: PostResponse[] = feed.data?.content ?? [];
  const newPosts = posts.filter((p) => new Date(p.publishedAt).getTime() > seenAt).length;
  const unreadCount = unread.data?.unread ?? 0;
  const badge = unreadCount + newPosts;

  // Opening the bell refreshes both lists; posts have no live push, so this is when they update.
  useEffect(() => {
    if (!open) return;
    void inbox.refetch();
    void feed.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Looking at the community tab is what makes its posts "seen".
  useEffect(() => {
    if (!open || tab !== 'community' || !me) return;
    const now = Date.now();
    setSeenAt(now);
    try {
      localStorage.setItem(seenKey(me.id), String(now));
    } catch {
      /* private mode: the dot simply returns next session */
    }
  }, [open, tab, me]);

  const openNotification = (item: InboxItemResponse) => {
    setOpen(false);
    if (!item.read) markRead.mutate(item.id);
    navigate(`/inbox?highlight=${item.id}`);
  };
  const openPost = (post: PostResponse) => {
    setOpen(false);
    navigate(`/community?highlight=${post.id}`);
  };

  const tabClass =
    'flex items-center justify-center gap-2 border-b-2 border-transparent px-3 py-2.5 text-sm font-semibold text-text-muted transition-colors data-[state=active]:border-primary data-[state=active]:text-text';

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative size-9"
          aria-label={badge > 0 ? t('bell.labelUnread', { count: badge }) : t('bell.label')}
        >
          <Bell />
          {badge > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 flex min-w-[1.15rem] items-center justify-center rounded-full bg-danger px-1 text-[0.625rem] font-bold leading-[1.15rem] text-white animate-pop-in">
              {badge > 9 ? '9+' : badge}
            </span>
          ) : null}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          collisionPadding={12}
          className="z-50 w-[min(24rem,calc(100vw-1.5rem))] overflow-hidden rounded-[14px] border border-border/80 bg-surface shadow-overlay data-[state=open]:animate-pop-in"
        >
          <Tabs.Root value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
            <Tabs.List className="grid grid-cols-2 border-b border-border" aria-label={t('bell.label')}>
              <Tabs.Trigger value="notifications" className={tabClass}>
                {t('bell.notifications')}
                {unreadCount > 0 ? <Count n={unreadCount} /> : null}
              </Tabs.Trigger>
              <Tabs.Trigger value="community" className={tabClass}>
                {t('bell.community')}
                {newPosts > 0 ? <Count n={newPosts} /> : null}
              </Tabs.Trigger>
            </Tabs.List>

            <Tabs.Content value="notifications" className="scroll-panel max-h-[min(24rem,60vh)] overflow-y-auto">
              {(inbox.data?.content ?? []).length === 0 ? (
                <Empty icon={Bell} text={t('bell.noNotifications')} />
              ) : (
                <ul className="divide-y divide-border/70">
                  {(inbox.data?.content ?? []).map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => openNotification(item)}
                        className={cn(
                          'flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-raised',
                          !item.read && 'bg-accent-soft/40',
                        )}
                      >
                        <span
                          className={cn('mt-1.5 size-2 shrink-0 rounded-full', item.read ? 'bg-transparent' : 'bg-accent')}
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1">
                          <span className={cn('block truncate text-sm text-text', !item.read && 'font-semibold')}>
                            {item.title}
                          </span>
                          <span className="line-clamp-2 text-xs text-text-muted">{item.body}</span>
                          <span className="mt-0.5 block text-[0.6875rem] text-text-muted">
                            {formatRelative(item.sentAt)}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Tabs.Content>

            <Tabs.Content value="community" className="scroll-panel max-h-[min(24rem,60vh)] overflow-y-auto">
              {posts.length === 0 ? (
                <Empty icon={MessageSquare} text={t('bell.noPosts')} />
              ) : (
                <ul className="divide-y divide-border/70">
                  {posts.map((post) => (
                    <li key={post.id}>
                      <button
                        type="button"
                        onClick={() => openPost(post)}
                        className="flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-raised"
                      >
                        <MessageSquare className="mt-0.5 size-4 shrink-0 text-text-muted" aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-text">{post.title}</span>
                          <span className="line-clamp-2 text-xs text-text-muted">{plainText(post.body)}</span>
                          <span className="mt-0.5 block text-[0.6875rem] text-text-muted">
                            {post.authorName} · {formatRelative(post.publishedAt)}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Tabs.Content>
          </Tabs.Root>

          <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
            {tab === 'notifications' ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={unreadCount === 0 || markAll.isPending}
                onClick={() => markAll.mutate()}
              >
                <CheckCheck aria-hidden />
                {t('bell.markAllRead')}
              </Button>
            ) : (
              <span />
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setOpen(false);
                navigate(tab === 'notifications' ? '/inbox' : '/community');
              }}
            >
              {t('bell.viewAll')}
            </Button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Count({ n }: { n: number }) {
  return (
    <span className="rounded-full bg-accent px-1.5 text-[0.6875rem] font-bold leading-5 text-white">
      {n > 99 ? '99+' : n}
    </span>
  );
}

function Empty({ icon: Icon, text }: { icon: typeof Bell; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-text-muted">
      <Icon className="size-6 opacity-60" aria-hidden />
      {text}
    </div>
  );
}
