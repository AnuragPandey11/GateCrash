import { useStaffCheckIn, useStaffCheckOut, useStaffInside, useStaffLookup, type StaffMember } from '@gatecrash/api';
import { formatTime, type GateId } from '@gatecrash/core';
import { AlertTriangle, HardHat, Loader2, LogIn, LogOut, Search } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { EmptyState, LoadingState } from '@/components/ui/states';
import { toastError } from '@/lib/errors';
import { toast } from '@/lib/toast';
import { QrScanner } from './qr-scanner';

/**
 * Staff in / out at the gate: type the helper's 6-digit code or scan their ID card, see who it is
 * and which homes they work for, and mark them in or out. A deactivated person is shown in red and
 * cannot be marked in.
 */
export function StaffGateDialog({
  open,
  onOpenChange,
  gateId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  gateId: GateId;
}) {
  const { t } = useTranslation();
  const lookup = useStaffLookup();
  const checkIn = useStaffCheckIn();
  const checkOut = useStaffCheckOut();
  const [code, setCode] = useState('');
  const [member, setMember] = useState<StaffMember | null>(null);

  const reset = () => {
    setCode('');
    setMember(null);
    lookup.reset();
  };
  const find = async (by: { code: string } | { qrToken: string }) => {
    try {
      setMember(await lookup.mutateAsync(by));
    } catch (error) {
      toastError(error, t);
    }
  };
  const mark = async (direction: 'in' | 'out') => {
    if (!member) return;
    try {
      if (direction === 'in') await checkIn.mutateAsync({ id: member.id, gateId });
      else await checkOut.mutateAsync({ id: member.id, gateId });
      toast.success(t(direction === 'in' ? 'portal.staff.markedIn' : 'portal.staff.markedOut', { name: member.fullName }));
      reset();
    } catch (error) {
      toastError(error, t);
    }
  };
  const busy = checkIn.isPending || checkOut.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('portal.staff.gateButton')}</DialogTitle>
          <DialogDescription>{t('portal.staff.gateBody')}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {!member ? (
            <>
              <div className="flex gap-2">
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  className="h-14 text-center font-credential text-2xl"
                  placeholder="••••••"
                  aria-label={t('portal.staff.code')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && code.length === 6) void find({ code });
                  }}
                />
                <Button
                  size="lg"
                  className="h-14"
                  disabled={code.length !== 6 || lookup.isPending}
                  onClick={() => void find({ code })}
                >
                  {lookup.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Search aria-hidden />}
                  {t('portal.staff.find')}
                </Button>
              </div>
              <QrScanner onToken={(token) => void find({ qrToken: token })} />
            </>
          ) : (
            <Card>
              <CardContent className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-lg font-semibold text-text">{member.fullName}</p>
                    <p className="text-sm text-text-muted">
                      {t(`portal.staff.category.${member.category}`)} · {t(`portal.staff.scope.${member.scope}`)}
                    </p>
                  </div>
                  {member.insideNow && member.insideSince ? (
                    <Badge tone="success">{t('portal.staff.insideSince', { time: formatTime(member.insideSince) })}</Badge>
                  ) : null}
                </div>
                {member.householdUnits && member.householdUnits.length > 0 ? (
                  <p className="text-sm text-text">
                    {t('portal.staff.worksFor', { units: member.householdUnits.join(', ') })}
                  </p>
                ) : null}
                {member.phone ? <p className="text-xs text-text-muted">{member.phone}</p> : null}
                {!member.active ? (
                  <p className="flex items-center gap-2 rounded-[10px] border border-danger/40 bg-danger/10 px-3 py-2 text-sm font-semibold text-danger">
                    <AlertTriangle className="size-4 shrink-0" aria-hidden />
                    {t('portal.staff.doNotAdmit')}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          )}
        </DialogBody>
        {member ? (
          <DialogFooter>
            <Button variant="secondary" onClick={reset}>
              {t('portal.staff.next')}
            </Button>
            {member.insideNow ? (
              <Button size="lg" variant="secondary" disabled={busy} onClick={() => void mark('out')}>
                <LogOut aria-hidden />
                {t('portal.staff.markOut')}
              </Button>
            ) : (
              <Button size="lg" disabled={busy || !member.active} onClick={() => void mark('in')}>
                <LogIn aria-hidden />
                {t('portal.staff.markIn')}
              </Button>
            )}
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** Staff inside right now, with a one-tap mark-out. */
export function StaffInsideList({ gateId }: { gateId: GateId }) {
  const { t } = useTranslation();
  const inside = useStaffInside();
  const checkOut = useStaffCheckOut();
  if (inside.isPending) return <LoadingState />;
  if (!inside.data || inside.data.length === 0) {
    return (
      <Card>
        <EmptyState icon={HardHat} title={t('portal.staff.insideEmpty')} />
      </Card>
    );
  }
  return (
    <div className="stagger grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {inside.data.map((a) => (
        <Card key={a.id}>
          <CardContent className="space-y-3">
            <div>
              <p className="font-semibold text-text">{a.staffName}</p>
              <p className="text-xs text-text-muted">
                {t(`portal.staff.category.${a.category}`)} ·{' '}
                {t('portal.staff.since', { time: formatTime(a.checkedInAt), gate: a.gateName })}
              </p>
            </div>
            <Button
              variant="secondary"
              className="w-full"
              disabled={checkOut.isPending}
              onClick={async () => {
                try {
                  await checkOut.mutateAsync({ id: a.staffId, gateId });
                  toast.success(t('portal.staff.markedOut', { name: a.staffName }));
                } catch (error) {
                  toastError(error, t);
                }
              }}
            >
              <LogOut aria-hidden />
              {t('portal.staff.markOut')}
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
