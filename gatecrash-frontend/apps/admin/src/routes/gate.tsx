import {
  useCheckIn,
  useCheckOut,
  useCollectParcel,
  useCreateVisit,
  useGateFeed,
  useGates,
  useMovesToday,
  useOccupancy,
  usePropertyNodes,
  useSalesOnDuty,
  type VisitResponse,
} from '@gatecrash/api';
import {
  VISITOR_TYPES,
  formatDuration,
  formatTime,
  type GateId,
  type VisitorType,
} from '@gatecrash/core';
import {
  AlarmClock,
  DoorOpen,
  HardHat,
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  Package,
  QrCode,
  Truck,
  UserPlus,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/app-shell';
import { MeetSalesBadge, VisitStatusBadge, VisitorTypeBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { EmptyState, LoadingState } from '@/components/ui/states';
import { ScanPassDialog } from '@/features/gate/scan-pass-dialog';
import { StaffGateDialog, StaffInsideList } from '@/features/gate/staff-gate';
import { useNomenclature } from '@/features/property/use-nomenclature';
import { DurationPicker } from '@/features/visits/duration-picker';
import { cn } from '@/lib/cn';
import { toastError } from '@/lib/errors';
import { useGateStore } from '@/lib/gate';
import { toast } from '@/lib/toast';

type Tab = 'new' | 'gate' | 'inside' | 'staff' | 'moves';

/**
 * The guard's gate console.
 *
 * Built for a phone held in one hand at a gate: one column, big targets, the two ways in (scan a
 * pass, log a walk-in) at the top. On a tablet or desktop the walk-in form sits beside the live
 * lists. Everything below the form is driven by the gate's WebSocket topic, so a resident's tap
 * flips a card here within a second; the 60-second refetch is the fallback.
 */
export function GateRoute() {
  const { t } = useTranslation();
  const gates = useGates();
  const gateId = useGateStore((s) => s.gateId);
  const setGate = useGateStore((s) => s.setGate);
  const [scanning, setScanning] = useState(false);
  const [staffOpen, setStaffOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('new');
  // Bumped by the Walk-in button. The form is often already the open tab, so switching to it
  // alone changed nothing on screen; the bump tells the form to scroll into view and take focus.
  const [walkInRequest, setWalkInRequest] = useState(0);

  // A remembered gate that no longer exists (deleted, or another township's) is forgotten.
  useEffect(() => {
    if (gates.data && gateId && !gates.data.some((g) => g.id === gateId)) setGate(null);
  }, [gates.data, gateId, setGate]);

  const feed = useGateFeed(gateId, 200);
  const all = feed.data ?? [];
  const atGate = all.filter((v) => ['PENDING', 'APPROVED', 'LEFT_AT_GATE'].includes(v.status));
  // Everyone inside the township, whichever gate they came in by: a visitor may leave through
  // this gate after entering at another, and this guard must be able to check them out.
  const township = useOccupancy({ pollMs: 20_000 });
  const inside = [...(township.data?.visits ?? [])].sort(
    (a, b) => Number(b.overstaying) - Number(a.overstaying),
  );
  const overstaying = inside.filter((v) => v.overstaying).length;
  const moves = useMovesToday(Boolean(gateId));

  if (gates.isPending) return <LoadingState />;

  const gateName = gates.data?.find((g) => g.id === gateId)?.name;

  return (
    <>
      <PageHeader
        eyebrow={t('pageEyebrow.gate')}
        title={gateName ?? t('portal.gate.title')}
        description={t('portal.gate.subtitle')}
      />

      <Card className="mb-4">
        <CardContent className="space-y-4">
          <Field label={t('portal.gate.whichGate')}>
            {(props) => (
              <Select value={gateId ?? ''} onValueChange={(v) => setGate(v as GateId)}>
                <SelectTrigger {...props} className="h-12 text-base">
                  <SelectValue placeholder={t('portal.gate.pickGate')} />
                </SelectTrigger>
                <SelectContent>
                  {(gates.data ?? []).map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
          {gateId ? (
            <div className="grid grid-cols-2 gap-3">
              <Button size="lg" className="h-14 text-base" onClick={() => setScanning(true)}>
                <QrCode aria-hidden />
                {t('portal.gate.scanPass')}
              </Button>
              <Button
                size="lg"
                variant="secondary"
                className="h-14 text-base"
                onClick={() => {
                  setTab('new');
                  setWalkInRequest((n) => n + 1);
                }}
              >
                <UserPlus aria-hidden />
                {t('portal.gate.walkIn')}
              </Button>
              <Button
                size="lg"
                variant="secondary"
                className="col-span-2 h-12 text-base"
                onClick={() => setStaffOpen(true)}
              >
                <HardHat aria-hidden />
                {t('portal.staff.gateButton')}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {!gateId ? (
        <Card>
          <EmptyState icon={DoorOpen} title={t('portal.gate.pickGateFirst')} />
        </Card>
      ) : (
        <>
          <Segmented
            className="mb-4"
            label={t('portal.gate.title')}
            value={tab}
            onChange={setTab}
            options={[
              { value: 'new', label: t('portal.gate.tabNew') },
              { value: 'gate', label: `${t('portal.gate.tabGate')} · ${atGate.length}` },
              {
                value: 'inside',
                label: `${t('portal.gate.tabInside')} · ${inside.length}`,
                icon: overstaying > 0 ? <AlarmClock className="size-4 text-danger" /> : undefined,
              },
              { value: 'staff', label: t('portal.staff.tabStaff') },
              { value: 'moves', label: `${t('portal.gate.tabMoves')} · ${moves.data?.length ?? 0}` },
            ]}
          />

          {overstaying > 0 && tab !== 'inside' ? (
            <button
              type="button"
              onClick={() => setTab('inside')}
              className="mb-4 flex w-full items-center gap-3 rounded-[12px] border border-danger/40 bg-danger/10 p-3 text-left text-sm font-semibold text-danger animate-pop-in"
            >
              <AlarmClock className="size-5 shrink-0" aria-hidden />
              {t('portal.gate.overstayBanner', { count: overstaying })}
            </button>
          ) : null}

          {tab === 'new' ? (
            <WalkInForm gateId={gateId} focusRequest={walkInRequest} onLogged={() => setTab('gate')} />
          ) : null}
          {tab === 'gate' ? <VisitList visits={atGate} gateId={gateId} empty={t('portal.gate.emptyGate')} /> : null}
          {tab === 'inside' ? (
            <VisitList visits={inside} gateId={gateId} empty={t('portal.gate.emptyInside')} />
          ) : null}
          {tab === 'staff' ? <StaffInsideList gateId={gateId} /> : null}
          {tab === 'moves' ? <MovesToday /> : null}

          <ScanPassDialog open={scanning} onOpenChange={setScanning} gateId={gateId} />
          <StaffGateDialog open={staffOpen} onOpenChange={setStaffOpen} gateId={gateId} />
        </>
      )}
    </>
  );
}

// ── Walk-in ──────────────────────────────────────────────────────────────────────────────────────

/**
 * A walk-in, as the guard logs it. Required: who (name, type) and where (the unit, or a sales agent
 * when "Meet Sales Agent" is ticked). Optional at the gate: phone, vehicle, purpose, and how long
 * they will stay — the resident can set the duration when approving instead.
 */
function WalkInForm({
  gateId,
  focusRequest,
  onLogged,
}: {
  gateId: GateId;
  /** Changes each time the Walk-in button is pressed. */
  focusRequest: number;
  onLogged: () => void;
}) {
  const { t } = useTranslation();
  const cardRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [flash, setFlash] = useState(false);

  // Walk-in pressed: bring the form into view, put the cursor in the name box, and flash the card
  // so the guard sees where it is. Skipped on first render (0), so opening the console does not jump.
  useEffect(() => {
    if (focusRequest === 0) return undefined;
    cardRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    nameRef.current?.focus({ preventScroll: true });
    setFlash(true);
    const timer = window.setTimeout(() => setFlash(false), 2400);
    return () => window.clearTimeout(timer);
  }, [focusRequest]);
  const nom = useNomenclature();
  const units = usePropertyNodes({ depth: nom.unitLevel?.depth ?? null }, { enabled: nom.unitLevel != null });
  const agents = useSalesOnDuty();
  const create = useCreateVisit();

  const [type, setType] = useState<VisitorType>('GUEST');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [unitId, setUnitId] = useState('');
  const [meetSales, setMeetSales] = useState(false);
  const [agentId, setAgentId] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [purpose, setPurpose] = useState('');
  const [duration, setDuration] = useState<number | undefined>(undefined);
  const [unitSearch, setUnitSearch] = useState('');

  const grouped = useMemo(() => {
    const needle = unitSearch.trim().toLowerCase();
    const groups = new Map<string, { id: string; code: string }[]>();
    for (const unit of units.data ?? []) {
      const code = unit.code ?? unit.name;
      if (needle && !code.toLowerCase().includes(needle)) continue;
      const key = unit.containerName ?? '';
      groups.set(key, [...(groups.get(key) ?? []), { id: unit.id, code }]);
    }
    return groups;
  }, [units.data, unitSearch]);

  const phoneOk = !phone || /^\+?[0-9]{7,15}$/.test(phone.trim());
  const canSubmit =
    name.trim().length > 0 && phoneOk && (meetSales ? Boolean(agentId) : Boolean(unitId)) && !create.isPending;

  const submit = async () => {
    try {
      await create.mutateAsync({
        gateId,
        visitorType: type,
        visitorName: name.trim(),
        meetSalesAgent: meetSales,
        ...(phone.trim() ? { visitorPhone: phone.trim() } : {}),
        ...(vehicle.trim() ? { vehicleNo: vehicle.trim() } : {}),
        ...(purpose.trim() ? { purpose: purpose.trim() } : {}),
        ...(duration ? { expectedDurationMinutes: duration } : {}),
        ...(meetSales ? { salesAgentId: agentId } : { targetFlatId: unitId }),
      } as never);
      toast.success(t('portal.gate.logged', { name: name.trim() }));
      setName('');
      setPhone('');
      setVehicle('');
      setPurpose('');
      setDuration(undefined);
      setUnitId('');
      setMeetSales(false);
      setAgentId('');
      onLogged();
    } catch (error) {
      toastError(error, t);
    }
  };

  return (
    <Card ref={cardRef} className={cn('scroll-mt-20', flash && 'highlight-blink')}>
      <CardHeader>
        <CardTitle>{t('portal.gate.newVisitor')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) void submit();
          }}
        >
          <div className="space-y-1.5">
            <p className="text-[0.8125rem] font-semibold text-text">{t('portal.visitor.type')}</p>
            <Segmented
              label={t('portal.visitor.type')}
              value={type}
              onChange={setType}
              options={VISITOR_TYPES.map((v) => ({ value: v, label: t(`status.visitorType.${v}`) }))}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('portal.visitor.name')} required>
              {(props) => (
                <Input
                  {...props}
                  ref={nameRef}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-11"
                  autoComplete="off"
                />
              )}
            </Field>
            <Field
              label={t('portal.visitor.phone')}
              error={phoneOk ? undefined : t('portal.visitor.phoneInvalid')}
            >
              {(props) => (
                <Input
                  {...props}
                  type="tel"
                  inputMode="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="h-11"
                />
              )}
            </Field>
          </div>

          <label className="flex cursor-pointer items-center gap-3 rounded-[12px] border border-border p-3">
            <Checkbox
              checked={meetSales}
              onCheckedChange={(v) => setMeetSales(v === true)}
              aria-label={t('visits.meetSalesAgent')}
            />
            <span className="text-sm font-medium text-text">{t('visits.meetSalesAgent')}</span>
          </label>

          {meetSales ? (
            <Field label={t('portal.gate.salesAgent')} required>
              {(props) => (
                <Select value={agentId} onValueChange={setAgentId}>
                  <SelectTrigger {...props} className="h-11">
                    <SelectValue placeholder={t('portal.gate.pickAgent')} />
                  </SelectTrigger>
                  <SelectContent>
                    {(agents.data ?? []).length === 0 ? (
                      <div className="px-3 py-2 text-sm text-text-muted">{t('portal.gate.noAgents')}</div>
                    ) : (
                      (agents.data ?? []).map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.fullName}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              )}
            </Field>
          ) : (
            <Field label={nom.unitLevel?.singular ?? t('portal.visitor.unit')} required>
              {(props) => (
                <div className="space-y-2">
                  <Input
                    value={unitSearch}
                    onChange={(e) => setUnitSearch(e.target.value)}
                    placeholder={t('portal.gate.searchUnit')}
                    aria-label={t('common.search')}
                    className="h-11"
                  />
                  <Select value={unitId} onValueChange={setUnitId}>
                    <SelectTrigger {...props} className="h-11">
                      <SelectValue placeholder={t('portal.gate.pickUnit')} />
                    </SelectTrigger>
                    <SelectContent>
                      {[...grouped.entries()].map(([group, list]) => (
                        <SelectGroup key={group}>
                          <SelectLabel>{group}</SelectLabel>
                          {list.map((u) => (
                            <SelectItem key={u.id} value={u.id}>
                              {u.code}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </Field>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('portal.visitor.vehicle')}>
              {(props) => (
                <Input
                  {...props}
                  value={vehicle}
                  onChange={(e) => setVehicle(e.target.value.toUpperCase())}
                  className="h-11 uppercase"
                />
              )}
            </Field>
            <Field label={t('portal.visitor.purpose')}>
              {(props) => <Input {...props} value={purpose} onChange={(e) => setPurpose(e.target.value)} className="h-11" />}
            </Field>
          </div>

          <div className="space-y-1.5">
            <p className="text-[0.8125rem] font-semibold text-text">{t('portal.visitor.duration')}</p>
            <DurationPicker value={duration} onChange={setDuration} from={new Date()} />
          </div>

          <Button type="submit" size="lg" className="h-12 w-full text-base" disabled={!canSubmit}>
            {create.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <UserPlus aria-hidden />}
            {t('portal.gate.askResident')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// ── Lists ────────────────────────────────────────────────────────────────────────────────────────

function VisitList({ visits, gateId, empty }: { visits: VisitResponse[]; gateId: GateId; empty: string }) {
  const [collecting, setCollecting] = useState<VisitResponse | null>(null);
  if (visits.length === 0) {
    return (
      <Card>
        <EmptyState icon={DoorOpen} title={empty} />
      </Card>
    );
  }
  return (
    <>
      <div className="stagger grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {visits.map((visit) => (
          <GateVisitCard key={visit.id} visit={visit} gateId={gateId} onCollect={() => setCollecting(visit)} />
        ))}
      </div>
      {collecting ? <CollectDialog visit={collecting} onClose={() => setCollecting(null)} /> : null}
    </>
  );
}

function GateVisitCard({
  visit,
  gateId,
  onCollect,
}: {
  visit: VisitResponse;
  /** The gate this console is at. Check-out records it as the exit gate. */
  gateId: GateId;
  onCollect: () => void;
}) {
  const { t } = useTranslation();
  const checkIn = useCheckIn();
  const checkOut = useCheckOut(gateId);
  const enteredElsewhere = visit.gateId !== gateId;
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const run = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      toast.success(done);
    } catch (error) {
      toastError(error, t);
    }
  };

  return (
    <Card className={cn('lift', visit.overstaying && 'border-danger/60 ring-1 ring-danger/40')}>
      <CardContent className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-semibold text-text">{visit.visitorName}</p>
            <p className="text-xs text-text-muted">
              {visit.targetFlatNumber ?? visit.approverName ?? '—'}
              {visit.vehicleNo ? ` · ${visit.vehicleNo}` : ''}
            </p>
          </div>
          <VisitStatusBadge status={visit.status} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <VisitorTypeBadge type={visit.visitorType} />
          {visit.meetSalesAgent ? <MeetSalesBadge /> : null}
          {visit.autoApproved ? <Badge tone="info">{t('portal.rules.autoBadge')}</Badge> : null}
          {enteredElsewhere ? (
            <Badge tone="muted">{t('portal.gate.cameInAt', { gate: visit.gateName })}</Badge>
          ) : null}
          {visit.overstaying ? (
            <Badge tone="danger" icon={<AlarmClock className="size-3" aria-hidden />}>
              {t('portal.gate.overstaying')}
            </Badge>
          ) : null}
        </div>

        <p className="text-xs text-text-muted">
          {visit.status === 'CHECKED_IN'
            ? t('portal.gate.insideFor', {
                duration: formatDuration(visit.checkedInAt, now),
                out: visit.expectedOutAt ? formatTime(visit.expectedOutAt) : t('portal.gate.noOutTime'),
              })
            : t('portal.gate.loggedAt', { time: formatTime(visit.createdAt) })}
        </p>

        {visit.status === 'APPROVED' ? (
          <Button
            size="lg"
            className="w-full"
            disabled={checkIn.isPending}
            onClick={() => void run(() => checkIn.mutateAsync(visit.id), t('portal.gate.checkedIn'))}
          >
            <LogIn aria-hidden />
            {t('portal.gate.checkIn')}
          </Button>
        ) : null}
        {visit.status === 'CHECKED_IN' ? (
          <Button
            size="lg"
            variant={visit.overstaying ? 'danger' : 'secondary'}
            className="w-full"
            disabled={checkOut.isPending}
            onClick={() => void run(() => checkOut.mutateAsync(visit.id), t('portal.gate.checkedOut'))}
          >
            <LogOut aria-hidden />
            {t('portal.gate.checkOut')}
          </Button>
        ) : null}
        {visit.status === 'LEFT_AT_GATE' ? (
          <Button size="lg" variant="secondary" className="w-full" onClick={onCollect}>
            <Package aria-hidden />
            {t('portal.gate.handOver')}
          </Button>
        ) : null}
        {visit.status === 'PENDING' ? (
          <p className="flex items-center gap-2 text-sm text-pending">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {t('portal.gate.waiting')}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function CollectDialog({ visit, onClose }: { visit: VisitResponse; onClose: () => void }) {
  const { t } = useTranslation();
  const collect = useCollectParcel();
  const [code, setCode] = useState('');
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('portal.gate.handOverTitle')}</DialogTitle>
          <DialogDescription>
            {t('portal.gate.handOverBody', { name: visit.visitorName, unit: visit.targetFlatNumber ?? '—' })}
          </DialogDescription>
        </DialogHeader>
        <Field label={t('portal.gate.collectionCode')}>
          {(props) => (
            <Input
              {...props}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              className="h-14 text-center font-credential text-2xl"
              placeholder="••••••"
            />
          )}
        </Field>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={code.length !== 6 || collect.isPending}
            onClick={async () => {
              try {
                await collect.mutateAsync({ id: visit.id, code });
                toast.success(t('portal.gate.parcelHandedOver'));
                onClose();
              } catch (error) {
                toastError(error, t);
              }
            }}
          >
            <KeyRound aria-hidden />
            {t('portal.gate.verifyAndHandOver')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MovesToday() {
  const { t } = useTranslation();
  const moves = useMovesToday();
  if (moves.isPending) return <LoadingState />;
  if (!moves.data || moves.data.length === 0) {
    return (
      <Card>
        <EmptyState icon={Truck} title={t('portal.gate.noMoves')} />
      </Card>
    );
  }
  return (
    <div className="stagger grid gap-3 md:grid-cols-2">
      {moves.data.map((m) => (
        <Card key={m.id}>
          <CardContent className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold text-text">{m.unitCode}</p>
              <Badge tone={m.moveType === 'MOVE_IN' ? 'info' : 'warning'}>
                {t(`portal.moves.type.${m.moveType}`)}
              </Badge>
            </div>
            <p className="text-sm text-text">
              {m.timeFrom.slice(0, 5)} – {m.timeTo.slice(0, 5)}
            </p>
            <p className="text-xs text-text-muted">
              {m.requestedByName}
              {m.vehicleDetails ? ` · ${m.vehicleDetails}` : ''}
              {m.helpersCount ? ` · ${t('portal.moves.helpersCount', { count: m.helpersCount })}` : ''}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
