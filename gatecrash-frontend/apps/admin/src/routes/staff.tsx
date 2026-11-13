import {
  useAllStaff,
  useCreateStaff,
  useLinkHelper,
  useMyHelpers,
  useRateHelper,
  useRegisterHelper,
  useReissueStaffCode,
  useSetStaffActive,
  useStaffDay,
  useStaffDirectory,
  useStaffHistory,
  useStaffInside,
  useUnlinkHelper,
  type Attendance,
  type StaffCreated,
  type StaffMember,
} from '@gatecrash/api';
import {
  HELP_CATEGORIES,
  SOCIETY_STAFF_CATEGORIES,
  formatDateTime,
  formatTime,
  type StaffCategory,
  type StaffScope,
} from '@gatecrash/core';
import { CalendarDays, HardHat, KeyRound, Loader2, Phone, Plus, QrCode, Star, UserCheck } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/app-shell';
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
import { Input, Textarea } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EmptyState, LoadingState } from '@/components/ui/states';
import { cn } from '@/lib/cn';
import { toastError } from '@/lib/errors';
import { toast } from '@/lib/toast';

/** What a staff ID-card QR carries. The gate scanner extracts the token from it. */
export const staffQrPayload = (token: string) => `gatecrash-staff:${token}`;

const todayIso = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/**
 * Daily help (residents) and Staff & daily help (the office).
 *
 * A resident registers a helper (the entry code and ID card are shown once, to hand over) or adds
 * one already working in the society by their code. The guard marks them in and out — that is the
 * attendance register, and the household is told when they arrive and leave. The office sees
 * everyone, adds society staff, deactivates people and reissues lost codes.
 */
export function StaffRoute({ office = false }: { office?: boolean }) {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader
        eyebrow={t('pageEyebrow.staff')}
        title={office ? t('portal.staff.officeTitle') : t('portal.staff.title')}
        description={office ? t('portal.staff.officeSubtitle') : t('portal.staff.subtitle')}
      />
      {office ? <OfficeStaff /> : <ResidentStaff />}
    </>
  );
}

// ── Shared pieces ────────────────────────────────────────────────────────────────────────────────

function Presence({ member }: { member: StaffMember }) {
  const { t } = useTranslation();
  if (member.insideNow && member.insideSince) {
    return <Badge tone="success">{t('portal.staff.insideSince', { time: formatTime(member.insideSince) })}</Badge>;
  }
  return (
    <span className="text-xs text-text-muted">
      {member.lastSeenAt
        ? t('portal.staff.lastSeen', { time: formatDateTime(member.lastSeenAt) })
        : t('portal.staff.neverSeen')}
    </span>
  );
}

function RatingLine({ member }: { member: StaffMember }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center gap-1 text-xs text-text-muted">
      <Star className="size-3.5 text-warning" aria-hidden />
      {member.averageRating != null
        ? t('portal.staff.rating', { rating: member.averageRating, count: member.ratingCount })
        : t('portal.staff.noRatings')}
    </span>
  );
}

function StaffHeading({ member }: { member: StaffMember }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="truncate font-semibold text-text">{member.fullName}</p>
        <p className="text-xs text-text-muted">
          {t(`portal.staff.category.${member.category}`)}
          {member.phone ? ` · ${member.phone}` : ''}
        </p>
      </div>
      {member.active ? <Presence member={member} /> : <Badge tone="danger">{t('portal.staff.inactive')}</Badge>}
    </div>
  );
}

function QrImage({ token }: { token: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    void QRCode.toDataURL(staffQrPayload(token), { width: 480, margin: 2, errorCorrectionLevel: 'M' }).then(setUrl);
  }, [token]);
  return url ? (
    <img src={url} alt="" className="mx-auto size-56 rounded-[12px] bg-white p-2" />
  ) : (
    <div className="mx-auto size-56 animate-pulse rounded-[12px] bg-surface-raised" />
  );
}

