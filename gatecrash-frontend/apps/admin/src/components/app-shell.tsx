import { isPlatformOperator } from '@gatecrash/core';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Globe, LogOut, Menu, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, matchPath, useLocation } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { signOut, useSessionStore } from '@/lib/session';
import { BrandTile } from './brand';
import { ConnectionPill } from './connection-pill';
import { navFor, type NavItem, type NavSectionDef } from './nav-config';
import { NotificationBell } from './notification-bell';
import { ThemeToggle } from './theme-toggle';
import { Button } from './ui/button';

/**
 * The dashboard shell — FRONTEND.md §8.1.
 *
 * A plain sidebar on the same surface as the cards — it organises, it does not decorate; the one
 * strong mark in it is the active screen, an ink pill in Oakshade's manner. It
 * collapses to an icon rail (remembered per browser) for anyone who wants the width back for the
 * visitor log; collapsed, each item keeps its name for screen readers and shows it as a tooltip.
 * The top bar is translucent and sticky so the live-connection pill is always in view. Content is
 * capped at 1600px: this is a desktop-first internal tool, and a visitor log stretched across a
 * 34-inch monitor is unreadable, not impressive.
 */

const COLLAPSED_KEY = 'gc.sidebar.collapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function AppShell() {
  const { t } = useTranslation();
  const location = useLocation();
  const me = useSessionStore((s) => s.me);
  const actingTownshipId = useSessionStore((s) => s.actingTownshipId);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Navigating closes the phone drawer — the screen it opened is what the person wanted to see.
  useEffect(() => setDrawerOpen(false), [location.pathname]);

  const toggleCollapsed = () =>
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSED_KEY, String(next));
      } catch {
        // Private mode: the choice lasts for this tab. Fine.
      }
      return next;
    });

  const platformOperator = me ? isPlatformOperator(me.role) : false;

  // Each role's own screens (nav-config.ts). A super admin with no township selected sees only the
  // console: every township screen would answer 422 TOWNSHIP_CONTEXT_REQUIRED until one is chosen.
  const sections: NavSectionDef[] = me
    ? navFor({ role: me.role, sales: me.sales, townshipSelected: Boolean(actingTownshipId) })
    : [];

  return (
    <Tooltip.Provider delayDuration={150}>
      <div className="flex min-h-screen bg-bg">
        <aside
          data-collapsed={collapsed}
          className={cn(
            'sticky top-0 hidden h-screen shrink-0 flex-col overflow-hidden border-r border-border bg-surface md:flex',
            'transition-[width] duration-300 ease-out-expo',
            collapsed ? 'w-[4.5rem]' : 'w-60',
          )}
        >
          <Brand collapsed={collapsed} />

          <nav
            aria-label={t('nav.primary')}
            className="flex-1 space-y-5 overflow-y-auto overflow-x-hidden px-3 py-4"
          >
            {sections.map((section) => (
              <NavSection key={section.key} label={t(section.key)} items={section.items} collapsed={collapsed} />
            ))}
          </nav>

          <UserCard collapsed={collapsed} />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border/70 bg-bg/75 px-4 backdrop-blur-xl md:px-6">
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleCollapsed}
              aria-label={collapsed ? t('nav.expandSidebar') : t('nav.collapseSidebar')}
              aria-expanded={!collapsed}
              title={collapsed ? t('nav.expandSidebar') : t('nav.collapseSidebar')}
              className="hidden size-9 md:inline-flex"
            >
              {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setDrawerOpen(true)}
              aria-label={t('nav.openMenu')}
              className="-ml-1 size-10 md:hidden"
            >
              <Menu />
            </Button>
            <div className="flex min-w-0 items-center gap-2.5 md:hidden">
              <BrandTile size="sm" />
              <span className="truncate font-display text-lg text-text">{t('common.appName')}</span>
            </div>
            <p className="hidden text-sm text-text-muted md:block">
              {new Intl.DateTimeFormat(undefined, {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              }).format(new Date())}
            </p>

            <div className="ml-auto flex items-center gap-2">
              {/* Which township this session is acting in. Shown to a platform operator because it
                  is the only thing that makes the screens below unambiguous — an admin has exactly
                  one and never needs telling. */}
              {platformOperator ? <ActingTownship townshipId={actingTownshipId} /> : null}
              <ConnectionPill />
              {/* Everyone who lives in a township gets the bell; a platform operator only once a
                  township is selected, since every list behind it is township-scoped. */}
              {me && (me.townshipId || actingTownshipId) ? <NotificationBell /> : null}
              <ThemeToggle />
            </div>
          </header>

          {/* Phones: the full navigation in a slide-out drawer. A sideways strip of eight tabs is
              unusable one-handed; a drawer shows every screen with its full name. */}
          <DialogPrimitive.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
            <DialogPrimitive.Portal>
              <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-scrim/50 backdrop-blur-sm data-[state=open]:animate-fade-in md:hidden" />
              <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-50 flex w-[17.5rem] max-w-[85vw] flex-col border-r border-border bg-surface shadow-overlay data-[state=open]:animate-drawer-left md:hidden">
                <DialogPrimitive.Title className="sr-only">{t('nav.primary')}</DialogPrimitive.Title>
                <div className="flex items-center justify-between pr-3">
                  <Brand collapsed={false} />
                  <DialogPrimitive.Close
                    className="rounded-full p-2 text-text-muted transition-colors hover:bg-surface-raised hover:text-text"
                    aria-label={t('common.close')}
                  >
                    <X className="size-5" />
                  </DialogPrimitive.Close>
                </div>
                <nav aria-label={t('nav.primary')} className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
                  {sections.map((section) => (
                    <NavSection key={section.key} label={t(section.key)} items={section.items} collapsed={false} large />
                  ))}
                </nav>
                {platformOperator ? (
                  <div className="px-4 pb-3">
                    <ActingTownship townshipId={actingTownshipId} block />
                  </div>
                ) : null}
                <UserCard collapsed={false} />
              </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
          </DialogPrimitive.Root>

          <main className="flex-1 overflow-x-hidden">
            {/* Keyed by path so each screen rises in on arrival rather than snapping into place. */}
            <div key={location.pathname} className="mx-auto max-w-[1600px] animate-enter px-4 py-6 md:px-8 md:py-8">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </Tooltip.Provider>
  );
}

