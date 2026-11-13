import {
  useAllRules,
  useCancelRule,
  useDecideRule,
  useMyRules,
  useRequestRule,
  useRevokeRule,
  type EntryRule,
} from '@gatecrash/api';
import { formatDateTime, type EntryRuleStatus, type Tone, type VisitorType } from '@gatecrash/core';
import { Check, Loader2, Plus, ShieldCheck, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/app-shell';
import { Pagination } from '@/components/pagination';
import { VisitorTypeBadge } from '@/components/status-badge';
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

const STATUS_TONE: Record<EntryRuleStatus, Tone> = {
  PENDING: 'pending',
  APPROVED: 'success',
  REJECTED: 'danger',
  CANCELLED: 'muted',
  REVOKED: 'muted',
};

const hhmm = (time: string) => time.slice(0, 5);

/**
 * Society rules: "let this kind of visitor into my home without asking me".
 *
 * A resident asks, the office approves or rejects, and while a rule is active the guard's walk-in
 * for that home is approved the moment it is logged — the household is told, not asked. Either
 * side can end an active rule.
 */
export function RulesRoute({ office = false }: { office?: boolean }) {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader
        eyebrow={t('pageEyebrow.rules')}
        title={office ? t('portal.rules.officeTitle') : t('portal.rules.title')}
        description={office ? t('portal.rules.officeSubtitle') : t('portal.rules.subtitle')}
      />
      {office ? <OfficeRules /> : <ResidentRules />}
    </>
  );
}

function RuleCard({ rule, office, actions }: { rule: EntryRule; office: boolean; actions?: React.ReactNode }) {
  const { t } = useTranslation();
  const details = [
    rule.matchText ? t('portal.rules.matches', { text: rule.matchText }) : null,
    rule.visitorPhone ? t('portal.rules.phoneMatch', { phone: rule.visitorPhone }) : null,
    !rule.matchText && !rule.visitorPhone ? t('portal.rules.anyOfType') : null,
    rule.allowedFrom && rule.allowedTo
      ? t('portal.rules.dailyWindow', { from: hhmm(rule.allowedFrom), to: hhmm(rule.allowedTo) })
      : null,
    rule.validUntil ? t('portal.rules.untilDate', { date: new Date(rule.validUntil).toLocaleDateString() }) : null,
  ].filter(Boolean);
  return (
    <Card className="lift">
      <CardContent className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold text-text">{rule.label}</p>
            {office ? (
              <p className="text-xs text-text-muted">
                {rule.unitCode} · {rule.requestedByName}
              </p>
            ) : null}
          </div>
          <Badge tone={STATUS_TONE[rule.status]}>{t(`portal.rules.status.${rule.status}`)}</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <VisitorTypeBadge type={rule.visitorType} />
        </div>
        <p className="text-sm text-text">{details.join(' · ')}</p>
        {rule.note ? <p className="text-xs text-text-muted">“{rule.note}”</p> : null}
        {rule.adminNote ? (
          <p className="rounded-[10px] bg-surface-raised px-3 py-2 text-xs text-text">
            {t('portal.rules.officeNote', { note: rule.adminNote })}
          </p>
        ) : null}
        {rule.decidedAt ? (
          <p className="text-[0.6875rem] text-text-muted">
            {t('portal.moves.decidedBy', { name: rule.decidedByName ?? '—', time: formatDateTime(rule.decidedAt) })}
          </p>
        ) : null}
        {actions}
      </CardContent>
    </Card>
  );
}

// ── Resident ─────────────────────────────────────────────────────────────────────────────────────

function ResidentRules() {
  const { t } = useTranslation();
  const rules = useMyRules();
  const cancel = useCancelRule();
  const [creating, setCreating] = useState(false);

  return (
    <>
      <Card className="mb-4">
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-3 text-sm text-text-muted">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
            {t('portal.rules.how')}
          </p>
          <Button className="shrink-0" onClick={() => setCreating(true)}>
            <Plus aria-hidden />
            {t('portal.rules.new')}
          </Button>
        </CardContent>
      </Card>
      {rules.isPending ? <LoadingState /> : null}
      {rules.data && rules.data.length === 0 ? (
        <Card>
          <EmptyState icon={ShieldCheck} title={t('portal.rules.empty')} description={t('portal.rules.emptyHint')} />
        </Card>
      ) : null}
      <div className="stagger grid gap-3 md:grid-cols-2">
        {(rules.data ?? []).map((rule) => (
          <RuleCard
            key={rule.id}
            rule={rule}
            office={false}
            actions={
              rule.status === 'PENDING' || rule.status === 'APPROVED' ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-danger"
                  disabled={cancel.isPending}
                  onClick={async () => {
                    try {
                      await cancel.mutateAsync(rule.id);
                      toast.success(t('portal.rules.withdrawn'));
                    } catch (error) {
                      toastError(error, t);
                    }
                  }}
                >
                  {t('portal.rules.withdraw')}
                </Button>
              ) : null
            }
          />
        ))}
      </div>
      {creating ? <NewRuleDialog onClose={() => setCreating(false)} /> : null}
    </>
  );
}

function NewRuleDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const request = useRequestRule();
  const [type, setType] = useState<VisitorType>('DELIVERY');
  const [label, setLabel] = useState('');
  const [match, setMatch] = useState('');
  const [phone, setPhone] = useState('');
  const [windowed, setWindowed] = useState(false);
  const [from, setFrom] = useState('09:00');
  const [to, setTo] = useState('18:00');
  const [until, setUntil] = useState('');
  const [note, setNote] = useState('');

  const needsMatch = type !== 'DELIVERY' && !match.trim() && !phone.trim();
  const valid = label.trim().length > 0 && !needsMatch && (!windowed || to > from) && (!match.trim() || match.trim().length >= 2);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('portal.rules.new')}</DialogTitle>
          <DialogDescription>{t('portal.rules.newBody')}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <Segmented
            label={t('portal.rules.new')}
            value={type}
            onChange={setType}
            options={(['DELIVERY', 'MAINTENANCE', 'GUEST'] as const).map((v) => ({
              value: v,
              label: t(`portal.rules.visitorType.${v}`),
            }))}
          />
          <Field label={t('portal.rules.label')} required>
            {(props) => (
              <Input {...props} value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} placeholder={t('portal.rules.labelExample')} />
            )}
          </Field>
          <Field
            label={t('portal.rules.matchText')}
            hint={type === 'DELIVERY' ? t('portal.rules.matchHintDelivery') : t('portal.rules.matchHint')}
            error={needsMatch && label.trim() ? t('portal.rules.needsMatch') : undefined}
          >
            {(props) => <Input {...props} value={match} maxLength={60} onChange={(e) => setMatch(e.target.value)} />}
          </Field>
          <Field label={t('portal.rules.phone')}>
            {(props) => (
              <Input {...props} type="tel" inputMode="tel" value={phone} maxLength={16} onChange={(e) => setPhone(e.target.value.replace(/[^\d+]/g, ''))} />
            )}
          </Field>
          <label className="flex cursor-pointer items-center gap-3">
            <Checkbox checked={windowed} onCheckedChange={(v) => setWindowed(v === true)} aria-label={t('portal.rules.window')} />
            <span className="text-sm font-semibold text-text">{t('portal.rules.window')}</span>
          </label>
          {windowed ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('portal.rules.from')}>
                {(props) => <Input {...props} type="time" value={from} onChange={(e) => setFrom(e.target.value)} />}
              </Field>
              <Field label={t('portal.rules.to')} error={to > from ? undefined : t('portal.rules.toAfterFrom')}>
                {(props) => <Input {...props} type="time" value={to} onChange={(e) => setTo(e.target.value)} />}
              </Field>
            </div>
          ) : null}
          <Field label={t('portal.rules.until')}>
            {(props) => <Input {...props} type="date" value={until} onChange={(e) => setUntil(e.target.value)} />}
          </Field>
          <Field label={t('portal.rules.note')}>
            {(props) => <Textarea {...props} rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />}
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
                  visitorType: type,
                  label: label.trim(),
                  ...(match.trim() ? { matchText: match.trim() } : {}),
                  ...(phone.trim() ? { visitorPhone: phone.trim() } : {}),
                  ...(windowed ? { allowedFrom: from, allowedTo: to } : {}),
                  ...(until ? { validUntil: new Date(`${until}T23:59:59`).toISOString() } : {}),
                  ...(note.trim() ? { note: note.trim() } : {}),
                });
                toast.success(t('portal.rules.requested'));
                onClose();
              } catch (error) {
                toastError(error, t);
              }
            }}
          >
            {request.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {t('portal.rules.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Office ───────────────────────────────────────────────────────────────────────────────────────

type OfficeAction = { rule: EntryRule; kind: 'APPROVED' | 'REJECTED' | 'REVOKE' };

function OfficeRules() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<EntryRuleStatus | 'ALL'>('PENDING');
  const [page, setPage] = useState({ page: 1, size: 25 });
  const rules = useAllRules(status === 'ALL' ? null : status, page);
  const decide = useDecideRule();
  const revoke = useRevokeRule();
  const [acting, setActing] = useState<OfficeAction | null>(null);
  const [note, setNote] = useState('');
  const busy = decide.isPending || revoke.isPending;

  const open = (rule: EntryRule, kind: OfficeAction['kind']) => {
    setActing({ rule, kind });
    setNote('');
  };

  return (
    <>
      <Segmented
        className="mb-4"
        label={t('portal.rules.officeTitle')}
        value={status}
        onChange={(v) => {
          setStatus(v);
          setPage((p) => ({ ...p, page: 1 }));
        }}
        options={[
          { value: 'PENDING', label: t('portal.rules.status.PENDING') },
          { value: 'APPROVED', label: t('portal.rules.status.APPROVED') },
          { value: 'REJECTED', label: t('portal.rules.status.REJECTED') },
          { value: 'ALL', label: t('common.all') },
        ]}
      />
      {rules.isPending ? <LoadingState /> : null}
      {rules.data && rules.data.content.length === 0 ? (
        <Card>
          <EmptyState icon={ShieldCheck} title={t('portal.rules.officeEmpty')} />
        </Card>
      ) : null}
      <div className="stagger grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {(rules.data?.content ?? []).map((rule) => (
          <RuleCard
            key={rule.id}
            rule={rule}
            office
            actions={
              rule.status === 'PENDING' ? (
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="secondary" onClick={() => open(rule, 'REJECTED')}>
                    <X aria-hidden />
                    {t('portal.rules.reject')}
                  </Button>
                  <Button onClick={() => open(rule, 'APPROVED')}>
                    <Check aria-hidden />
                    {t('portal.rules.approve')}
                  </Button>
                </div>
              ) : rule.status === 'APPROVED' ? (
                <Button variant="secondary" className="w-full text-danger" onClick={() => open(rule, 'REVOKE')}>
                  {t('portal.rules.revoke')}
                </Button>
              ) : null
            }
          />
        ))}
      </div>
      {rules.data ? (
        <Pagination page={rules.data} onPageChange={(p) => setPage((prev) => ({ ...prev, page: p }))} className="pt-2" />
      ) : null}

      <Dialog open={acting !== null} onOpenChange={(o) => !o && setActing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {acting?.kind === 'APPROVED'
                ? t('portal.rules.approveTitle')
                : acting?.kind === 'REJECTED'
                  ? t('portal.rules.rejectTitle')
                  : t('portal.rules.revokeTitle')}
            </DialogTitle>
            <DialogDescription>
              {acting?.kind === 'APPROVED'
                ? t('portal.rules.approveBody')
                : acting?.kind === 'REJECTED'
                  ? t('portal.rules.rejectBody')
                  : t('portal.rules.revokeBody')}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            rows={3}
            value={note}
            maxLength={300}
            onChange={(e) => setNote(e.target.value)}
            aria-label={t('portal.rules.noteLabel')}
            placeholder={t('portal.rules.noteLabel')}
          />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setActing(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant={acting?.kind === 'APPROVED' ? 'primary' : 'danger'}
              disabled={busy || (acting?.kind === 'REJECTED' && !note.trim())}
              onClick={async () => {
                if (!acting) return;
                try {
                  const trimmed = note.trim() || undefined;
                  if (acting.kind === 'REVOKE') {
                    await revoke.mutateAsync({ id: acting.rule.id, ...(trimmed ? { note: trimmed } : {}) });
                  } else {
                    await decide.mutateAsync({
                      id: acting.rule.id,
                      decision: acting.kind,
                      ...(trimmed ? { note: trimmed } : {}),
                    });
                  }
                  toast.success(t('portal.rules.decided'));
                  setActing(null);
                } catch (error) {
                  toastError(error, t);
                }
              }}
            >
              {acting?.kind === 'APPROVED'
                ? t('portal.rules.approve')
                : acting?.kind === 'REJECTED'
                  ? t('portal.rules.reject')
                  : t('portal.rules.revoke')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