/** The ID card — and, right after issuing, the one-time entry code. */
function IdCardDialog({ member, code, onClose }: { member: StaffMember; code?: string; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{member.fullName}</DialogTitle>
          <DialogDescription>
            {t(`portal.staff.category.${member.category}`)} · {t(`portal.staff.scope.${member.scope}`)}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4 text-center">
          {member.qrToken ? <QrImage token={member.qrToken} /> : null}
          <p className="text-xs text-text-muted">{t('portal.staff.idCardBody')}</p>
          {code ? (
            <div className="rounded-[12px] border border-accent/40 bg-accent/5 p-3">
              <p className="text-xs font-semibold text-text">{t('portal.staff.codeOnce', { name: member.fullName })}</p>
              <p className="mt-1 font-credential text-3xl tracking-[0.3em] text-text">{code}</p>
            </div>
          ) : (
            <p className="text-xs text-text-muted">{t('portal.staff.codeLost')}</p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button onClick={onClose}>{t('common.done')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AttendanceRows({ rows, showName = false }: { rows: Attendance[]; showName?: boolean }) {
  const { t } = useTranslation();
  return (
    <ul className="divide-y divide-border">
      {rows.map((a) => (
        <li key={a.id} className="flex items-center justify-between gap-3 py-2 text-sm">
          <span className="min-w-0">
            {showName ? (
              <span className="block truncate font-semibold text-text">
                {a.staffName} · {t(`portal.staff.category.${a.category}`)}
              </span>
            ) : null}
            <span className="block text-text">
              {formatDateTime(a.checkedInAt)} → {a.checkedOutAt ? formatTime(a.checkedOutAt) : t('portal.staff.stillInside')}
            </span>
          </span>
          <span className="shrink-0 text-xs text-text-muted">{a.exitGateName ?? a.gateName}</span>
        </li>
      ))}
    </ul>
  );
}

function HistoryDialog({ member, onClose }: { member: StaffMember; onClose: () => void }) {
  const { t } = useTranslation();
  const history = useStaffHistory(member.id, 30);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('portal.staff.attendanceTitle', { name: member.fullName })}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          {history.isPending ? <LoadingState /> : null}
          {history.data && history.data.length === 0 ? (
            <p className="py-6 text-center text-sm text-text-muted">{t('portal.staff.attendanceEmpty')}</p>
          ) : null}
          {history.data ? <AttendanceRows rows={history.data} /> : null}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function CategorySelect({
  scope,
  value,
  onChange,
}: {
  scope: StaffScope;
  value: StaffCategory;
  onChange: (c: StaffCategory) => void;
}) {
  const { t } = useTranslation();
  const options = scope === 'DAILY_HELP' ? HELP_CATEGORIES : SOCIETY_STAFF_CATEGORIES;
  return (
    <Field label={t('portal.staff.work')} required>
      {(props) => (
        <Select value={value} onValueChange={(v) => onChange(v as StaffCategory)}>
          <SelectTrigger {...props}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((c) => (
              <SelectItem key={c} value={c}>
                {t(`portal.staff.category.${c}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </Field>
  );
}

/** Register (resident) or add (office). Resolves with the one-time code. */
function PersonDialog({
  office,
  onClose,
  onCreated,
}: {
  office: boolean;
  onClose: () => void;
  onCreated: (created: StaffCreated) => void;
}) {
  const { t } = useTranslation();
  const register = useRegisterHelper();
  const create = useCreateStaff();
  const [scope, setScope] = useState<StaffScope>(office ? 'SOCIETY_STAFF' : 'DAILY_HELP');
  const [category, setCategory] = useState<StaffCategory>(office ? 'HOUSEKEEPING' : 'MAID');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const phoneOk = /^\+?[0-9]{7,15}$/.test(phone);
  const valid = name.trim().length > 0 && (office ? !phone || phoneOk : phoneOk);
  const pending = register.isPending || create.isPending;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{office ? t('portal.staff.addStaff') : t('portal.staff.register')}</DialogTitle>
          <DialogDescription>{office ? t('portal.staff.addStaffBody') : t('portal.staff.registerBody')}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {office ? (
            <Segmented
              label={t('portal.staff.addStaff')}
              value={scope}
              onChange={(s) => {
                setScope(s);
                setCategory(s === 'DAILY_HELP' ? 'MAID' : 'HOUSEKEEPING');
              }}
              options={[
                { value: 'SOCIETY_STAFF', label: t('portal.staff.scope.SOCIETY_STAFF') },
                { value: 'DAILY_HELP', label: t('portal.staff.scope.DAILY_HELP') },
              ]}
            />
          ) : null}
          <CategorySelect scope={scope} value={category} onChange={setCategory} />
          <Field label={t('portal.staff.name')} required>
            {(props) => <Input {...props} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <Field label={t('portal.staff.phone')} required={!office}>
            {(props) => (
              <Input
                {...props}
                type="tel"
                inputMode="tel"
                value={phone}
                maxLength={16}
                onChange={(e) => setPhone(e.target.value.replace(/[^\d+]/g, ''))}
              />
            )}
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={!valid || pending}
            onClick={async () => {
              try {
                const created = office
                  ? await create.mutateAsync({ scope, category, fullName: name.trim(), ...(phone ? { phone } : {}) })
                  : await register.mutateAsync({ category, fullName: name.trim(), phone });
                onCreated(created);
              } catch (error) {
                toastError(error, t);
              }
            }}
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {office ? t('portal.staff.addStaff') : t('portal.staff.register')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Resident ─────────────────────────────────────────────────────────────────────────────────────

function ResidentStaff() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'mine' | 'directory'>('mine');
  const helpers = useMyHelpers();
  const directory = useStaffDirectory(tab === 'directory');
  const [dialog, setDialog] = useState<'code' | 'register' | null>(null);
  const [card, setCard] = useState<{ member: StaffMember; code?: string } | null>(null);
  const [history, setHistory] = useState<StaffMember | null>(null);
  const [rating, setRating] = useState<StaffMember | null>(null);
  const [removing, setRemoving] = useState<StaffMember | null>(null);
  const unlink = useUnlinkHelper();

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2">
        <Button onClick={() => setDialog('code')}>
          <KeyRound aria-hidden />
          {t('portal.staff.addByCode')}
        </Button>
        <Button variant="secondary" onClick={() => setDialog('register')}>
          <Plus aria-hidden />
          {t('portal.staff.register')}
        </Button>
      </div>
      <Segmented
        className="mb-4"
        label={t('portal.staff.title')}
        value={tab}
        onChange={setTab}
        options={[
          { value: 'mine', label: `${t('portal.staff.tabMine')} · ${helpers.data?.length ?? 0}` },
          { value: 'directory', label: t('portal.staff.tabDirectory') },
        ]}
      />

      {tab === 'mine' ? (
        <>
          {helpers.isPending ? <LoadingState /> : null}
          {helpers.data && helpers.data.length === 0 ? (
            <Card>
              <EmptyState icon={HardHat} title={t('portal.staff.empty')} description={t('portal.staff.emptyHint')} />
            </Card>
          ) : null}
          <div className="stagger grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {(helpers.data ?? []).map((member) => (
              <Card key={member.id} className={cn('lift', member.insideNow && 'border-success/50')}>
                <CardContent className="space-y-3">
                  <StaffHeading member={member} />
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <RatingLine member={member} />
                    <span className="text-xs text-text-muted">
                      {t('portal.staff.homes', { count: member.householdCount })}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <Button variant="secondary" size="sm" onClick={() => setHistory(member)}>
                      <CalendarDays aria-hidden />
                      {t('portal.staff.attendance')}
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => setRating(member)}>
                      <Star aria-hidden />
                      {t('portal.staff.rate')}
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => setCard({ member })}>
                      <QrCode aria-hidden />
                      {t('portal.staff.idCard')}
                    </Button>
                  </div>
                  <Button variant="ghost" size="sm" className="text-danger" onClick={() => setRemoving(member)}>
                    {t('portal.staff.remove')}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      ) : (
        <Directory people={directory.data} loading={directory.isPending} />
      )}

      {dialog === 'code' ? (
        <LinkDialog onClose={() => setDialog(null)} />
      ) : null}
      {dialog === 'register' ? (
        <PersonDialog
          office={false}
          onClose={() => setDialog(null)}
          onCreated={(created) => {
            setDialog(null);
            setCard({ member: created.staff, code: created.code });
          }}
        />
      ) : null}
      {card ? <IdCardDialog member={card.member} {...(card.code ? { code: card.code } : {})} onClose={() => setCard(null)} /> : null}
      {history ? <HistoryDialog member={history} onClose={() => setHistory(null)} /> : null}
      {rating ? <RateDialog member={rating} onClose={() => setRating(null)} /> : null}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t('portal.staff.removeTitle', { name: removing?.fullName ?? '' })}
        description={t('portal.staff.removeBody')}
        confirmLabel={t('portal.staff.remove')}
        destructive
        pending={unlink.isPending}
        onConfirm={async () => {
          if (!removing) return;
          try {
            await unlink.mutateAsync(removing.id);
            toast.success(t('portal.staff.removed'));
            setRemoving(null);
          } catch (error) {
            toastError(error, t);
          }
        }}
      />
    </>
  );
}

function Directory({ people, loading }: { people: StaffMember[] | undefined; loading: boolean }) {
  const { t } = useTranslation();
  if (loading) return <LoadingState />;
  if (!people || people.length === 0) {
    return (
      <Card>
        <EmptyState icon={HardHat} title={t('portal.staff.directoryEmpty')} />
      </Card>
    );
  }
  const groups: StaffScope[] = ['SOCIETY_STAFF', 'DAILY_HELP'];
  return (
    <div className="space-y-6">
      {groups.map((scope) => {
        const list = people.filter((p) => p.scope === scope);
        if (list.length === 0) return null;
        return (
          <section key={scope}>
            <h2 className="eyebrow mb-2">{t(`portal.staff.scope.${scope}`)}</h2>
            <div className="stagger grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {list.map((member) => (
                <Card key={member.id}>
                  <CardContent className="space-y-2">
                    <StaffHeading member={member} />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      {scope === 'DAILY_HELP' ? <RatingLine member={member} /> : <span />}
                      {member.phone ? (
                        <Button asChild variant="secondary" size="sm">
                          <a href={`tel:${member.phone}`}>
                            <Phone aria-hidden />
                            {member.phone}
                          </a>
                        </Button>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function LinkDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const link = useLinkHelper();
  const [code, setCode] = useState('');
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('portal.staff.addByCode')}</DialogTitle>
          <DialogDescription>{t('portal.staff.addByCodeBody')}</DialogDescription>
        </DialogHeader>
        <Field label={t('portal.staff.code')}>
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
            disabled={code.length !== 6 || link.isPending}
            onClick={async () => {
              try {
                const member = await link.mutateAsync(code);
                toast.success(t('portal.staff.added', { name: member.fullName }));
                onClose();
              } catch (error) {
                toastError(error, t);
              }
            }}
          >
            {link.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <UserCheck aria-hidden />}
            {t('portal.staff.add')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RateDialog({ member, onClose }: { member: StaffMember; onClose: () => void }) {
  const { t } = useTranslation();
  const rate = useRateHelper();
  const [stars, setStars] = useState(member.myRating ?? 0);
  const [review, setReview] = useState(member.myReview ?? '');
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('portal.staff.rateTitle', { name: member.fullName })}</DialogTitle>
        </DialogHeader>
        <div className="flex justify-center gap-2" role="radiogroup" aria-label={t('portal.staff.rate')}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={stars === n}
              aria-label={`${n}`}
              onClick={() => setStars(n)}
              className="rounded-full p-1 transition-transform hover:scale-110"
            >
              <Star className={cn('size-8', n <= stars ? 'fill-warning text-warning' : 'text-border')} aria-hidden />
            </button>
          ))}
        </div>
        <Field label={t('portal.staff.review')}>
          {(props) => <Textarea {...props} rows={3} maxLength={1000} value={review} onChange={(e) => setReview(e.target.value)} />}
        </Field>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={stars === 0 || rate.isPending}
            onClick={async () => {
              try {
                await rate.mutateAsync({ id: member.id, rating: stars, ...(review.trim() ? { review: review.trim() } : {}) });
                toast.success(t('portal.staff.rated'));
                onClose();
              } catch (error) {
                toastError(error, t);
              }
            }}
          >
            {t('portal.staff.rate')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Office ───────────────────────────────────────────────────────────────────────────────────────

function OfficeStaff() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'people' | 'inside' | 'day'>('people');
  const [scope, setScope] = useState<StaffScope | 'ALL'>('ALL');
  const [query, setQuery] = useState('');
  const [date, setDate] = useState(todayIso);
  const all = useAllStaff();
  const inside = useStaffInside();
  const day = useStaffDay(date);
  const setActive = useSetStaffActive();
  const reissue = useReissueStaffCode();
  const [adding, setAdding] = useState(false);
  const [card, setCard] = useState<{ member: StaffMember; code?: string } | null>(null);
  const [history, setHistory] = useState<StaffMember | null>(null);
  const [reissuing, setReissuing] = useState<StaffMember | null>(null);

  const people = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (all.data ?? []).filter(
      (p) =>
        (scope === 'ALL' || p.scope === scope) &&
        (!q ||
          p.fullName.toLowerCase().includes(q) ||
          (p.phone ?? '').includes(q) ||
          (p.householdUnits ?? []).some((u) => u.toLowerCase().includes(q))),
    );
  }, [all.data, scope, query]);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label={t('portal.staff.officeTitle')}
          value={tab}
          onChange={setTab}
          options={[
            { value: 'people', label: `${t('portal.staff.tabPeople')} · ${all.data?.length ?? 0}` },
            { value: 'inside', label: `${t('portal.staff.tabInside')} · ${inside.data?.length ?? 0}` },
            { value: 'day', label: t('portal.staff.tabAttendance') },
          ]}
        />
        <Button onClick={() => setAdding(true)}>
          <Plus aria-hidden />
          {t('portal.staff.addStaff')}
        </Button>
      </div>

      {tab === 'people' ? (
        <>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Segmented
              label={t('portal.staff.tabPeople')}
              value={scope}
              onChange={setScope}
              options={[
                { value: 'ALL', label: t('portal.staff.everyone') },
                { value: 'SOCIETY_STAFF', label: t('portal.staff.scope.SOCIETY_STAFF') },
                { value: 'DAILY_HELP', label: t('portal.staff.scope.DAILY_HELP') },
              ]}
            />
            <Input
              className="sm:max-w-xs"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('portal.staff.search')}
              aria-label={t('portal.staff.search')}
            />
          </div>
          {all.isPending ? <LoadingState /> : null}
          {all.data && people.length === 0 ? (
            <Card>
              <EmptyState icon={HardHat} title={t('portal.staff.directoryEmpty')} />
            </Card>
          ) : null}
          <div className="stagger grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {people.map((member) => (
              <Card key={member.id} className={cn('lift', !member.active && 'opacity-70')}>
                <CardContent className="space-y-3">
                  <StaffHeading member={member} />
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={member.scope === 'DAILY_HELP' ? 'info' : 'muted'}>
                      {t(`portal.staff.scope.${member.scope}`)}
                    </Badge>
                    {member.scope === 'DAILY_HELP' ? <RatingLine member={member} /> : null}
                  </div>
                  {member.householdUnits && member.householdUnits.length > 0 ? (
                    <p className="text-xs text-text-muted">
                      {t('portal.staff.homesList', { units: member.householdUnits.join(', ') })}
                    </p>
                  ) : null}
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Button variant="secondary" size="sm" onClick={() => setHistory(member)}>
                      <CalendarDays aria-hidden />
                      {t('portal.staff.attendance')}
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => setCard({ member })}>
                      <QrCode aria-hidden />
                      {t('portal.staff.idCard')}
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => setReissuing(member)}>
                      <KeyRound aria-hidden />
                      {t('portal.staff.reissue')}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      className={member.active ? 'text-danger' : ''}
                      disabled={setActive.isPending}
                      onClick={async () => {
                        try {
                          await setActive.mutateAsync({ id: member.id, active: !member.active });
                          toast.success(t('portal.staff.updated'));
                        } catch (error) {
                          toastError(error, t);
                        }
                      }}
                    >
                      {member.active ? t('portal.staff.deactivate') : t('portal.staff.activate')}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      ) : null}

      {tab === 'inside' ? (
        <Card>
          <CardContent>
            {inside.isPending ? <LoadingState /> : null}
            {inside.data && inside.data.length === 0 ? (
              <p className="py-6 text-center text-sm text-text-muted">{t('portal.staff.insideEmpty')}</p>
            ) : null}
            {inside.data ? <AttendanceRows rows={inside.data} showName /> : null}
          </CardContent>
        </Card>
      ) : null}

      {tab === 'day' ? (
        <Card>
          <CardContent className="space-y-3">
            <Input type="date" className="max-w-[12rem]" value={date} onChange={(e) => setDate(e.target.value || todayIso())} aria-label={t('portal.staff.tabAttendance')} />
            {day.isPending ? <LoadingState /> : null}
            {day.data && day.data.length === 0 ? (
              <p className="py-6 text-center text-sm text-text-muted">{t('portal.staff.dayEmpty')}</p>
            ) : null}
            {day.data ? <AttendanceRows rows={day.data} showName /> : null}
          </CardContent>
        </Card>
      ) : null}

      {adding ? (
        <PersonDialog
          office
          onClose={() => setAdding(false)}
          onCreated={(created) => {
            setAdding(false);
            toast.success(t('portal.staff.created'));
            setCard({ member: created.staff, code: created.code });
          }}
        />
      ) : null}
      {card ? <IdCardDialog member={card.member} {...(card.code ? { code: card.code } : {})} onClose={() => setCard(null)} /> : null}
      {history ? <HistoryDialog member={history} onClose={() => setHistory(null)} /> : null}
      <ConfirmDialog
        open={reissuing !== null}
        onOpenChange={(o) => !o && setReissuing(null)}
        title={t('portal.staff.reissueTitle', { name: reissuing?.fullName ?? '' })}
        description={t('portal.staff.reissueBody')}
        confirmLabel={t('portal.staff.reissue')}
        destructive
        pending={reissue.isPending}
        onConfirm={async () => {
          if (!reissuing) return;
          try {
            const created = await reissue.mutateAsync(reissuing.id);
            setReissuing(null);
            setCard({ member: created.staff, code: created.code });
          } catch (error) {
            toastError(error, t);
          }
        }}
      />
    </>
  );
}
