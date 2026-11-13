import { usePassLookup, useRedeemPass, type PassPreviewResponse } from '@gatecrash/api';
import { formatDateTime, type GateId } from '@gatecrash/core';
import { AlertTriangle, ArrowLeft, Loader2, LogIn, QrCode, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MeetSalesBadge, VisitorTypeBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
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
import { DurationPicker, formatMinutes } from '@/features/visits/duration-picker';
import { errorMessage, toastError } from '@/lib/errors';
import { toast } from '@/lib/toast';
import { QrScanner } from './qr-scanner';

type Credential = { qrToken: string } | { pin: string };

/**
 * The guard's pre-approved entry: scan the QR (or type the PIN), see the visitor's details exactly
 * as the resident entered them, correct anything that differs at the gate — the car they actually
 * came in, say — and let them in. Nothing is used up until the final button.
 */
export function ScanPassDialog({
  open,
  onOpenChange,
  gateId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  gateId: GateId;
}) {
  const { t } = useTranslation();
  const lookup = usePassLookup();
  const redeem = useRedeemPass();
  const [method, setMethod] = useState<'scan' | 'pin'>('scan');
  const [pin, setPin] = useState('');
  const [credential, setCredential] = useState<Credential | null>(null);
  const [preview, setPreview] = useState<PassPreviewResponse | null>(null);
  const [form, setForm] = useState({ visitorName: '', visitorPhone: '', vehicleNo: '', purpose: '' });
  const [duration, setDuration] = useState<number | undefined>(undefined);

  const reset = () => {
    setCredential(null);
    setPreview(null);
    setPin('');
    lookup.reset();
  };

  const find = async (c: Credential) => {
    setCredential(c);
    try {
      const result = await lookup.mutateAsync({ ...c, gateId });
      setPreview(result);
      setForm({
        visitorName: result.visitorName ?? '',
        visitorPhone: result.visitorPhone ?? '',
        vehicleNo: result.vehicleNo ?? '',
        purpose: result.purpose ?? '',
      });
      setDuration(result.passType === 'FREQUENT' ? (result.expectedDurationMinutes ?? undefined) : undefined);
    } catch (error) {
      setCredential(null);
      toastError(error, t);
    }
  };

  const admit = async () => {
    if (!credential || !preview) return;
    try {
      const result = await redeem.mutateAsync({
        ...credential,
        gateId,
        corrections: {
          visitorName: form.visitorName.trim() || undefined,
          visitorPhone: form.visitorPhone.trim() || undefined,
          vehicleNo: form.vehicleNo.trim() || undefined,
          purpose: form.purpose.trim() || undefined,
          expectedDurationMinutes: duration,
        },
      });
      toast.success(t('portal.scan.admitted', { name: result.visit.visitorName }));
      reset();
      onOpenChange(false);
    } catch (error) {
      toastError(error, t);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{preview ? t('portal.scan.confirmTitle') : t('portal.scan.title')}</DialogTitle>
          <DialogDescription>
            {preview ? t('portal.scan.confirmBody') : t('portal.scan.body')}
          </DialogDescription>
        </DialogHeader>

        {!preview ? (
          <DialogBody className="space-y-4">
            <Segmented
              label={t('portal.scan.title')}
              value={method}
              onChange={setMethod}
              options={[
                { value: 'scan', label: t('portal.scan.methodScan'), icon: <QrCode className="size-4" /> },
                { value: 'pin', label: t('portal.scan.methodPin') },
              ]}
            />
            {lookup.isPending ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-text-muted">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                {t('portal.scan.checking')}
              </div>
            ) : method === 'scan' ? (
              <QrScanner onToken={(qrToken) => void find({ qrToken })} />
            ) : (
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (/^[0-9]{4,10}$/.test(pin)) void find({ pin });
                }}
              >
                <Field label={t('portal.scan.pinLabel')}>
                  {(props) => (
                    <Input
                      {...props}
                      value={pin}
                      onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 10))}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      className="h-14 text-center font-credential text-2xl"
                      placeholder="••••••"
                    />
                  )}
                </Field>
                <Button type="submit" size="lg" className="w-full" disabled={pin.length < 4}>
                  {t('portal.scan.findPass')}
                </Button>
              </form>
            )}
          </DialogBody>
        ) : (
          <DialogBody className="space-y-4">
            {preview.redeemable ? (
              <div className="flex items-start gap-3 rounded-[12px] border border-success/30 bg-success/10 p-3 text-sm text-success">
                <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  {t('portal.scan.validFor', { host: preview.hostName, unit: preview.hostUnitCode ?? '—' })}
                </span>
              </div>
            ) : (
              <div className="flex items-start gap-3 rounded-[12px] border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>{problemText(preview.problem, t)}</span>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <VisitorTypeBadge type={preview.visitorType} />
              {preview.meetSalesAgent ? <MeetSalesBadge /> : null}
              <span className="text-xs text-text-muted">
                {preview.passType === 'FREQUENT'
                  ? t('portal.scan.frequentUntil', { date: formatDateTime(preview.validUntil) })
                  : t('portal.scan.oneTimeWindow', {
                      arrival: formatDateTime(preview.expectedArrivalAt ?? preview.validFrom),
                      out: formatDateTime(preview.validUntil),
                    })}
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('portal.visitor.name')} required>
                {(props) => (
                  <Input {...props} value={form.visitorName} onChange={(e) => setForm({ ...form, visitorName: e.target.value })} />
                )}
              </Field>
              <Field label={t('portal.visitor.phone')}>
                {(props) => (
                  <Input
                    {...props}
                    type="tel"
                    inputMode="tel"
                    value={form.visitorPhone}
                    onChange={(e) => setForm({ ...form, visitorPhone: e.target.value })}
                  />
                )}
              </Field>
              <Field label={t('portal.visitor.vehicle')}>
                {(props) => (
                  <Input
                    {...props}
                    value={form.vehicleNo}
                    onChange={(e) => setForm({ ...form, vehicleNo: e.target.value.toUpperCase() })}
                    className="uppercase"
                  />
                )}
              </Field>
              <Field label={t('portal.visitor.purpose')}>
                {(props) => (
                  <Input {...props} value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} />
                )}
              </Field>
            </div>

            {preview.passType === 'FREQUENT' ? (
              <div className="space-y-1.5">
                <p className="text-[0.8125rem] font-semibold text-text">{t('portal.visitor.duration')}</p>
                <DurationPicker value={duration} onChange={setDuration} from={new Date()} allowNone={false} />
              </div>
            ) : (
              <p className="text-xs text-text-muted">
                {t('portal.scan.outTimeFromPass', { time: formatDateTime(preview.validUntil) })}
                {preview.expectedDurationMinutes ? ` · ${formatMinutes(preview.expectedDurationMinutes)}` : ''}
              </p>
            )}
          </DialogBody>
        )}

        {preview ? (
          <DialogFooter>
            <Button variant="secondary" onClick={reset}>
              <ArrowLeft aria-hidden />
              {t('portal.scan.scanAnother')}
            </Button>
            <Button
              size="lg"
              disabled={!preview.redeemable || redeem.isPending || !form.visitorName.trim()}
              onClick={() => void admit()}
            >
              {redeem.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <LogIn aria-hidden />}
              {t('portal.scan.admit')}
            </Button>
          </DialogFooter>
        ) : null}
        {lookup.isError && !preview ? (
          <p className="text-sm text-danger">{errorMessage(lookup.error, t)}</p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function problemText(problem: string | null | undefined, t: (key: never) => string): string {
  const tt = t as unknown as (key: string) => string;
  switch (problem) {
    case 'NOT_YET_VALID':
      return tt('portal.scan.problem.NOT_YET_VALID');
    case 'EXPIRED':
      return tt('portal.scan.problem.EXPIRED');
    case 'USES_EXHAUSTED':
      return tt('portal.scan.problem.USES_EXHAUSTED');
    default:
      return tt('portal.scan.problem.INVALID');
  }
}
