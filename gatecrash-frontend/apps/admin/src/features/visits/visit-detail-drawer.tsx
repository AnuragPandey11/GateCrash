import { useVisit } from '@gatecrash/api';
import { asId, formatDateTime, type VisitId } from '@gatecrash/core';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import { VisitStatusBadge, VisitorTypeBadge } from '@/components/status-badge';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { errorMessage } from '@/lib/errors';

/**
 * The visit detail drawer — FRONTEND.md §8.4.
 *
 * Deep-linkable at `/visits/:id`, which is why it is driven by the route rather than by local
 * state: an admin investigating an incident needs to paste a link into a message.
 *
 * The timeline is built from the timestamp *fields* rather than from an event log, because the
 * backend does not expose one — `createdAt`, `decidedAt`, `checkedInAt`, `checkedOutAt` are the
 * whole history a `VisitResponse` carries.
 */
export function VisitDetailDrawer({
  visitId,
  onClose,
}: {
  visitId: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const id = visitId ? asId.visit(visitId) : null;
  const { data: visit, isPending, isError, error, refetch } = useVisit(id as VisitId | null);

  return (
    <Dialog.Root open={Boolean(visitId)} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[hsl(226_40%_6%/0.45)] backdrop-blur-sm data-[state=open]:animate-fade-in" />
        <Dialog.Content className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l border-border bg-surface shadow-overlay data-[state=open]:animate-drawer-in">
          <div className="flex items-center justify-between border-b border-border px-6 py-5">
            <Dialog.Title className="font-display text-xl text-text">{t('visits.detail.title')}</Dialog.Title>
            <Dialog.Close className="rounded-full p-1.5 text-text-muted transition-colors hover:bg-surface-raised hover:text-text">
              <X className="size-4" />
              <span className="sr-only">{t('common.close')}</span>
            </Dialog.Close>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            {isPending ? <LoadingState /> : null}

            {isError ? (
              <ErrorState
                message={
                  // A 404 here means the row is genuinely gone, which deserves plainer copy than
                  // the generic failure text.
                  error && 'status' in error && (error as { status: number }).status === 404
                    ? t('visits.detail.notFound')
                    : errorMessage(error, t)
                }
                onRetry={() => void refetch()}
              />
            ) : null}

            {visit ? (
              <div className="space-y-6">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-semibold text-text">{visit.visitorName}</h3>
                    <VisitorTypeBadge type={visit.visitorType} />
                    <VisitStatusBadge status={visit.status} />
                  </div>
                </div>

                <dl className="space-y-2 text-sm">
                  <Row label={t('visits.detail.phone')}>
                    {visit.visitorPhone ? (
                      <a href={`tel:${visit.visitorPhone}`} className="text-primary hover:underline">
                        {visit.visitorPhone}
                      </a>
                    ) : (
                      '—'
                    )}
                  </Row>
                  <Row label={t('visits.detail.vehicle')}>
                    <span className="font-credential">{visit.vehicleNo ?? '—'}</span>
                  </Row>
                  <Row label={t('visits.detail.gate')}>{visit.gateName}</Row>
                  {visit.exitGateName ? (
                    <Row label={t('visits.detail.exitGate')}>{visit.exitGateName}</Row>
                  ) : null}
                  <Row label={t('visits.detail.flat')}>{visit.targetFlatNumber ?? '—'}</Row>
                  <Row label={t('visits.detail.meetSalesAgent')}>
                    {visit.meetSalesAgent ? t('common.yes') : t('common.no')}
                  </Row>
                  <Row label={t('visits.detail.approver')}>
                    {visit.approverName ??
                      (visit.approverKind === 'SALES'
                        ? t('visits.salesAgent')
                        : visit.approverKind === 'RESIDENT'
                          ? t('role.RESIDENT')
                          : '—')}
                  </Row>
                  <Row label={t('visits.detail.loggedBy')}>{visit.loggedByName}</Row>
                  {visit.preApprovalId ? (
                    <Row label={t('visits.detail.pass')}>{t('common.yes')}</Row>
                  ) : null}
                </dl>

                <section className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                    {t('visits.detail.timeline')}
                  </h4>
                  <ol className="space-y-3 border-l border-border pl-4">
                    <TimelineItem label={t('visits.detail.created')} at={visit.createdAt} />
                    {visit.decidedAt ? (
                      <TimelineItem
                        label={
                          visit.status === 'REJECTED'
                            ? `${t('visits.detail.decided')} — ${t('status.visit.REJECTED')}`
                            : t('visits.detail.decided')
                        }
                        at={visit.decidedAt}
                      />
                    ) : null}
                    {visit.status === 'EXPIRED' && !visit.decidedAt ? (
                      <TimelineItem label={t('visits.detail.expired')} at={null} />
                    ) : null}
                    {visit.checkedInAt ? (
                      <TimelineItem label={t('visits.detail.checkedIn')} at={visit.checkedInAt} />
                    ) : null}
                    {visit.checkedOutAt ? (
                      <TimelineItem label={t('visits.detail.checkedOut')} at={visit.checkedOutAt} />
                    ) : null}
                  </ol>
                </section>

                <section className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                    {t('visits.detail.photo')}
                  </h4>
                  {visit.photoUrl ? (
                    <img
                      src={visit.photoUrl}
                      alt={t('visits.detail.photo')}
                      className="max-h-64 w-full rounded-md border border-border object-cover"
                    />
                  ) : (
                    // Gate photo capture is blocked until the upload endpoint lands (§15.1), so
                    // "no photo" is currently the only outcome — say so rather than showing a
                    // broken frame.
                    <p className="text-sm text-text-muted">{t('visits.detail.noPhoto')}</p>
                  )}
                </section>
              </div>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-text-muted">{label}</dt>
      <dd className="min-w-0 truncate text-right text-text">{children}</dd>
    </div>
  );
}

function TimelineItem({ label, at }: { label: string; at: string | null }) {
  return (
    <li className="relative">
      <span className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-primary" aria-hidden />
      <p className="text-sm text-text">{label}</p>
      <p className="text-xs text-text-muted">{at ? formatDateTime(at) : '—'}</p>
    </li>
  );
}
