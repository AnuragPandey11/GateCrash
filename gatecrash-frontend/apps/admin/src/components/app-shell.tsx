import { isPlatformOperator } from '@gatecrash/core';
import {
  Building2,
  Globe,
  LayoutDashboard,
  LogOut,
  Megaphone,
  MessageSquare,
  ScrollText,
  Users,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { signOut, useSessionStore } from '@/lib/session';
import { ConnectionPill } from './connection-pill';
import { ThemeToggle } from './theme-toggle';
import { Button } from './ui/button';

/**
 * The dashboard shell — FRONTEND.md §8.1.
 *
 * Left sidebar, top bar with the connection pill, admin name and sign-out. Content is capped at
 * 1600px: this is a desktop-first internal tool, and a visitor log stretched across a 34-inch
 * monitor is unreadable, not impressive.
 */

/** Township-scoped screens. Every one of these needs an acting township to resolve against. */
const TOWNSHIP_NAV = [
  { to: '/occupancy', key: 'nav.occupancy', icon: LayoutDashboard },
  { to: '/visits', key: 'nav.visits', icon: ScrollText },
  { to: '/notifications', key: 'nav.notifications', icon: Megaphone },
  { to: '/community', key: 'nav.community', icon: MessageSquare },
  { to: '/users', key: 'nav.users', icon: Users },
  { to: '/township', key: 'nav.township', icon: Building2 },
] as const;

/** The platform console. Acts *on* townships, so it needs none selected. */
const PLATFORM_NAV = { to: '/townships', key: 'nav.townships', icon: Globe } as const;

export function AppShell() {
  const { t } = useTranslation();
  const me = useSessionStore((s) => s.me);
  const actingTownshipId = useSessionStore((s) => s.actingTownshipId);
  const [signingOut, setSigningOut] = useState(false);

  const platformOperator = me ? isPlatformOperator(me.role) : false;

  // A super admin with no township selected would see six nav items that all answer
  // 422 TOWNSHIP_CONTEXT_REQUIRED. Hiding them until one is chosen is the honest rendering of
  // what the server will actually accept — the console is the way in.
  const nav = [
    ...(platformOperator ? [PLATFORM_NAV] : []),
    ...(platformOperator && !actingTownshipId ? [] : TOWNSHIP_NAV),
  ];

  return (
    <div className="flex min-h-screen bg-bg">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-surface md:flex">
        <div className="flex h-14 items-center gap-2 border-b border-border px-4">
          <span className="font-semibold text-text">{t('common.appName')}</span>
        </div>

        <nav aria-label={t('nav.primary')} className="flex-1 space-y-0.5 p-2">
          {nav.map(({ to, key, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-text-muted hover:bg-surface-raised hover:text-text',
                )
              }
            >
              <Icon className="size-4" aria-hidden />
              {t(key)}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-end gap-3 border-b border-border bg-surface px-4">
          {/* Which township this session is acting in. Shown to a platform operator because it is
              the only thing that makes the screens below unambiguous — an admin has exactly one and
              never needs telling. */}
          {platformOperator ? <ActingTownship townshipId={actingTownshipId} /> : null}
          <ConnectionPill />
          <ThemeToggle />
          <div className="hidden text-right sm:block">
            <p className="text-sm font-medium leading-tight text-text">{me?.fullName}</p>
            <p className="text-xs leading-tight text-text-muted">
              {me?.townshipCode ? `${me.townshipCode} / ${me.loginId}` : me?.loginId}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('common.signOut')}
            disabled={signingOut}
            onClick={() => {
              setSigningOut(true);
              void signOut().finally(() => setSigningOut(false));
            }}
          >
            <LogOut />
          </Button>
        </header>

        {/* Mobile nav: the dashboard is desktop-first but tablet-tolerant (§0). */}
        <nav
          aria-label={t('nav.primary')}
          className="flex gap-1 overflow-x-auto border-b border-border bg-surface px-2 py-1 md:hidden"
        >
          {nav.map(({ to, key, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium',
                  isActive ? 'bg-primary/10 text-primary' : 'text-text-muted',
                )
              }
            >
              <Icon className="size-3.5" aria-hidden />
              {t(key)}
            </NavLink>
          ))}
        </nav>

        <main className="flex-1 overflow-x-hidden">
          <div className="mx-auto max-w-[1600px] p-4 md:p-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

/** Page heading used by every route, so titles and spacing stay identical across screens. */
/**
 * The acting-township chip.
 *
 * It links to the console rather than opening a picker: switching township changes what every
 * screen behind it means, so it deserves the deliberate step of going to the list and choosing,
 * not a dropdown that can be brushed past.
 */
function ActingTownship({ townshipId }: { townshipId: string | null }) {
  const { t } = useTranslation();
  return (
    <NavLink
      to="/townships"
      className={cn(
        'hidden items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium sm:flex',
        townshipId
          ? 'border-border bg-surface-raised text-text-muted'
          : 'border-warning/40 bg-warning/10 text-warning',
      )}
    >
      <Globe className="size-3" aria-hidden />
      {townshipId ? t('townships.acting') : t('townships.actingNone')}
    </NavLink>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold text-text">{title}</h1>
        {description ? <p className="text-sm text-text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
