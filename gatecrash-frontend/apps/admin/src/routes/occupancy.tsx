import { useOccupancy, type VisitResponse } from '@gatecrash/api';
import {
  CLIENT_LIMITS,
  VISITOR_TYPES,
  formatDuration,
  formatTime,
  type VisitorType,
} from '@gatecrash/core';
import { UsersRound } from 'lucide-react';
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
      <PageHeader title={t('occupancy.title')} description={t('occupancy.subtitle')} />

      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p
              // `key` on the count makes React re-mount just this node so the pop animation
              // replays — without re-mounting the grid behind it.
              key={insideCount}
              className="animate-count-pop text-3xl font-semibold tabular-nums text-text"
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
                  'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                  types.has(type)
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-text-muted hover:text-text',
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
              className="h-8 w-56"
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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
    <Card className="transition-colors hover:border-primary/40">
      <CardContent className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 truncate font-medium text-text" title={visit.visitorName}>
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
