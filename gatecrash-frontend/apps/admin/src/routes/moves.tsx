import {
  formatPaise,
  useAllMoves,
  useMoveAction,
  useMyMoves,
  useRequestMove,
  type MoveRequest,
} from '@gatecrash/api';
import { formatDateTime, type MoveStatus, type MoveType, type Tone } from '@gatecrash/core';
import { AlertTriangle, Check, Loader2, Plus, Truck, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/app-shell';
import { Pagination } from '@/components/pagination';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { EmptyState, LoadingState } from '@/components/ui/states';
import { toastError } from '@/lib/errors';
import { toast } from '@/lib/toast';

const STATUS_TONE: Record<MoveStatus, Tone> = {
  PENDING: 'pending',
  APPROVED: 'success',
  REJECTED: 'danger',
  CANCELLED: 'muted',
  COMPLETED: 'info',
};

const hhmm = (time: string) => time.slice(0, 5);

function MoveStatusBadge({ status }: { status: MoveStatus }) {
  const { t } = useTranslation();
  return <Badge tone={STATUS_TONE[status]}>{t(`portal.moves.status.${status}`)}</Badge>;
}

/**
 * Move-in / move-out.
 *
 * The flow, end to end: the resident asks for a date and time window (with the truck and how many
 * helpers), the society office approves or rejects it — seeing the home's unpaid bills while it
 * decides — and the resident is told either way. On the day the guard sees approved moves on the
 * gate console as the material gate pass. Afterwards the office marks it completed; completing a
 * move-out can also deactivate the household's accounts so they stop approving visitors.
 */
export function MovesRoute({ office = false }: { office?: boolean }) {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader
        eyebrow={t('pageEyebrow.moves')}
        title={office ? t('portal.moves.officeTitle') : t('portal.moves.title')}
        description={office ? t('portal.moves.officeSubtitle') : t('portal.moves.subtitle')}
      />
      {office ? <OfficeMoves /> : <ResidentMoves />}
    </>
  );
}

function MoveCard({ move, office, actions }: { move: MoveRequest; office: boolean; actions?: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <Card className="lift">
      <CardContent className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold text-text">
              {t(`portal.moves.type.${move.moveType}`)}
              {office ? ` · ${move.unitCode}` : ''}
            </p>
            <p className="text-sm text-text">
              {move.moveDate} · {hhmm(move.timeFrom)} – {hhmm(move.timeTo)}
            </p>
          </div>
          <MoveStatusBadge status={move.status} />
        </div>
        <p className="text-xs text-text-muted">
          {[
            office ? move.requestedByName : null,
            move.vehicleDetails,
            move.helpersCount ? t('portal.moves.helpersCount', { count: move.helpersCount }) : null,
          ]
            .filter(Boolean)
            .join(' · ') || t('portal.moves.noDetails')}
        </p>
        {move.notes ? <p className="text-sm text-text">{move.notes}</p> : null}
        {office && move.unpaidCount != null ? (
          move.unpaidCount > 0 ? (
            <p className="flex items-center gap-2 rounded-[10px] border border-warning/30 bg-warning/10 px-3 py-2 text-xs font-semibold text-warning">
              <AlertTriangle className="size-4 shrink-0" aria-hidden />
              {t('portal.moves.dues', { count: move.unpaidCount, amount: formatPaise(move.unpaidAmountPaise ?? 0) })}
            </p>
          ) : (
            <p className="text-xs text-success">{t('portal.moves.noDues')}</p>
          )
        ) : null}
        {move.adminNote ? (
          <p className="rounded-[10px] bg-surface-raised px-3 py-2 text-xs text-text">
            {t('portal.moves.officeNote', { note: move.adminNote })}
          </p>
        ) : null}
        {move.decidedAt ? (
          <p className="text-[0.6875rem] text-text-muted">
            {t('portal.moves.decidedBy', { name: move.decidedByName ?? '—', time: formatDateTime(move.decidedAt) })}
          </p>
        ) : null}
        {actions}
      </CardContent>
    </Card>
  );
}

// ── Resident ─────────────────────────────────────────────────────────────────────────────────────