/** Shows `label` beside the trigger, but only while the sidebar is collapsed to icons. */
function RailTooltip({
  label,
  enabled,
  children,
}: {
  label: string;
  enabled: boolean;
  children: ReactNode;
}) {
  if (!enabled) return <>{children}</>;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="right"
          sideOffset={10}
          className="z-50 rounded-full bg-text px-3 py-1.5 text-xs font-semibold text-text-inverse shadow-raised animate-pop-in"
        >
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

function Brand({ collapsed }: { collapsed: boolean }) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        'flex h-16 shrink-0 items-center gap-3 border-b border-border',
        // Collapsed, the mark is centred on the rail — the same axis as the nav icons below it.
        collapsed ? 'justify-center px-0' : 'px-5',
      )}
    >
      <BrandTile />
      <span className={collapsed ? 'sr-only' : 'min-w-0 leading-none'}>
        <span className="block whitespace-nowrap font-display text-[1.0625rem] text-text">
          {t('common.appName')}
        </span>
        {/* The endorsement: GateCrash is an Oakshade AI product. */}
        <span className="mt-1 block whitespace-nowrap text-xs text-text-muted">{t('brand.byline')}</span>
      </span>
    </div>
  );
}

function NavSection({
  label,
  items,
  collapsed,
  large = false,
}: {
  label: string;
  items: readonly NavItem[];
  collapsed: boolean;
  /** Phone drawer: taller rows for a thumb. */
  large?: boolean;
}) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  return (
    <div className="space-y-0.5">
      {collapsed ? (
        // The section word does not fit a rail; a hairline keeps the grouping visible.
        <div className="mx-2 mb-2 h-px bg-border" aria-hidden />
      ) : (
        <p className="whitespace-nowrap px-3 pb-1.5 text-xs font-medium text-text-muted">
          {label}
        </p>
      )}
      {items.map(({ to, key, icon: Icon }) => {
        // Active state is computed here and passed as a plain string, not via NavLink's
        // className-function: the tooltip trigger (Radix Slot) merges classNames as strings and
        // would flatten that function into garbage, unstyling the link in the collapsed rail.
        const isActive = matchPath({ path: to, end: false }, pathname) !== null;
        return (
        <RailTooltip key={to} label={t(key)} enabled={collapsed}>
          <NavLink
            to={to}
            className={cn(
              'flex items-center gap-3 rounded-full text-sm font-medium transition-colors',
              large ? 'min-h-11 py-2.5' : 'py-2',
              collapsed ? 'mx-auto size-10 justify-center px-0' : 'px-3.5',
              // The active screen is the one ink pill in the sidebar.
              isActive
                ? 'bg-primary text-primary-fg'
                : 'text-text-muted hover:bg-surface-raised hover:text-text',
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            {/* Kept in the DOM when collapsed so the link still has a name for screen readers. */}
            <span className={collapsed ? 'sr-only' : 'truncate whitespace-nowrap'}>{t(key)}</span>
          </NavLink>
        </RailTooltip>
        );
      })}
    </div>
  );
}

function initials(name: string | undefined): string {
  if (!name) return '·';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : ''))
    .toUpperCase();
}

