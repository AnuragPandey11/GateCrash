import {
  useAmenities,
  useAvailability,
  useBookAmenity,
  useBookingsForDay,
  useCancelBooking,
  useMyBookings,
  useSaveAmenity,
  type Amenity,
  type Booking,
} from '@gatecrash/api';
import { formatDateTime, formatTime } from '@gatecrash/core';
import { CalendarCheck, Clock, Dumbbell, Loader2, Minus, Pencil, Plus, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/app-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { EmptyState, LoadingState } from '@/components/ui/states';
import { formatMinutes } from '@/features/visits/duration-picker';
import { cn } from '@/lib/cn';
import { toastError } from '@/lib/errors';
import { toast } from '@/lib/toast';

const hhmm = (time: string) => time.slice(0, 5);

function isoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The next `n` days as booking chips: "Today", "Tomorrow", then "Sat 16". */
function nextDays(n: number) {
  const today = new Date();
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
    return { iso: isoDate(d), date: d, offset: i };
  });
}

/**
 * Amenities. Residents book; the office manages.
 *
 * A booking confirms instantly when the slot has room — the office's power is to cancel with a
 * reason, which the resident is told. Slots are the amenity's own grid (e.g. hourly from 6 am), and
 * a resident may take a few consecutive slots up to the amenity's limit.
 */
export function AmenitiesRoute({ office = false }: { office?: boolean }) {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader
        eyebrow={t('pageEyebrow.amenities')}
        title={t('portal.amenities.title')}
        description={office ? t('portal.amenities.officeSubtitle') : t('portal.amenities.subtitle')}
      />
      {office ? <OfficeAmenities /> : <ResidentAmenities />}
    </>
  );
}

// ── Resident ─────────────────────────────────────────────────────────────────────────────────────

function ResidentAmenities() {
  const { t } = useTranslation();
  const amenities = useAmenities();
  const [selected, setSelected] = useState<Amenity | null>(null);

  if (amenities.isPending) return <LoadingState />;
  return (
    <div className="space-y-8">
      {(amenities.data ?? []).length === 0 ? (
        <Card>
          <EmptyState icon={Dumbbell} title={t('portal.amenities.none')} description={t('portal.amenities.noneHint')} />
        </Card>
      ) : (
        <div className="stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {(amenities.data ?? []).map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setSelected(a)}
              className={cn(
                'lift rounded-lg border bg-surface p-5 text-left shadow-soft',
                selected?.id === a.id ? 'border-accent ring-1 ring-accent/60' : 'border-border/80',
              )}
            >
              <p className="font-display text-xl text-text">{a.name}</p>
              {a.description ? <p className="mt-1 line-clamp-2 text-sm text-text-muted">{a.description}</p> : null}
              <p className="mt-3 flex items-center gap-1.5 text-xs text-text-muted">
                <Clock className="size-3.5" aria-hidden />
                {hhmm(a.openTime)} – {hhmm(a.closeTime)} · {t('portal.amenities.slotsOf', { length: formatMinutes(a.slotMinutes) })}
              </p>
            </button>
          ))}
        </div>
      )}

      {selected ? <BookingPanel amenity={selected} /> : null}
      <MyBookings />
    </div>
  );
}

