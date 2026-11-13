import {
  PAGE_DEFAULTS,
  useCreatePass,
  useMyPasses,
  useRevokePass,
  type PassResponse,
} from '@gatecrash/api';
import { VISITOR_TYPES, formatDateTime, type PassType, type VisitorType } from '@gatecrash/core';
import { CalendarRange, Download, Loader2, Plus, QrCode, Share2, Ticket, Trash2 } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/app-shell';
import { Pagination } from '@/components/pagination';
import { PassStatusBadge, VisitorTypeBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
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
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { EmptyState, LoadingState } from '@/components/ui/states';
import { DurationPicker, formatMinutes } from '@/features/visits/duration-picker';
import { toastError } from '@/lib/errors';
import { useSessionStore } from '@/lib/session';
import { toast } from '@/lib/toast';

/** `datetime-local` value for a Date, in the browser's zone. */
function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toDateInput(date: Date): string {
  return toLocalInput(date).slice(0, 10);
}

/**
 * Guest passes — the resident's pre-approvals.
 *
 * A pass asks for the same details the guard's walk-in form does, so the guard's screen is already
 * filled in when the QR is scanned. Two kinds:
 *
 *  - **One-time** — arrival and out time on one day. Works from an hour before arrival until the
 *    out time, once.
 *  - **Frequent** — a tutor, a cook: a date range and how long each visit lasts. Works any time in
 *    the range, any number of times.
 */
export function PassesRoute() {
  const { t } = useTranslation();
  const [page, setPage] = useState({ page: 1, size: PAGE_DEFAULTS.passes ?? 20 });
  const passes = useMyPasses(page);
  const revoke = useRevokePass();
  const [creating, setCreating] = useState(false);
  const [showing, setShowing] = useState<{ pass: PassSummary; pin?: string } | null>(null);
  const [revoking, setRevoking] = useState<PassResponse | null>(null);

  return (
    <>
      <PageHeader
        eyebrow={t('pageEyebrow.passes')}
        title={t('portal.passes.title')}
        description={t('portal.passes.subtitle')}
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden />
            {t('portal.passes.create')}
          </Button>
        }
      />

      {passes.isPending ? <LoadingState /> : null}
      {passes.data && passes.data.content.length === 0 ? (
        <Card>
          <EmptyState
            icon={Ticket}
            title={t('portal.passes.empty')}
            description={t('portal.passes.emptyHint')}
            action={<Button onClick={() => setCreating(true)}>{t('portal.passes.create')}</Button>}
          />
        </Card>
      ) : null}

      <div className="stagger grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {(passes.data?.content ?? []).map((pass) => (
          <Card key={pass.id} className="lift">
            <CardContent className="space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-text">{pass.visitorName ?? '—'}</p>
                  <p className="text-xs text-text-muted">{pass.visitorPhone}</p>
                </div>
                <PassStatusBadge status={pass.status} />
              </div>
              <div className="flex flex-wrap gap-1.5">
                <VisitorTypeBadge type={pass.visitorType} />
                <Badge tone={pass.passType === 'FREQUENT' ? 'primary' : 'muted'}>
                  {t(`portal.passes.type.${pass.passType}`)}
                </Badge>
              </div>
              <p className="text-xs text-text-muted">
                {pass.passType === 'FREQUENT'
                  ? t('portal.passes.frequentRange', {
                      from: formatDateTime(pass.validFrom),
                      to: formatDateTime(pass.validUntil),
                      duration: pass.expectedDurationMinutes ? formatMinutes(pass.expectedDurationMinutes) : '—',
                    })
                  : t('portal.passes.oneTimeRange', {
                      arrival: formatDateTime(pass.expectedArrivalAt ?? pass.validFrom),
                      out: formatDateTime(pass.validUntil),
                    })}
              </p>
              <p className="text-xs text-text-muted">
                {pass.maxUses == null
                  ? t('portal.passes.usedTimes', { count: pass.useCount })
                  : t('portal.passes.usedOf', { used: pass.useCount, max: pass.maxUses })}
              </p>
              {pass.status === 'ACTIVE' ? (
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="secondary" onClick={() => setShowing({ pass })}>
                    <QrCode aria-hidden />
                    {t('portal.passes.showQr')}
                  </Button>
                  <Button variant="ghost" className="text-danger" onClick={() => setRevoking(pass)}>
                    <Trash2 aria-hidden />
                    {t('portal.passes.revoke')}
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>
      {passes.data ? (
        <Pagination page={passes.data} onPageChange={(p) => setPage((prev) => ({ ...prev, page: p }))} className="pt-2" />
      ) : null}

      {creating ? (
        <CreatePassDialog
          onClose={() => setCreating(false)}
          onCreated={(pass, pin) => {
            setCreating(false);
            setShowing({ pass, pin });
          }}
        />
      ) : null}
      {showing ? <QrDialog pass={showing.pass} pin={showing.pin} onClose={() => setShowing(null)} /> : null}

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title={t('portal.passes.revokeTitle', { name: revoking?.visitorName ?? '' })}
        description={t('portal.passes.revokeBody')}
        confirmLabel={t('portal.passes.revoke')}
        destructive
        pending={revoke.isPending}
        onConfirm={async () => {
          if (!revoking) return;
          try {
            await revoke.mutateAsync(revoking.id);
            toast.success(t('portal.passes.revoked'));
          } catch (error) {
            toastError(error, t);
          }
          setRevoking(null);
        }}
      />
    </>
  );
}

interface PassSummary {
  qrToken: string;
  visitorName?: string | null;
  passType: PassType;
  validFrom: string;
  validUntil: string;
  expectedArrivalAt?: string | null;
}

function CreatePassDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (pass: PassSummary, pin: string) => void;
}) {
  const { t } = useTranslation();
  const create = useCreatePass();
  const now = new Date();
  const [type, setType] = useState<PassType>('ONE_TIME');
  const [visitorType, setVisitorType] = useState<VisitorType>('GUEST');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [purpose, setPurpose] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [arrival, setArrival] = useState(toLocalInput(new Date(now.getTime() + 30 * 60_000)));
  const [out, setOut] = useState(toLocalInput(new Date(now.getTime() + 3 * 3_600_000)));
  const [startDate, setStartDate] = useState(toDateInput(now));
  const [endDate, setEndDate] = useState(toDateInput(new Date(now.getTime() + 30 * 86_400_000)));
  const [duration, setDuration] = useState<number | undefined>(60);

  const phoneOk = /^\+?[0-9]{7,15}$/.test(phone.trim());
  const window =
    type === 'ONE_TIME'
      ? { from: new Date(arrival), until: new Date(out) }
      : { from: new Date(`${startDate}T00:00`), until: new Date(`${endDate}T23:59`) };
  const windowOk = !Number.isNaN(window.from.getTime()) && window.until > window.from;
  const canSubmit =
    name.trim() && phoneOk && windowOk && (type === 'ONE_TIME' || Boolean(duration)) && !create.isPending;

  const submit = async () => {
    try {
      const result = await create.mutateAsync({
        passType: type,
        visitorType,
        visitorName: name.trim(),
        visitorPhone: phone.trim(),
        ...(purpose.trim() ? { purpose: purpose.trim() } : {}),
        ...(vehicle.trim() ? { vehicleNo: vehicle.trim() } : {}),
        validFrom: window.from.toISOString(),
        validUntil: window.until.toISOString(),
        ...(type === 'FREQUENT' ? { expectedDurationMinutes: duration } : {}),
      } as never);
      onCreated(
        {
          qrToken: result.qrToken,
          visitorName: name.trim(),
          passType: type,
          validFrom: result.validFrom,
          validUntil: result.validUntil,
          expectedArrivalAt: type === 'ONE_TIME' ? window.from.toISOString() : null,
        },
        result.pin,
      );
    } catch (error) {
      toastError(error, t);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('portal.passes.create')}</DialogTitle>
          <DialogDescription>{t('portal.passes.createBody')}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <Segmented
            label={t('portal.passes.kind')}
            value={type}
            onChange={setType}
            options={[
              { value: 'ONE_TIME', label: t('portal.passes.type.ONE_TIME'), icon: <Ticket className="size-4" /> },
              { value: 'FREQUENT', label: t('portal.passes.type.FREQUENT'), icon: <CalendarRange className="size-4" /> },
            ]}
          />
          <p className="text-xs text-text-muted">{t(`portal.passes.kindHint.${type}`)}</p>

          <div className="space-y-1.5">
            <p className="text-[0.8125rem] font-semibold text-text">{t('portal.visitor.type')}</p>
            <Segmented
              size="sm"
              label={t('portal.visitor.type')}
              value={visitorType}
              onChange={setVisitorType}
              options={VISITOR_TYPES.map((v) => ({ value: v, label: t(`status.visitorType.${v}`) }))}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('portal.visitor.name')} required>
              {(props) => <Input {...props} value={name} onChange={(e) => setName(e.target.value)} />}
            </Field>
            <Field
              label={t('portal.visitor.phone')}
              required
              error={phone && !phoneOk ? t('portal.visitor.phoneInvalid') : undefined}
            >
              {(props) => (
                <Input {...props} type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
              )}
            </Field>
            <Field label={t('portal.visitor.purpose')}>
              {(props) => <Input {...props} value={purpose} onChange={(e) => setPurpose(e.target.value)} />}
            </Field>
            <Field label={t('portal.visitor.vehicle')}>
              {(props) => (
                <Input
                  {...props}
                  value={vehicle}
                  onChange={(e) => setVehicle(e.target.value.toUpperCase())}
                  className="uppercase"
                />
              )}
            </Field>
          </div>

          {type === 'ONE_TIME' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('portal.passes.arrival')} required>
                {(props) => (
                  <Input {...props} type="datetime-local" value={arrival} onChange={(e) => setArrival(e.target.value)} />
                )}
              </Field>
              <Field
                label={t('portal.passes.outTime')}
                required
                error={windowOk ? undefined : t('portal.passes.outAfterArrival')}
              >
                {(props) => <Input {...props} type="datetime-local" value={out} onChange={(e) => setOut(e.target.value)} />}
              </Field>
            </div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('portal.passes.startDate')} required>
                  {(props) => (
                    <Input {...props} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                  )}
                </Field>
                <Field
                  label={t('portal.passes.endDate')}
                  required
                  error={windowOk ? undefined : t('portal.passes.endAfterStart')}
                >
                  {(props) => <Input {...props} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />}
                </Field>
              </div>
              <div className="space-y-1.5">
                <p className="text-[0.8125rem] font-semibold text-text">
                  {t('portal.passes.eachVisit')}
                  <span className="ml-0.5 text-danger">*</span>
                </p>
                <DurationPicker value={duration} onChange={setDuration} allowNone={false} />
              </div>
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={!canSubmit} onClick={() => void submit()}>
            {create.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <QrCode aria-hidden />}
            {t('portal.passes.createQr')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The QR to hand to the guest. The image carries only the pass token; the PIN is shown only right
 * after creation, because the server never stores it in readable form.
 */
function QrDialog({ pass, pin, onClose }: { pass: PassSummary; pin?: string; onClose: () => void }) {
  const { t } = useTranslation();
  const me = useSessionStore((s) => s.me);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    void QRCode.toDataURL(pass.qrToken, { width: 560, margin: 2, errorCorrectionLevel: 'M' }).then(setUrl);
  }, [pass.qrToken]);

  const fileName = `gatepass-${(pass.visitorName ?? 'guest').replace(/\W+/g, '-').toLowerCase()}.png`;
  const message = t('portal.passes.shareText', {
    name: pass.visitorName ?? '',
    township: me?.townshipName ?? '',
    pin: pin ?? '',
  });

  const share = async () => {
    if (!url) return;
    try {
      // The QR is already in memory as a data URL; decode it rather than "fetching" it.
      const bytes = Uint8Array.from(atob(url.split(',')[1] ?? ''), (c) => c.charCodeAt(0));
      const file = new File([bytes], fileName, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text: message });
      } else {
        await navigator.share?.({ text: message });
      }
    } catch {
      // The user closed the share sheet — not an error.
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('portal.passes.qrTitle', { name: pass.visitorName ?? '' })}</DialogTitle>
          <DialogDescription>
            {pass.passType === 'FREQUENT'
              ? t('portal.passes.qrFrequent', { to: formatDateTime(pass.validUntil) })
              : t('portal.passes.qrOneTime', {
                  arrival: formatDateTime(pass.expectedArrivalAt ?? pass.validFrom),
                  out: formatDateTime(pass.validUntil),
                })}
          </DialogDescription>
        </DialogHeader>
        <div className="mx-auto w-full max-w-[16rem] rounded-[16px] border border-border bg-white p-3 shadow-soft">
          {url ? <img src={url} alt={t('portal.passes.qrAlt')} className="w-full" /> : <LoadingState />}
        </div>
        {pin ? (
          <div className="rounded-[12px] border border-border bg-surface-raised p-3 text-center">
            <p className="text-xs text-text-muted">{t('portal.passes.pinLabel')}</p>
            <p className="font-credential text-2xl font-semibold tracking-[0.3em] text-text">{pin}</p>
            <p className="pt-1 text-xs text-text-muted">{t('portal.passes.pinOnce')}</p>
          </div>
        ) : null}
        <DialogFooter className="grid grid-cols-2 gap-2 sm:flex">
          <Button variant="secondary" asChild>
            <a href={url ?? '#'} download={fileName}>
              <Download aria-hidden />
              {t('portal.passes.download')}
            </a>
          </Button>
          {'share' in navigator ? (
            <Button onClick={() => void share()}>
              <Share2 aria-hidden />
              {t('portal.passes.share')}
            </Button>
          ) : (
            <Button onClick={onClose}>{t('common.done')}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
