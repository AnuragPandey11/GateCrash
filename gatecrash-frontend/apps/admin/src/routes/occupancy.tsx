import { useOccupancy, usePropertyOccupancy, type VisitResponse } from '@gatecrash/api';
import {
  CLIENT_LIMITS,
  VISITOR_TYPES,
  formatDuration,
  formatTime,
  type VisitorType,
} from '@gatecrash/core';
import { DoorOpen, Home, UsersRound, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/app-shell';
import { VisitorTypeBadge } from '@/components/status-badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/errors';

/**
 * How much of the project is lived in — the number a developer means by "occupancy".
 *
 * Deliberately a separate card above the live board, because the two answer different questions
 * and used to share a word. The board below counts *visitors currently at the gate*; this counts
 * *units that are lived in* and *people who live in them*. Collapsing them into one headline is
 * how a developer ends up reading their sales occupancy off the lobby.
 *
 * Registered logins are shown against the headcount rather than instead of it: the gap between
 * them is how many residents cannot yet be reached by a notification, which is actionable in a way
 * that neither number is alone.
 */
function PropertyOccupancyCard() {
  const { t } = useTranslation();
  const summary = usePropertyOccupancy();

  if (summary.isPending || summary.isError || !summary.data) return null;

  const s = summary.data;
  const notReachable = s.residentHeadcount - s.registeredResidentAccounts;
  const percent = Math.round(s.occupancyRate * 100);

  return (
    <div className="stagger mb-6 grid gap-4 md:grid-cols-3">
      <StatTile
        icon={Home}
        value={`${percent}%`}
        label={t('occupancy.summary.rate')}
        detail={t('occupancy.summary.occupiedUnits', {
          occupied: s.occupiedUnits,
          total: s.totalUnits,
        })}
        progress={s.occupancyRate}
      />
      <StatTile
        icon={UsersRound}
        value={String(s.residentHeadcount)}
        label={t('occupancy.summary.headcount')}
        detail={
          t('occupancy.summary.accounts', { count: s.registeredResidentAccounts }) +
          (notReachable > 0 ? ` · ${t('occupancy.summary.accountsGap', { count: notReachable })}` : '')
        }
      />
      <StatTile
        icon={DoorOpen}
        value={String(s.visitorsInside)}
        label={t('occupancy.summary.visitorsInside')}
        detail={t('occupancy.summary.visitorsHint')}
      />
    </div>
  );
}

/**
 * A headline number. Display serif for the figure, a quiet accent-ringed icon, and — where the
 * number is a share of something — a slim progress hairline beneath it.
 */
function StatTile({
  icon: Icon,
  value,
  label,
  detail,
  progress,
}: {
  icon: LucideIcon;
  value: string;
  label: string;
  detail: string;
  progress?: number;
}) {
  return (
    <Card className="lift relative overflow-hidden">
      <div className="pointer-events-none absolute -right-10 -top-10 size-32 rounded-full bg-accent/10 blur-2xl" />
      <CardContent className="relative space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-text-muted">
            {label}
          </p>
          <span className="flex size-9 items-center justify-center rounded-full border border-accent/30 bg-accent-soft text-accent">
            <Icon className="size-4" aria-hidden />
          </span>
        </div>
        <p className="font-display text-[2.5rem] leading-none tabular-nums text-text">{value}</p>
        {progress !== undefined ? (
          <div className="h-1 overflow-hidden rounded-full bg-surface-raised">
            <div
              className="h-full rounded-full bg-gradient-to-r from-accent/70 to-accent transition-[width] duration-1000 ease-out-expo"
              style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }}
            />
          </div>
        ) : null}
        <p className="text-xs text-text-muted">{detail}</p>
      </CardContent>
    </Card>
  );
}

/**
 * The occupancy board — FRONTEND.md §8.3. The hero screen.
 *
 * `GET /admin/inside` fills it and `/topic/admin/inside` keeps it live, but the two are not
 * equals: Postgres is the source of truth and the socket is an accelerant. The query polls on a
 * 60s interval regardless, so a silently dead socket degrades to a slightly-late board rather
 * than a frozen one (guardrail #7).
 *
 * Two deliberate non-behaviours:
 *
 *  - **No spinner flash on update.** Occupancy changes often; re-mounting the grid on every
 *    check-in makes the board look broken. Updates land in place.
 *  - **"Inside for" is recomputed from `checkedInAt` on a 60s tick**, not accumulated in a
 *    client-side stopwatch — a backgrounded tab whose timers were throttled must still be right
 *    when the admin comes back to it.
 */