function BookingPanel({ amenity }: { amenity: Amenity }) {
  const { t } = useTranslation();
  const days = useMemo(() => nextDays(14), []);
  const [date, setDate] = useState(days[0]!.iso);
  const availability = useAvailability(amenity.id, date);
  const book = useBookAmenity();
  const [start, setStart] = useState<number | null>(null);
  const [count, setCount] = useState(1);
  const [guests, setGuests] = useState(1);
  const [note, setNote] = useState('');

  const slots = availability.data?.slots ?? [];
  // Every slot in [start, start + count) must be free for the booking to be offered.
  const rangeFree = (from: number, n: number) =>
    from + n <= slots.length && slots.slice(from, from + n).every((s) => s.available);
  const maxCount = start === null ? 1 : Math.min(amenity.maxSlotsPerBooking, slots.length - start);

  const dayLabel = (offset: number, d: Date) =>
    offset === 0
      ? t('portal.amenities.today')
      : offset === 1
        ? t('portal.amenities.tomorrow')
        : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });

  return (
    <Card className="animate-enter">
      <CardHeader>
        <CardTitle>{t('portal.amenities.bookTitle', { name: amenity.name })}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
          {days.map(({ iso, date: d, offset }) => (
            <button
              key={iso}
              type="button"
              onClick={() => {
                setDate(iso);
                setStart(null);
                setCount(1);
              }}
              className={cn(
                'h-10 shrink-0 rounded-full border px-4 text-sm font-semibold transition-colors',
                iso === date ? 'border-primary bg-primary text-primary-fg' : 'border-border bg-surface text-text-muted hover:text-text',
              )}
            >
              {dayLabel(offset, d)}
            </button>
          ))}
        </div>

        {availability.isPending ? (
          <LoadingState />
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {slots.map((slot, index) => {
              const inSelection = start !== null && index >= start && index < start + count;
              return (
                <button
                  key={slot.startTime}
                  type="button"
                  disabled={!slot.available && !slot.mine}
                  onClick={() => {
                    if (!slot.available) return;
                    setStart(index);
                    setCount(1);
                  }}
                  className={cn(
                    'rounded-[10px] border px-2 py-2 text-center transition-all duration-150',
                    inSelection
                      ? 'border-primary bg-primary text-primary-fg shadow-soft'
                      : slot.mine
                        ? 'border-success/40 bg-success/10 text-success'
                        : slot.available
                          ? 'border-border bg-surface text-text hover:border-accent'
                          : 'cursor-not-allowed border-border/60 bg-surface-raised/60 text-text-muted/60 line-through',
                  )}
                >
                  <span className="block text-sm font-semibold">{hhmm(slot.startTime)}</span>
                  <span className="block text-[0.6875rem] opacity-80">
                    {slot.mine
                      ? t('portal.amenities.yours')
                      : slot.past
                        ? t('portal.amenities.past')
                        : t('portal.amenities.left', { count: Math.max(0, slot.capacity - slot.booked) })}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {start !== null && slots[start] ? (
          <div className="space-y-4 rounded-[12px] border border-border/80 bg-surface-raised/50 p-4 animate-pop-in">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-semibold text-text">
                {hhmm(slots[start]!.startTime)} – {hhmm(slots[Math.min(start + count, slots.length) - 1]!.endTime)}
              </p>
              <div className="flex items-center gap-2">
                <span className="text-xs text-text-muted">{t('portal.amenities.slots')}</span>
                <Button variant="secondary" size="icon" className="size-9" disabled={count <= 1} onClick={() => setCount(count - 1)} aria-label="-">
                  <Minus />
                </Button>
                <span className="w-6 text-center font-semibold tabular-nums">{count}</span>
                <Button
                  variant="secondary"
                  size="icon"
                  className="size-9"
                  disabled={count >= maxCount || !rangeFree(start, count + 1)}
                  onClick={() => setCount(count + 1)}
                  aria-label="+"
                >
                  <Plus />
                </Button>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
              <Field label={t('portal.amenities.guests')}>
                {(props) => (
                  <Input {...props} type="number" min={1} max={50} value={guests} onChange={(e) => setGuests(Math.max(1, Math.min(50, Number(e.target.value) || 1)))} />
                )}
              </Field>
              <Field label={t('portal.amenities.note')}>
                {(props) => <Input {...props} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />}
              </Field>
            </div>
            <Button
              size="lg"
              className="w-full"
              disabled={book.isPending || !rangeFree(start, count)}
              onClick={async () => {
                try {
                  await book.mutateAsync({
                    amenityId: amenity.id,
                    date,
                    startTime: hhmm(slots[start]!.startTime),
                    slots: count,
                    guests,
                    ...(note.trim() ? { note: note.trim() } : {}),
                  });
                  toast.success(t('portal.amenities.booked', { name: amenity.name }));
                  setStart(null);
                  setNote('');
                } catch (error) {
                  toastError(error, t);
                }
              }}
            >
              {book.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <CalendarCheck aria-hidden />}
              {t('portal.amenities.confirm')}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function MyBookings() {
  const { t } = useTranslation();
  const bookings = useMyBookings();
  const cancel = useCancelBooking();
  const now = Date.now();
  const upcoming = (bookings.data ?? []).filter((b) => b.status === 'CONFIRMED' && new Date(b.startsAt).getTime() > now);
  const past = (bookings.data ?? []).filter((b) => !upcoming.includes(b));

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-text-muted">{t('portal.amenities.myBookings')}</h2>
      {bookings.isPending ? <LoadingState /> : null}
      {bookings.data && bookings.data.length === 0 ? (
        <Card>
          <EmptyState icon={CalendarCheck} title={t('portal.amenities.noBookings')} />
        </Card>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2">
        {[...upcoming, ...past].map((b) => (
          <BookingCard
            key={b.id}
            booking={b}
            action={
              upcoming.includes(b) ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-danger"
                  disabled={cancel.isPending}
                  onClick={async () => {
                    try {
                      await cancel.mutateAsync({ id: b.id });
                      toast.success(t('portal.amenities.cancelled'));
                    } catch (error) {
                      toastError(error, t);
                    }
                  }}
                >
                  {t('portal.amenities.cancel')}
                </Button>
              ) : null
            }
          />
        ))}
      </div>
    </section>
  );
}

function BookingCard({ booking, action, showWho = false }: { booking: Booking; action?: React.ReactNode; showWho?: boolean }) {
  const { t } = useTranslation();
  const cancelled = booking.status === 'CANCELLED';
  return (
    <Card className={cn(cancelled && 'opacity-70')}>
      <CardContent className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="font-semibold text-text">{booking.amenityName}</p>
          <p className="text-sm text-text">
            {formatDateTime(booking.startsAt)} – {formatTime(booking.endsAt)}
          </p>
          <p className="flex items-center gap-1.5 text-xs text-text-muted">
            <Users className="size-3.5" aria-hidden />
            {t('portal.amenities.guestCount', { count: booking.guests })}
            {showWho ? ` · ${booking.bookedByName}${booking.unitCode ? ` (${booking.unitCode})` : ''}` : ''}
          </p>
          {booking.cancelReason ? (
            <p className="text-xs text-danger">{t('portal.amenities.cancelReason', { reason: booking.cancelReason })}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <Badge tone={cancelled ? 'muted' : 'success'}>{t(`portal.amenities.status.${booking.status}`)}</Badge>
          {action}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Office ───────────────────────────────────────────────────────────────────────────────────────

function OfficeAmenities() {
  const { t } = useTranslation();
  const amenities = useAmenities();
  const [editing, setEditing] = useState<Amenity | 'new' | null>(null);
  const [date, setDate] = useState(isoDate(new Date()));
  const day = useBookingsForDay(date);
  const cancel = useCancelBooking();
  const [cancelling, setCancelling] = useState<Booking | null>(null);
  const [reason, setReason] = useState('');

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-text-muted">{t('portal.amenities.list')}</h2>
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus aria-hidden />
            {t('portal.amenities.add')}
          </Button>
        </div>
        {amenities.isPending ? <LoadingState /> : null}
        {amenities.data && amenities.data.length === 0 ? (
          <Card>
            <EmptyState icon={Dumbbell} title={t('portal.amenities.officeNone')} action={<Button onClick={() => setEditing('new')}>{t('portal.amenities.add')}</Button>} />
          </Card>
        ) : null}
        <div className="stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {(amenities.data ?? []).map((a) => (
            <Card key={a.id} className={cn(!a.active && 'opacity-70')}>
              <CardContent className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-display text-lg text-text">{a.name}</p>
                  <Badge tone={a.active ? 'success' : 'muted'}>{a.active ? t('portal.amenities.open') : t('portal.amenities.off')}</Badge>
                </div>
                <p className="text-xs text-text-muted">
                  {hhmm(a.openTime)} – {hhmm(a.closeTime)} · {formatMinutes(a.slotMinutes)} · {t('portal.amenities.perSlot', { count: a.capacity })}
                </p>
                <Button variant="secondary" size="sm" onClick={() => setEditing(a)}>
                  <Pencil aria-hidden />
                  {t('common.edit')}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-text-muted">{t('portal.amenities.dayBookings')}</h2>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9 w-44" aria-label={t('portal.amenities.dayBookings')} />
        </div>
        {day.isPending ? <LoadingState /> : null}
        {day.data && day.data.length === 0 ? (
          <Card>
            <EmptyState icon={CalendarCheck} title={t('portal.amenities.noneThatDay')} />
          </Card>
        ) : null}
        <div className="grid gap-3 md:grid-cols-2">
          {(day.data ?? []).map((b) => (
            <BookingCard
              key={b.id}
              booking={b}
              showWho
              action={
                b.status === 'CONFIRMED' ? (
                  <Button variant="ghost" size="sm" className="text-danger" onClick={() => { setCancelling(b); setReason(''); }}>
                    {t('portal.amenities.cancel')}
                  </Button>
                ) : null
              }
            />
          ))}
        </div>
      </section>

      {editing ? <AmenityDialog amenity={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}

      <Dialog open={cancelling !== null} onOpenChange={(o) => !o && setCancelling(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('portal.amenities.cancelTitle')}</DialogTitle>
            <DialogDescription>{t('portal.amenities.cancelBody')}</DialogDescription>
          </DialogHeader>
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} aria-label={t('portal.amenities.reason')} placeholder={t('portal.amenities.reasonExample')} />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setCancelling(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              disabled={!reason.trim() || cancel.isPending}
              onClick={async () => {
                if (!cancelling) return;
                try {
                  await cancel.mutateAsync({ id: cancelling.id, reason: reason.trim() });
                  toast.success(t('portal.amenities.cancelled'));
                  setCancelling(null);
                } catch (error) {
                  toastError(error, t);
                }
              }}
            >
              {t('portal.amenities.cancelBooking')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AmenityDialog({ amenity, onClose }: { amenity: Amenity | null; onClose: () => void }) {
  const { t } = useTranslation();
  const save = useSaveAmenity();
  const [form, setForm] = useState({
    name: amenity?.name ?? '',
    description: amenity?.description ?? '',
    capacity: amenity?.capacity ?? 1,
    openTime: amenity ? hhmm(amenity.openTime) : '06:00',
    closeTime: amenity ? hhmm(amenity.closeTime) : '22:00',
    slotMinutes: amenity?.slotMinutes ?? 60,
    maxSlotsPerBooking: amenity?.maxSlotsPerBooking ?? 2,
    active: amenity?.active ?? true,
  });
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));
  const valid = form.name.trim() && form.closeTime > form.openTime && form.capacity >= 1 && form.slotMinutes >= 15;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{amenity ? t('portal.amenities.editTitle', { name: amenity.name }) : t('portal.amenities.add')}</DialogTitle>
          <DialogDescription>{t('portal.amenities.formBody')}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <Field label={t('portal.amenities.name')} required>
            {(props) => <Input {...props} value={form.name} maxLength={80} onChange={(e) => set('name', e.target.value)} placeholder={t('portal.amenities.nameExample')} />}
          </Field>
          <Field label={t('portal.amenities.description')}>
            {(props) => <Textarea {...props} rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} />}
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('portal.amenities.opens')} required>
              {(props) => <Input {...props} type="time" value={form.openTime} onChange={(e) => set('openTime', e.target.value)} />}
            </Field>
            <Field label={t('portal.amenities.closes')} required>
              {(props) => <Input {...props} type="time" value={form.closeTime} onChange={(e) => set('closeTime', e.target.value)} />}
            </Field>
            <Field label={t('portal.amenities.slotLength')} hint={t('portal.amenities.minutesHint')} required>
              {(props) => <Input {...props} type="number" min={15} max={480} step={15} value={form.slotMinutes} onChange={(e) => set('slotMinutes', Number(e.target.value))} />}
            </Field>
            <Field label={t('portal.amenities.capacity')} hint={t('portal.amenities.capacityHint')} required>
              {(props) => <Input {...props} type="number" min={1} max={500} value={form.capacity} onChange={(e) => set('capacity', Number(e.target.value))} />}
            </Field>
            <Field label={t('portal.amenities.maxSlots')} hint={t('portal.amenities.maxSlotsHint')} required>
              {(props) => <Input {...props} type="number" min={1} max={12} value={form.maxSlotsPerBooking} onChange={(e) => set('maxSlotsPerBooking', Number(e.target.value))} />}
            </Field>
          </div>
          <label className="flex cursor-pointer items-center gap-3 rounded-[12px] border border-border p-3">
            <Checkbox checked={form.active} onCheckedChange={(v) => set('active', v === true)} aria-label={t('portal.amenities.takingBookings')} />
            <span className="text-sm font-medium text-text">{t('portal.amenities.takingBookings')}</span>
          </label>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={!valid || save.isPending}
            onClick={async () => {
              try {
                await save.mutateAsync({
                  id: amenity?.id,
                  body: {
                    name: form.name.trim(),
                    ...(form.description.trim() ? { description: form.description.trim() } : {}),
                    capacity: form.capacity,
                    openTime: form.openTime,
                    closeTime: form.closeTime,
                    slotMinutes: form.slotMinutes,
                    maxSlotsPerBooking: form.maxSlotsPerBooking,
                    active: form.active,
                  },
                });
                toast.success(t('portal.amenities.saved'));
                onClose();
              } catch (error) {
                toastError(error, t);
              }
            }}
          >
            {save.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