function UserCard({ collapsed }: { collapsed: boolean }) {
  const { t } = useTranslation();
  const me = useSessionStore((s) => s.me);
  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-2 border-t border-border py-3">
        <RailTooltip label={me?.fullName ?? ''} enabled>
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-text">
            {initials(me?.fullName)}
          </span>
        </RailTooltip>
        <SignOutButton />
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 border-t border-border px-4 py-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-text">
        {initials(me?.fullName)}
      </span>
      <div className="min-w-0 flex-1 leading-tight">
        <p className="truncate text-sm font-medium text-text">{me?.fullName}</p>
        <p className="truncate text-xs text-text-muted">
          {me?.townshipCode ? `${me.townshipCode} / ${me.loginId}` : t('nav.platformOperator')}
        </p>
      </div>
      <SignOutButton />
    </div>
  );
}

function SignOutButton() {
  const { t } = useTranslation();
  const [signingOut, setSigningOut] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={t('common.signOut')}
      title={t('common.signOut')}
      disabled={signingOut}
      className="size-8"
      onClick={() => {
        setSigningOut(true);
        void signOut().finally(() => setSigningOut(false));
      }}
    >
      <LogOut />
    </Button>
  );
}

/**
 * The acting-township chip.
 *
 * It links to the console rather than opening a picker: switching township changes what every
 * screen behind it means, so it deserves the deliberate step of going to the list and choosing,
 * not a dropdown that can be brushed past.
 */
function ActingTownship({ townshipId, block = false }: { townshipId: string | null; block?: boolean }) {
  const { t } = useTranslation();
  return (
    <NavLink
      to="/townships"
      className={cn(
        'h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors',
        block ? 'flex w-full justify-center' : 'hidden sm:flex',
        townshipId
          ? 'border-text/15 bg-surface text-text hover:border-text/40'
          : 'border-warning/40 bg-warning/10 text-warning',
      )}
    >
      <Globe className="size-3.5" aria-hidden />
      {townshipId ? t('townships.acting') : t('townships.actingNone')}
    </NavLink>
  );
}

/** Page heading used by every route, so titles and spacing stay identical across screens. */
export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  /** A short muted line above the title — the section a screen belongs to. */
  eyebrow?: string;
}) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div className="space-y-1">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1 className="font-display text-[1.75rem] leading-tight text-text md:text-[2rem]">{title}</h1>
        {description ? (
          <p className="max-w-2xl pt-1 text-[0.9375rem] leading-relaxed text-text-muted">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
