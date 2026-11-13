import {
  PAGE_DEFAULTS,
  useCollectionCode,
  useDecide,
  useExtendStay,
  useMyVisits,
  usePendingVisits,
  type VisitResponse,
} from '@gatecrash/api';
import { formatDateTime, formatTime } from '@gatecrash/core';
import { AlarmClock, BellRing, Check, Clock, History, Package, PackageOpen, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/app-shell';
import { Pagination } from '@/components/pagination';
import { MeetSalesBadge, VisitStatusBadge, VisitorTypeBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState, LoadingState } from '@/components/ui/states';
import { DurationPicker } from '@/features/visits/duration-picker';
import { cn } from '@/lib/cn';
import { toastError } from '@/lib/errors';
import { useSessionStore } from '@/lib/session';
import { toast } from '@/lib/toast';

/**
 * The resident's home — and, with `salesMode`, a sales agent's approvals screen.
 *
 * What needs the person *now* comes first: someone waiting at the gate, a guest who has overstayed,
 * a parcel waiting to be collected. History is below. The pending list is pushed live over the
 * user's own WebSocket queue, so a ring at the gate appears here within a second.
 */
export function HomeRoute({ salesMode = false }: { salesMode?: boolean }) {
  const { t } = useTranslation();
  const me = useSessionStore((s) => s.me);
  const pending = usePendingVisits();
  const [page, setPage] = useState({ page: 1, size: PAGE_DEFAULTS.visits ?? 20 });
  const history = useMyVisits(page);

  const rows = history.data?.content ?? [];
  const inside = rows.filter((v) => v.status === 'CHECKED_IN' || v.status === 'APPROVED');
  const parcels = salesMode ? [] : rows.filter((v) => v.status === 'LEFT_AT_GATE');

  return (
    <>
      <PageHeader
        eyebrow={salesMode ? t('pageEyebrow.sales') : (me?.flatNumber ?? t('pageEyebrow.home'))}
        title={salesMode ? t('portal.home.salesTitle') : t('portal.home.title', { name: me?.fullName?.split(' ')[0] ?? '' })}
        description={salesMode ? t('portal.home.salesSubtitle') : t('portal.home.subtitle')}
      />

      <section className="mb-8 space-y-3">
        <SectionTitle icon={BellRing} title={t('portal.home.waiting')} count={pending.data?.length ?? 0} />
        {pending.isPending ? (
          <LoadingState />
        ) : (pending.data ?? []).length === 0 ? (
          <Card>
            <EmptyState icon={BellRing} title={t('portal.home.nobodyWaiting')} description={t('portal.home.nobodyWaitingHint')} />
          </Card>
        ) : (
          <div className="stagger grid gap-3 md:grid-cols-2">
            {(pending.data ?? []).map((visit) => (
              <ApprovalCard key={visit.id} visit={visit} allowLeaveAtGate={!salesMode} />
            ))}
          </div>
        )}
      </section>

      {inside.length > 0 ? (
        <section className="mb-8 space-y-3">
          <SectionTitle icon={Clock} title={t('portal.home.inside')} count={inside.length} />
          <div className="stagger grid gap-3 md:grid-cols-2">
            {inside.map((visit) => (
              <InsideCard key={visit.id} visit={visit} />
            ))}
          </div>
        </section>
      ) : null}

      {parcels.length > 0 ? (
        <section className="mb-8 space-y-3">
          <SectionTitle icon={Package} title={t('portal.home.parcels')} count={parcels.length} />
          <div className="stagger grid gap-3 md:grid-cols-2">
            {parcels.map((visit) => (
              <ParcelCard key={visit.id} visit={visit} />
            ))}
          </div>
        </section>
      ) : null}

      <section className="space-y-3">
        <SectionTitle icon={History} title={t('portal.home.history')} />
        <Card>
          {history.isPending ? (
            <LoadingState />
          ) : rows.length === 0 ? (
            <EmptyState icon={History} title={t('portal.home.noHistory')} />
          ) : (
            <>
              <ul className="divide-y divide-border/70">
                {rows.map((visit) => (
                  <li key={visit.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-text">{visit.visitorName}</p>
                      <p className="text-xs text-text-muted">
                        {formatDateTime(visit.createdAt)} · {visit.gateName}
                        {visit.preApprovalId ? ` · ${t('portal.home.viaPass')}` : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <VisitorTypeBadge type={visit.visitorType} />
                      {visit.autoApproved ? <Badge tone="info">{t('portal.rules.autoBadge')}</Badge> : null}
                      <VisitStatusBadge status={visit.status} />
                    </div>
                  </li>
                ))}
              </ul>
              {history.data ? (
                <Pagination page={history.data} onPageChange={(p) => setPage((prev) => ({ ...prev, page: p }))} />
              ) : null}
            </>
          )}
        </Card>
      </section>
    </>
  );
}

function SectionTitle({ icon: Icon, title, count }: { icon: typeof Clock; title: string; count?: number }) {
  return (
    <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.12em] text-text-muted">
      <Icon className="size-4 text-accent" aria-hidden />
      {title}
      {count !== undefined && count > 0 ? (
        <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[0.6875rem] text-accent">{count}</span>
      ) : null}
    </h2>
  );
}

/**
 * Someone is at the gate. Approve (optionally saying how long they will stay — that is what the
 * overstay alert measures), deny, or for a delivery, have it left with security.
 */
function ApprovalCard({ visit, allowLeaveAtGate }: { visit: VisitResponse; allowLeaveAtGate: boolean }) {
  const { t } = useTranslation();
  const decide = useDecide();
  const [duration, setDuration] = useState<number | undefined>(visit.expectedDurationMinutes ?? undefined);
  const [code, setCode] = useState<string | null>(null);

  const act = async (decision: 'APPROVED' | 'REJECTED' | 'LEAVE_AT_GATE') => {
    try {
      const result = await decide.mutateAsync({
        id: visit.id,
        decision,
        expectedDurationMinutes: decision === 'APPROVED' ? duration : undefined,
      });
      if (decision === 'LEAVE_AT_GATE' && result.collectionCode) setCode(result.collectionCode);
      else toast.success(decision === 'APPROVED' ? t('portal.home.approved') : t('portal.home.denied'));
    } catch (error) {
      toastError(error, t);
    }
  };

  return (
    <Card className="border-pending/40 ring-1 ring-pending/20">
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-display text-xl text-text">{visit.visitorName}</p>
            <p className="text-sm text-text-muted">
              {t('portal.home.atGate', { gate: visit.gateName, time: formatTime(visit.createdAt) })}
            </p>
          </div>
          <span className="relative flex size-3 shrink-0">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-pending opacity-60" />
            <span className="relative inline-flex size-3 rounded-full bg-pending" />
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <VisitorTypeBadge type={visit.visitorType} />
          {visit.meetSalesAgent ? <MeetSalesBadge /> : null}
          {visit.vehicleNo ? <Badge tone="muted">{visit.vehicleNo}</Badge> : null}
        </div>
        {visit.purpose ? <p className="text-sm text-text">{visit.purpose}</p> : null}
        {visit.visitorPhone ? (
          <a href={`tel:${visit.visitorPhone}`} className="text-sm text-primary underline-offset-2 hover:underline">
            {visit.visitorPhone}
          </a>
        ) : null}

        {visit.expectedDurationMinutes == null ? (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-text-muted">{t('portal.home.howLong')}</p>
            <DurationPicker value={duration} onChange={setDuration} />
          </div>
        ) : null}

        <div className={cn('grid gap-2', allowLeaveAtGate && visit.visitorType === 'DELIVERY' ? 'grid-cols-3' : 'grid-cols-2')}>
          <Button variant="secondary" size="lg" disabled={decide.isPending} onClick={() => void act('REJECTED')}>
            <X aria-hidden />
            {t('portal.home.deny')}
          </Button>
          {allowLeaveAtGate && visit.visitorType === 'DELIVERY' ? (
            <Button variant="secondary" size="lg" disabled={decide.isPending} onClick={() => void act('LEAVE_AT_GATE')}>
              <Package aria-hidden />
              <span className="truncate">{t('portal.home.leaveAtGate')}</span>
            </Button>
          ) : null}
          <Button size="lg" disabled={decide.isPending} onClick={() => void act('APPROVED')}>
            <Check aria-hidden />
            {t('portal.home.approve')}
          </Button>
        </div>
      </CardContent>
      {code ? <CodeDialog code={code} onClose={() => setCode(null)} /> : null}
    </Card>
  );
}

/** A guest who is inside (or approved and on their way in): extend the stay from here. */
function InsideCard({ visit }: { visit: VisitResponse }) {
  const { t } = useTranslation();
  const extend = useExtendStay();
  const [open, setOpen] = useState(false);
  const [minutes, setMinutes] = useState<number | undefined>(60);

  return (
    <Card className={cn(visit.overstaying && 'border-danger/60 ring-1 ring-danger/30')}>
      <CardContent className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-semibold text-text">{visit.visitorName}</p>
            <p className="text-xs text-text-muted">
              {visit.status === 'CHECKED_IN'
                ? t('portal.home.insideSince', { time: formatTime(visit.checkedInAt) })
                : t('portal.home.approvedNotIn')}
            </p>
          </div>
          {visit.overstaying ? (
            <Badge tone="danger" icon={<AlarmClock className="size-3" aria-hidden />}>
              {t('portal.gate.overstaying')}
            </Badge>
          ) : (
            <VisitStatusBadge status={visit.status} />
          )}
        </div>
        <p className="text-sm text-text">
          {visit.expectedOutAt
            ? t('portal.home.expectedOut', { time: formatTime(visit.expectedOutAt) })
            : t('portal.home.noExpectedOut')}
        </p>
        <Button variant={visit.overstaying ? 'primary' : 'secondary'} className="w-full" onClick={() => setOpen(true)}>
          <Clock aria-hidden />
          {t('portal.home.extend')}
        </Button>
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('portal.home.extendTitle', { name: visit.visitorName })}</DialogTitle>
            <DialogDescription>{t('portal.home.extendBody')}</DialogDescription>
          </DialogHeader>
          <DurationPicker value={minutes} onChange={setMinutes} allowNone={false} from={new Date()} />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              disabled={!minutes || extend.isPending}
              onClick={async () => {
                try {
                  await extend.mutateAsync({ id: visit.id, extendMinutes: minutes as number });
                  toast.success(t('portal.home.extended'));
                  setOpen(false);
                } catch (error) {
                  toastError(error, t);
                }
              }}
            >
              {t('portal.home.extendConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/** A parcel held at the gate. The code is shown once when it is issued; this gets a fresh one. */
function ParcelCard({ visit }: { visit: VisitResponse }) {
  const { t } = useTranslation();
  const reissue = useCollectionCode();
  const [code, setCode] = useState<string | null>(null);
  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-semibold text-text">{visit.visitorName}</p>
            <p className="text-xs text-text-muted">
              {t('portal.home.leftAt', { gate: visit.gateName, time: formatDateTime(visit.decidedAt) })}
            </p>
          </div>
          <VisitStatusBadge status={visit.status} />
        </div>
        <Button
          variant="secondary"
          className="w-full"
          disabled={reissue.isPending}
          onClick={async () => {
            try {
              const result = await reissue.mutateAsync(visit.id);
              setCode(result.code);
            } catch (error) {
              toastError(error, t);
            }
          }}
        >
          <PackageOpen aria-hidden />
          {t('portal.home.showCode')}
        </Button>
      </CardContent>
      {code ? <CodeDialog code={code} onClose={() => setCode(null)} /> : null}
    </Card>
  );
}

function CodeDialog({ code, onClose }: { code: string; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm text-center">
        <DialogHeader>
          <DialogTitle>{t('portal.home.codeTitle')}</DialogTitle>
          <DialogDescription>{t('portal.home.codeBody')}</DialogDescription>
        </DialogHeader>
        <p className="font-credential text-4xl font-semibold tracking-[0.3em] text-text">{code}</p>
        <DialogFooter>
          <Button className="w-full" onClick={onClose}>
            {t('common.done')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