function ResidentMoves() {
  const { t } = useTranslation();
  const moves = useMyMoves();
  const action = useMoveAction();
  const [requesting, setRequesting] = useState(false);

  return (
    <>
      <div className="mb-4">
        <Button onClick={() => setRequesting(true)}>
          <Plus aria-hidden />
          {t('portal.moves.request')}
        </Button>
      </div>
      {moves.isPending ? <LoadingState /> : null}
      {moves.data && moves.data.length === 0 ? (
        <Card>
          <EmptyState icon={Truck} title={t('portal.moves.empty')} description={t('portal.moves.emptyHint')} />
        </Card>
      ) : null}
      <div className="stagger grid gap-3 md:grid-cols-2">
        {(moves.data ?? []).map((move) => (
          <MoveCard
            key={move.id}
            move={move}
            office={false}
            actions={
              move.status === 'PENDING' || move.status === 'APPROVED' ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-danger"
                  disabled={action.isPending}
                  onClick={async () => {
                    try {
                      await action.mutateAsync({ id: move.id, action: 'cancel' });
                      toast.success(t('portal.moves.cancelled'));
                    } catch (error) {
                      toastError(error, t);
                    }
                  }}
                >
                  {t('portal.moves.cancel')}
                </Button>
              ) : null
            }
          />
        ))}
      </div>
      {requesting ? <RequestDialog onClose={() => setRequesting(false)} /> : null}
    </>
  );
}

function RequestDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const request = useRequestMove();
  const tomorrow = new Date(Date.now() + 86_400_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const [type, setType] = useState<MoveType>('MOVE_IN');
  const [date, setDate] = useState(`${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`);
  const [from, setFrom] = useState('10:00');
  const [to, setTo] = useState('14:00');
  const [vehicle, setVehicle] = useState('');
  const [helpers, setHelpers] = useState('');
  const [notes, setNotes] = useState('');
  const valid = date && to > from;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('portal.moves.request')}</DialogTitle>
          <DialogDescription>{t('portal.moves.requestBody')}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <Segmented
            label={t('portal.moves.request')}
            value={type}
            onChange={setType}
            options={[
              { value: 'MOVE_IN', label: t('portal.moves.type.MOVE_IN') },
              { value: 'MOVE_OUT', label: t('portal.moves.type.MOVE_OUT') },
            ]}
          />
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t('portal.moves.date')} required>
              {(props) => <Input {...props} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
            </Field>
            <Field label={t('portal.moves.from')} required>
              {(props) => <Input {...props} type="time" value={from} onChange={(e) => setFrom(e.target.value)} />}
            </Field>
            <Field label={t('portal.moves.to')} required error={to > from ? undefined : t('portal.moves.toAfterFrom')}>
              {(props) => <Input {...props} type="time" value={to} onChange={(e) => setTo(e.target.value)} />}
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
            <Field label={t('portal.moves.vehicle')}>
              {(props) => (
                <Input {...props} value={vehicle} maxLength={200} onChange={(e) => setVehicle(e.target.value)} placeholder={t('portal.moves.vehicleExample')} />
              )}
            </Field>
            <Field label={t('portal.moves.helpers')}>
              {(props) => (
                <Input {...props} type="number" min={0} max={50} inputMode="numeric" value={helpers} onChange={(e) => setHelpers(e.target.value)} />
              )}
            </Field>
          </div>
          <Field label={t('portal.moves.notes')}>
            {(props) => <Textarea {...props} rows={3} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />}
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={!valid || request.isPending}
            onClick={async () => {
              try {
                await request.mutateAsync({
                  moveType: type,
                  moveDate: date,
                  timeFrom: from,
                  timeTo: to,
                  ...(vehicle.trim() ? { vehicleDetails: vehicle.trim() } : {}),
                  ...(helpers ? { helpersCount: Number(helpers) } : {}),
                  ...(notes.trim() ? { notes: notes.trim() } : {}),
                });
                toast.success(t('portal.moves.requested'));
                onClose();
              } catch (error) {
                toastError(error, t);
              }
            }}
          >
            {request.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {t('portal.moves.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Office ───────────────────────────────────────────────────────────────────────────────────────

function OfficeMoves() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<MoveStatus | 'ALL'>('PENDING');
  const [page, setPage] = useState({ page: 1, size: 25 });
  const moves = useAllMoves(status === 'ALL' ? null : status, page);
  const action = useMoveAction();
  const [deciding, setDeciding] = useState<{ move: MoveRequest; decision: 'APPROVED' | 'REJECTED' } | null>(null);
  const [note, setNote] = useState('');
  const [completing, setCompleting] = useState<MoveRequest | null>(null);
  const [deactivate, setDeactivate] = useState(true);

  const run = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      toast.success(done);
      return true;
    } catch (error) {
      toastError(error, t);
      return false;
    }
  };

  return (
    <>
      <Segmented
        className="mb-4"
        label={t('portal.moves.officeTitle')}
        value={status}
        onChange={(v) => {
          setStatus(v);
          setPage((p) => ({ ...p, page: 1 }));
        }}
        options={[
          { value: 'PENDING', label: t('portal.moves.status.PENDING') },
          { value: 'APPROVED', label: t('portal.moves.status.APPROVED') },
          { value: 'COMPLETED', label: t('portal.moves.status.COMPLETED') },
          { value: 'REJECTED', label: t('portal.moves.status.REJECTED') },
          { value: 'ALL', label: t('common.all') },
        ]}
      />
      {moves.isPending ? <LoadingState /> : null}
      {moves.data && moves.data.content.length === 0 ? (
        <Card>
          <EmptyState icon={Truck} title={t('portal.moves.officeEmpty')} />
        </Card>
      ) : null}
      <div className="stagger grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {(moves.data?.content ?? []).map((move) => (
          <MoveCard
            key={move.id}
            move={move}
            office
            actions={
              move.status === 'PENDING' ? (
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="secondary" onClick={() => { setDeciding({ move, decision: 'REJECTED' }); setNote(''); }}>
                    <X aria-hidden />
                    {t('portal.moves.reject')}
                  </Button>
                  <Button onClick={() => { setDeciding({ move, decision: 'APPROVED' }); setNote(''); }}>
                    <Check aria-hidden />
                    {t('portal.moves.approve')}
                  </Button>
                </div>
              ) : move.status === 'APPROVED' ? (
                <Button variant="secondary" className="w-full" onClick={() => { setCompleting(move); setDeactivate(move.moveType === 'MOVE_OUT'); }}>
                  {t('portal.moves.markDone')}
                </Button>
              ) : null
            }
          />
        ))}
      </div>
      {moves.data ? (
        <Pagination page={moves.data} onPageChange={(p) => setPage((prev) => ({ ...prev, page: p }))} className="pt-2" />
      ) : null}

      <Dialog open={deciding !== null} onOpenChange={(o) => !o && setDeciding(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {deciding?.decision === 'APPROVED' ? t('portal.moves.approveTitle') : t('portal.moves.rejectTitle')}
            </DialogTitle>
            <DialogDescription>
              {deciding?.decision === 'APPROVED' ? t('portal.moves.approveBody') : t('portal.moves.rejectBody')}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            rows={3}
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
            aria-label={t('portal.moves.noteLabel')}
            placeholder={deciding?.decision === 'APPROVED' ? t('portal.moves.approveExample') : t('portal.moves.rejectExample')}
          />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDeciding(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant={deciding?.decision === 'REJECTED' ? 'danger' : 'primary'}
              disabled={action.isPending || (deciding?.decision === 'REJECTED' && !note.trim())}
              onClick={async () => {
                if (!deciding) return;
                const ok = await run(
                  () =>
                    action.mutateAsync({
                      id: deciding.move.id,
                      action: 'decide',
                      decision: deciding.decision,
                      ...(note.trim() ? { note: note.trim() } : {}),
                    }),
                  t('portal.moves.decided'),
                );
                if (ok) setDeciding(null);
              }}
            >
              {deciding?.decision === 'APPROVED' ? t('portal.moves.approve') : t('portal.moves.reject')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={completing !== null} onOpenChange={(o) => !o && setCompleting(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('portal.moves.completeTitle', { unit: completing?.unitCode ?? '' })}</DialogTitle>
            <DialogDescription>{t('portal.moves.completeBody')}</DialogDescription>
          </DialogHeader>
          {completing?.moveType === 'MOVE_OUT' ? (
            <label className="flex cursor-pointer items-start gap-3 rounded-[12px] border border-warning/40 bg-warning/5 p-3">
              <Checkbox checked={deactivate} onCheckedChange={(v) => setDeactivate(v === true)} aria-label={t('portal.moves.deactivate')} className="mt-0.5" />
              <span className="space-y-0.5">
                <span className="block text-sm font-semibold text-text">{t('portal.moves.deactivate')}</span>
                <span className="block text-xs text-text-muted">{t('portal.moves.deactivateHint')}</span>
              </span>
            </label>
          ) : null}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setCompleting(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              disabled={action.isPending}
              onClick={async () => {
                if (!completing) return;
                const ok = await run(
                  () =>
                    action.mutateAsync({
                      id: completing.id,
                      action: 'complete',
                      deactivateResidents: completing.moveType === 'MOVE_OUT' && deactivate,
                    }),
                  t('portal.moves.completed'),
                );
                if (ok) setCompleting(null);
              }}
            >
              {t('portal.moves.markDone')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