export function OccupancyRoute() {
  const { t } = useTranslation();
  const { data, isPending, isError, error, refetch } = useOccupancy();

  const [search, setSearch] = useState('');
  const [types, setTypes] = useState<Set<VisitorType>>(new Set());
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), CLIENT_LIMITS.elapsedTickMs);
    return () => clearInterval(timer);
  }, []);

  const visits = useMemo(() => {
    const rows = data?.visits ?? [];
    const needle = search.trim().toLowerCase();
    return rows.filter((visit) => {
      if (types.size > 0 && !types.has(visit.visitorType)) return false;
      if (!needle) return true;
      return (
        visit.visitorName.toLowerCase().includes(needle) ||
        (visit.targetFlatNumber ?? '').toLowerCase().includes(needle) ||
        (visit.approverName ?? '').toLowerCase().includes(needle)
      );
    });
  }, [data?.visits, search, types]);

  const toggleType = (type: VisitorType) =>
    setTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });

  if (isPending) return <LoadingState />;

  // Only takes the screen when there is no cached data to fall back on (§11.1).
  if (isError && !data) {
    return <ErrorState message={errorMessage(error, t)} onRetry={() => void refetch()} />;
  }

  const insideCount = data?.insideCount ?? 0;

  return (
    <>
      <PageHeader
        eyebrow={t('pageEyebrow.overview')} title={t('occupancy.title')} description={t('occupancy.subtitle')} />

      <PropertyOccupancyCard />

      <Card className="mb-6">
        <CardContent className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-baseline gap-3">
            <p
              // `key` on the count makes React re-mount just this node so the pop animation
              // replays — without re-mounting the grid behind it.
              key={insideCount}
              className="animate-count-pop font-display text-[2.5rem] leading-none tabular-nums text-text"
            >
              {insideCount}
            </p>
            <p className="text-sm text-text-muted">
              {t('occupancy.insideCount', { count: insideCount })}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {VISITOR_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                aria-pressed={types.has(type)}
                onClick={() => toggleType(type)}
                className={cn(
                  'rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-all duration-200',
                  types.has(type)
                    ? 'border-primary bg-primary text-primary-fg shadow-soft'
                    : 'border-border text-text-muted hover:border-accent/50 hover:text-text',
                )}
              >
                {t(`status.visitorType.${type}`)}
              </button>
            ))}
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('occupancy.searchPlaceholder')}
              aria-label={t('occupancy.searchPlaceholder')}
              className="h-9 w-60"
            />
          </div>
        </CardContent>
      </Card>

      {visits.length === 0 ? (
        <Card>
          {/* An empty board is a legitimate and common state for a township at 3am, not an
              error — the copy says so plainly (§8.3). */}
          <EmptyState
            icon={UsersRound}
            title={
              data && data.visits.length > 0 ? t('occupancy.noMatches') : t('occupancy.empty')
            }
            description={data && data.visits.length > 0 ? undefined : t('occupancy.emptyHint')}
          />
        </Card>
      ) : (
        <div className="stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visits.map((visit) => (
            <VisitorCard key={visit.id} visit={visit} now={now} />
          ))}
        </div>
      )}
    </>
  );
}

function VisitorCard({ visit, now }: { visit: VisitResponse; now: Date }) {
  const { t } = useTranslation();
  const destination = visit.targetFlatNumber ?? visit.approverName ?? '—';

  return (
    <Card className="lift hover:border-accent/40">
      <CardContent className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 truncate font-semibold text-text" title={visit.visitorName}>
            {visit.visitorName}
          </p>
          <VisitorTypeBadge type={visit.visitorType} />
        </div>

        <dl className="space-y-1 text-sm text-text-muted">
          <div className="flex justify-between gap-2">
            <dt>{t('visits.detail.gate')}</dt>
            <dd className="truncate text-text">{visit.gateName}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>{t('visits.columns.destination')}</dt>
            <dd className="truncate text-text">{destination}</dd>
          </div>
          {visit.vehicleNo ? (
            <div className="flex justify-between gap-2">
              <dt>{t('visits.detail.vehicle')}</dt>
              <dd className="font-credential text-text">{visit.vehicleNo}</dd>
            </div>
          ) : null}
        </dl>

        <p className="border-t border-border pt-2 text-xs text-text-muted">
          {t('occupancy.insideFor', { duration: formatDuration(visit.checkedInAt, now) })}
          <span className="px-1">·</span>
          {formatTime(visit.checkedInAt)}
        </p>
      </CardContent>
    </Card>
  );
}
