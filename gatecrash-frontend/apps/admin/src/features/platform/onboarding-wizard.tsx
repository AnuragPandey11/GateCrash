import { useCreateTownship, usePlatformPropertyTypes, type PropertyTypeOption } from '@gatecrash/api';
import type { PropertyCategory, PropertyNodeKind, PropertyType } from '@gatecrash/core';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BedDouble,
  Briefcase,
  Building,
  Building2,
  Check,
  ChevronRight,
  ConciergeBell,
  Cpu,
  Factory,
  GraduationCap,
  HeartHandshake,
  House,
  LandPlot,
  Layers,
  Loader2,
  Map as MapIcon,
  PencilRuler,
  Plus,
  Rows3,
  School,
  Search,
  Shapes,
  ShoppingBag,
  Store,
  Trash2,
  Trees,
  type LucideIcon,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import { LoadingState } from '@/components/ui/states';
import { levelShapeError, type LevelDraft } from '@/features/property/project-type-picker';
import { cn } from '@/lib/cn';
import { toastError } from '@/lib/errors';

/**
 * Onboarding a township — the super admin's most consequential form, as a five-step wizard.
 *
 *  1. **What are they building?** — twenty presets as cards, by category, searchable; or "build
 *     your own" for anything else.
 *  2. **Structure** — the levels that preset seeds, in plain words, with names editable and the
 *     shape adjustable. This is the one cheap moment to get it right: once the tree holds units the
 *     level set cannot be reshaped (`409 PROPERTY_TREE_NOT_EMPTY`).
 *  3. **Township details** — name, sign-in code (suggested from the name), office contacts.
 *  4. **First administrator** — the society head who will run it.
 *  5. **Review** — everything at once, then one request: township and admin are created together.
 *
 * Each step validates with the server's own rules, so "Create" never bounces with a 422 at the end.
 */

type Step = 'type' | 'structure' | 'details' | 'admin' | 'review';
const STEPS: Step[] = ['type', 'structure', 'details', 'admin', 'review'];

/** "Build your own" is recorded as mixed use: the type is reporting only, the levels are what count. */
const CUSTOM = 'CUSTOM' as const;
type Choice = PropertyType | typeof CUSTOM;

const TYPE_ICONS: Record<PropertyType, LucideIcon> = {
  APARTMENT: Building2,
  HOUSING_SOCIETY: Building,
  RESIDENTIAL_COLONY: House,
  BUILDER_FLOOR: Layers,
  VILLA: Trees,
  ROW_HOUSE: Rows3,
  PLOTTED: LandPlot,
  GATED_TOWNSHIP: MapIcon,
  CO_LIVING: BedDouble,
  STUDENT_HOUSING: GraduationCap,
  SENIOR_LIVING: HeartHandshake,
  SERVICED_APARTMENT: ConciergeBell,
  FARMHOUSE: Trees,
  COMMERCIAL: Briefcase,
  IT_PARK: Cpu,
  RETAIL: ShoppingBag,
  INDUSTRIAL: Factory,
  MARKET: Store,
  INSTITUTIONAL_CAMPUS: School,
  MIXED_USE: Shapes,
};

const KINDS: PropertyNodeKind[] = ['GROUP', 'BUILDING', 'FLOOR', 'UNIT'];

/** The sample identifier each kind gets in the example address under the structure. */
const SAMPLE: Record<PropertyNodeKind, string> = { GROUP: '1', BUILDING: 'A', FLOOR: '3', UNIT: 'A-301' };

const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{1,31}$/;
const LOGIN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/;
const PHONE_PATTERN = /^\+?[0-9]{7,15}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** "Green Meadows Phase 2" -> "GREEN-MEADOWS-2": readable, short enough to type at every sign-in. */
export function suggestCode(name: string): string {
  const words = name
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !['THE', 'OF', 'AND', 'PHASE', 'TOWNSHIP', 'SOCIETY', 'CHS', 'LTD'].includes(w));
  return words.join('-').slice(0, 24).replace(/-+$/, '');
}

export function OnboardingWizard({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (c: { loginId: string; password: string; fullName: string; townshipCode: string }) => void;
}) {
  const { t } = useTranslation();
  const types = usePlatformPropertyTypes();
  const create = useCreateTownship();

  const [step, setStep] = useState<Step>('type');
  const [choice, setChoice] = useState<Choice | null>(null);
  const [levels, setLevels] = useState<LevelDraft[]>([]);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [codeTouched, setCodeTouched] = useState(false);
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminLogin, setAdminLogin] = useState('admin');
  const [adminPhone, setAdminPhone] = useState('');
  const [adminEmail, setAdminEmail] = useState('');

  const option = types.data?.find((o) => o.value === choice) ?? null;
  const effectiveCode = codeTouched ? code : suggestCode(name);

  const pick = (next: Choice) => {
    setChoice(next);
    const preset = types.data?.find((o) => o.value === next);
    setLevels(
      preset
        ? preset.defaultLevels.map((l) => ({ ...l }))
        : [
            { kind: 'BUILDING', singular: 'Building', plural: 'Buildings' },
            { kind: 'UNIT', singular: 'Unit', plural: 'Units' },
          ],
    );
  };

  // The levels are sent only when they differ from the preset, so an untouched preset is seeded
  // by the server from its own definition and the two can never drift apart.
  const customised =
    choice === CUSTOM ||
    !option ||
    JSON.stringify(levels.map((l) => [l.kind, l.singular.trim(), l.plural.trim()])) !==
      JSON.stringify(option.defaultLevels.map((l) => [l.kind, l.singular, l.plural]));

  const shapeError = levelShapeError(levels);
  const detailsError =
    !name.trim() ? 'name'
    : !CODE_PATTERN.test(effectiveCode) ? 'code'
    : contactPhone && !PHONE_PATTERN.test(contactPhone) ? 'phone'
    : contactEmail && !EMAIL_PATTERN.test(contactEmail) ? 'email'
    : null;
  const adminError =
    !adminName.trim() ? 'name'
    : !LOGIN_PATTERN.test(adminLogin.trim()) ? 'login'
    : adminPhone && !PHONE_PATTERN.test(adminPhone) ? 'phone'
    : adminEmail && !EMAIL_PATTERN.test(adminEmail) ? 'email'
    : null;

  const canContinue: Record<Step, boolean> = {
    type: choice !== null,
    structure: shapeError === null,
    details: detailsError === null,
    admin: adminError === null,
    review: true,
  };
  const index = STEPS.indexOf(step);

  const submit = () => {
    create.mutate(
      {
        code: effectiveCode.toUpperCase(),
        name: name.trim(),
        ...(contactPhone.trim() ? { contactPhone: contactPhone.trim() } : {}),
        ...(contactEmail.trim() ? { contactEmail: contactEmail.trim() } : {}),
        propertyType: choice === CUSTOM || !choice ? 'MIXED_USE' : choice,
        ...(customised
          ? { levels: levels.map((l) => ({ kind: l.kind, singular: l.singular.trim(), plural: l.plural.trim() })) }
          : {}),
        admin: {
          loginId: adminLogin.trim(),
          fullName: adminName.trim(),
          ...(adminPhone.trim() ? { phone: adminPhone.trim() } : {}),
          ...(adminEmail.trim() ? { email: adminEmail.trim() } : {}),
        },
      },
      {
        onSuccess: (result) =>
          onCreated({
            loginId: result.admin.loginId,
            password: result.admin.generatedPassword,
            fullName: result.admin.fullName,
            townshipCode: result.township.code,
          }),
        onError: (error) => toastError(error, t),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !create.isPending && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('onboarding.title')}</DialogTitle>
          <DialogDescription>{t(`onboarding.stepHint.${step}`)}</DialogDescription>
        </DialogHeader>

        <Stepper current={index} onJump={(i) => i < index && setStep(STEPS[i]!)} />

        <DialogBody className="min-h-[18rem]">
          {types.isPending ? <LoadingState /> : null}
          {step === 'type' && types.data ? <TypeStep options={types.data} value={choice} onPick={pick} /> : null}
          {step === 'structure' ? (
            <StructureStep levels={levels} onChange={setLevels} error={shapeError} option={option} custom={choice === CUSTOM} />
          ) : null}
          {step === 'details' ? (
            <div key="details" className="grid gap-4 animate-enter sm:grid-cols-2">
              <Field label={t('onboarding.details.name')} required className="sm:col-span-2">
                {(props) => (
                  <Input {...props} value={name} autoFocus maxLength={160} onChange={(e) => setName(e.target.value)} placeholder={t('onboarding.details.nameExample')} />
                )}
              </Field>
              <Field
                label={t('onboarding.details.code')}
                hint={t('onboarding.details.codeHint')}
                error={effectiveCode && !CODE_PATTERN.test(effectiveCode) ? t('onboarding.details.codeInvalid') : undefined}
                required
                className="sm:col-span-2"
              >
                {(props) => (
                  <Input
                    {...props}
                    value={effectiveCode}
                    maxLength={32}
                    spellCheck={false}
                    onChange={(e) => {
                      setCodeTouched(true);
                      setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''));
                    }}
                    className="font-credential uppercase tracking-[0.12em]"
                  />
                )}
              </Field>
              <Field label={t('onboarding.details.phone')} error={contactPhone && !PHONE_PATTERN.test(contactPhone) ? t('portal.visitor.phoneInvalid') : undefined}>
                {(props) => <Input {...props} type="tel" inputMode="tel" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />}
              </Field>
              <Field label={t('onboarding.details.email')} error={contactEmail && !EMAIL_PATTERN.test(contactEmail) ? t('onboarding.emailInvalid') : undefined}>
                {(props) => <Input {...props} type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />}
              </Field>
            </div>
          ) : null}
          {step === 'admin' ? (
            <div key="admin" className="grid gap-4 animate-enter sm:grid-cols-2">
              <p className="text-sm text-text-muted sm:col-span-2">{t('onboarding.admin.intro')}</p>
              <Field label={t('onboarding.admin.name')} required>
                {(props) => <Input {...props} value={adminName} autoFocus maxLength={120} onChange={(e) => setAdminName(e.target.value)} />}
              </Field>
              <Field
                label={t('onboarding.admin.login')}
                hint={t('onboarding.admin.loginHint', { code: effectiveCode })}
                error={adminLogin && !LOGIN_PATTERN.test(adminLogin.trim()) ? t('users.form.loginIdHint') : undefined}
                required
              >
                {(props) => <Input {...props} value={adminLogin} spellCheck={false} autoCapitalize="none" onChange={(e) => setAdminLogin(e.target.value)} />}
              </Field>
              <Field label={t('onboarding.admin.phone')} error={adminPhone && !PHONE_PATTERN.test(adminPhone) ? t('portal.visitor.phoneInvalid') : undefined}>
                {(props) => <Input {...props} type="tel" inputMode="tel" value={adminPhone} onChange={(e) => setAdminPhone(e.target.value)} />}
              </Field>
              <Field label={t('onboarding.admin.email')} error={adminEmail && !EMAIL_PATTERN.test(adminEmail) ? t('onboarding.emailInvalid') : undefined}>
                {(props) => <Input {...props} type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} />}
              </Field>
            </div>
          ) : null}
          {step === 'review' ? (
            <div key="review" className="space-y-3 animate-enter">
              <ReviewRow label={t('onboarding.review.project')} onEdit={() => setStep('type')}>
                {choice === CUSTOM ? t('onboarding.type.customTitle') : option?.label}
              </ReviewRow>
              <ReviewRow label={t('onboarding.review.structure')} onEdit={() => setStep('structure')}>
                <LevelChain levels={levels} />
              </ReviewRow>
              <ReviewRow label={t('onboarding.review.township')} onEdit={() => setStep('details')}>
                <span className="font-semibold">{name.trim()}</span>
                <span className="ml-2 rounded-md bg-surface-raised px-2 py-0.5 font-credential text-xs">{effectiveCode}</span>
                {contactPhone || contactEmail ? (
                  <span className="block text-xs text-text-muted">{[contactPhone, contactEmail].filter(Boolean).join(' · ')}</span>
                ) : null}
              </ReviewRow>
              <ReviewRow label={t('onboarding.review.admin')} onEdit={() => setStep('admin')}>
                <span className="font-semibold">{adminName.trim()}</span>
                <span className="block text-xs text-text-muted">
                  {t('onboarding.review.signsInAs', { code: effectiveCode, login: adminLogin.trim() })}
                </span>
              </ReviewRow>
              <p className="rounded-[12px] border border-accent/30 bg-accent-soft px-4 py-3 text-sm text-text">
                {t('onboarding.review.passwordNote')}
              </p>
            </div>
          ) : null}
        </DialogBody>

        <DialogFooter className="sm:justify-between">
          <Button
            variant="secondary"
            disabled={create.isPending}
            onClick={() => (index === 0 ? onClose() : setStep(STEPS[index - 1]!))}
          >
            {index === 0 ? t('common.cancel') : (
              <>
                <ArrowLeft aria-hidden />
                {t('onboarding.back')}
              </>
            )}
          </Button>
          {step === 'review' ? (
            <Button size="lg" disabled={create.isPending} onClick={submit}>
              {create.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
              {create.isPending ? t('townships.form.submitting') : t('onboarding.create')}
            </Button>
          ) : (
            <Button size="lg" disabled={!canContinue[step]} onClick={() => setStep(STEPS[index + 1]!)}>
              {t('onboarding.next')}
              <ArrowRight aria-hidden />
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Stepper ──────────────────────────────────────────────────────────────────────────────────────

function Stepper({ current, onJump }: { current: number; onJump: (index: number) => void }) {
  const { t } = useTranslation();
  return (
    <ol className="flex items-center gap-1.5" aria-label={t('onboarding.progress')}>
      {STEPS.map((step, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={step} className="flex min-w-0 flex-1 items-center gap-1.5">
            <button
              type="button"
              disabled={!done}
              onClick={() => onJump(i)}
              aria-current={active ? 'step' : undefined}
              className={cn(
                'flex min-w-0 items-center gap-2 rounded-full text-xs font-semibold transition-colors',
                done ? 'cursor-pointer text-text hover:text-accent' : active ? 'text-text' : 'text-text-muted',
              )}
            >
              <span
                className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-full border text-xs transition-all duration-300',
                  done && 'border-primary bg-primary text-primary-fg',
                  active && 'border-accent bg-accent-soft text-accent ring-4 ring-accent/15',
                  !done && !active && 'border-border text-text-muted',
                )}
              >
                {done ? <Check className="size-3.5" aria-hidden /> : i + 1}
              </span>
              <span className={cn('truncate', !active && 'hidden lg:inline')}>{t(`onboarding.steps.${step}`)}</span>
            </button>
            {i < STEPS.length - 1 ? (
              <span className={cn('h-px min-w-3 flex-1 transition-colors', done ? 'bg-primary' : 'bg-border')} aria-hidden />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

// ── Step 1: project type ─────────────────────────────────────────────────────────────────────────

function TypeStep({
  options,
  value,
  onPick,
}: {
  options: PropertyTypeOption[];
  value: Choice | null;
  onPick: (choice: Choice) => void;
}) {
  const { t } = useTranslation();
  const [category, setCategory] = useState<PropertyCategory | 'ALL'>('ALL');
  const [query, setQuery] = useState('');

  const categories = useMemo(() => {
    const seen = new Map<PropertyCategory, string>();
    for (const o of options) seen.set(o.category, o.categoryLabel);
    return [...seen.entries()];
  }, [options]);

  const needle = query.trim().toLowerCase();
  const shown = options.filter(
    (o) =>
      (category === 'ALL' || o.category === category) &&
      (!needle ||
        o.label.toLowerCase().includes(needle) ||
        o.description.toLowerCase().includes(needle) ||
        o.defaultLevels.some((l) => l.singular.toLowerCase().includes(needle))),
  );

  return (
    <div key="type" className="space-y-4 animate-enter">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Segmented
          size="sm"
          label={t('onboarding.type.category')}
          value={category}
          onChange={setCategory}
          options={[
            { value: 'ALL', label: t('common.all') },
            ...categories.map(([value, label]) => ({ value, label })),
          ]}
        />
        <div className="relative sm:w-56">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" aria-hidden />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('onboarding.type.search')}
            aria-label={t('onboarding.type.search')}
            className="h-9 pl-9"
          />
        </div>
      </div>

      <div className="grid gap-2.5 sm:grid-cols-2">
        {shown.map((o) => {
          const Icon = TYPE_ICONS[o.value] ?? Building2;
          const selected = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onPick(o.value)}
              aria-pressed={selected}
              className={cn(
                'group flex items-start gap-3 rounded-[14px] border p-3.5 text-left transition-all duration-200',
                selected
                  ? 'border-accent bg-accent-soft shadow-soft ring-1 ring-accent/60'
                  : 'border-border bg-surface hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-soft',
              )}
            >
              <span
                className={cn(
                  'flex size-10 shrink-0 items-center justify-center rounded-[10px] border transition-colors',
                  selected ? 'border-accent/40 bg-surface text-accent' : 'border-border bg-surface-raised text-text-muted group-hover:text-accent',
                )}
              >
                <Icon className="size-5" aria-hidden />
              </span>
              <span className="min-w-0 space-y-1">
                <span className="block text-sm font-semibold text-text">{o.label}</span>
                <span className="block text-xs leading-relaxed text-text-muted">{o.description}</span>
                <LevelChain levels={o.defaultLevels} compact />
              </span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => onPick(CUSTOM)}
          aria-pressed={value === CUSTOM}
          className={cn(
            'flex items-start gap-3 rounded-[14px] border border-dashed p-3.5 text-left transition-all duration-200',
            value === CUSTOM ? 'border-accent bg-accent-soft ring-1 ring-accent/60' : 'border-border hover:border-accent/50',
          )}
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] border border-border bg-surface-raised text-accent">
            <PencilRuler className="size-5" aria-hidden />
          </span>
          <span className="min-w-0 space-y-1">
            <span className="block text-sm font-semibold text-text">{t('onboarding.type.customTitle')}</span>
            <span className="block text-xs leading-relaxed text-text-muted">{t('onboarding.type.customBody')}</span>
          </span>
        </button>
      </div>
      {shown.length === 0 ? <p className="text-sm text-text-muted">{t('onboarding.type.noMatch')}</p> : null}
    </div>
  );
}

// ── Step 2: structure ────────────────────────────────────────────────────────────────────────────

function StructureStep({
  levels,
  onChange,
  error,
  option,
  custom,
}: {
  levels: LevelDraft[];
  onChange: (levels: LevelDraft[]) => void;
  error: string | null;
  option: PropertyTypeOption | null;
  custom: boolean;
}) {
  const { t } = useTranslation();
  const [reshaping, setReshaping] = useState(custom);

  const update = (i: number, patch: Partial<LevelDraft>) =>
    onChange(levels.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const move = (i: number, by: -1 | 1) => {
    const next = [...levels];
    const [item] = next.splice(i, 1);
    next.splice(i + by, 0, item!);
    onChange(next);
  };
  const add = (kind: PropertyNodeKind) => {
    const names: Record<PropertyNodeKind, [string, string]> = {
      GROUP: ['Phase', 'Phases'],
      BUILDING: ['Building', 'Buildings'],
      FLOOR: ['Floor', 'Floors'],
      UNIT: ['Unit', 'Units'],
    };
    const level = { kind, singular: names[kind][0], plural: names[kind][1] };
    // New levels go above the unit level, which must stay last.
    const unitAt = levels.findIndex((l) => l.kind === 'UNIT');
    const next = [...levels];
    next.splice(unitAt === -1 ? next.length : unitAt, 0, level);
    onChange(next);
  };

  return (
    <div key="structure" className="space-y-4 animate-enter">
      <div className="rounded-[14px] border border-border/80 bg-surface-raised/50 p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-text-muted">{t('onboarding.structure.example')}</p>
        <p className="mt-1.5 text-sm font-semibold text-text">
          {levels.map((l) => `${l.singular || '…'} ${SAMPLE[l.kind]}`).join('  ›  ')}
        </p>
        <p className="mt-1 text-xs text-text-muted">
          {option && !custom ? t('onboarding.structure.fromPreset', { type: option.label }) : t('onboarding.structure.fromScratch')}
        </p>
      </div>

      <ol className="space-y-2">
        {levels.map((level, i) => (
          <li
            key={i}
            className="rounded-[12px] border border-border bg-surface p-3"
            style={{ marginLeft: `${Math.min(i, 3) * 0.75}rem` }}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-accent-soft px-2.5 py-1 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-accent">
                {t(`onboarding.kind.${level.kind}.title`)}
              </span>
              <span className="hidden text-xs text-text-muted sm:inline">{t(`onboarding.kind.${level.kind}.hint`)}</span>
              {reshaping ? (
                <span className="ml-auto flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="size-8" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t('onboarding.structure.moveUp')}>
                    <ArrowUp />
                  </Button>
                  <Button variant="ghost" size="icon" className="size-8" disabled={i === levels.length - 1} onClick={() => move(i, 1)} aria-label={t('onboarding.structure.moveDown')}>
                    <ArrowDown />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 text-danger"
                    disabled={levels.length <= 1}
                    onClick={() => onChange(levels.filter((_, j) => j !== i))}
                    aria-label={t('onboarding.structure.remove')}
                  >
                    <Trash2 />
                  </Button>
                </span>
              ) : null}
            </div>
            <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
              <Input
                value={level.singular}
                maxLength={40}
                onChange={(e) => update(i, { singular: e.target.value })}
                aria-label={t('onboarding.structure.singular')}
                placeholder={t('onboarding.structure.singular')}
              />
              <Input
                value={level.plural}
                maxLength={40}
                onChange={(e) => update(i, { plural: e.target.value })}
                aria-label={t('onboarding.structure.plural')}
                placeholder={t('onboarding.structure.plural')}
              />
            </div>
          </li>
        ))}
      </ol>

      {reshaping ? (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-text-muted">{t('onboarding.structure.addLevel')}</p>
          <div className="flex flex-wrap gap-2">
            {KINDS.filter((k) => k !== 'UNIT' || !levels.some((l) => l.kind === 'UNIT')).map((kind) => (
              <Button key={kind} variant="secondary" size="sm" onClick={() => add(kind)}>
                <Plus aria-hidden />
                {t(`onboarding.kind.${kind}.title`)}
              </Button>
            ))}
          </div>
        </div>
      ) : (
        <Button variant="link" size="sm" className="h-auto px-0" onClick={() => setReshaping(true)}>
          {t('onboarding.structure.reshape')}
          <ChevronRight aria-hidden />
        </Button>
      )}

      {error ? (
        <p role="alert" className="rounded-[10px] border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {t(error as 'errors.UNIT_LEVEL_REQUIRED')}
        </p>
      ) : (
        <p className="text-xs text-text-muted">{t('onboarding.structure.lockNote')}</p>
      )}
    </div>
  );
}

// ── Shared bits ──────────────────────────────────────────────────────────────────────────────────

function LevelChain({ levels, compact = false }: { levels: { singular: string }[]; compact?: boolean }) {
  return (
    <span className={cn('flex flex-wrap items-center gap-1', compact ? 'pt-1' : '')}>
      {levels.map((l, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 ? <ChevronRight className="size-3 text-text-muted" aria-hidden /> : null}
          <span
            className={cn(
              'rounded-md font-medium',
              compact ? 'bg-surface-raised px-1.5 py-0.5 text-[0.6875rem] text-text-muted' : 'text-sm text-text',
              i === levels.length - 1 && 'text-accent',
            )}
          >
            {l.singular}
          </span>
        </span>
      ))}
    </span>
  );
}

function ReviewRow({ label, onEdit, children }: { label: string; onEdit: () => void; children: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-start justify-between gap-3 rounded-[12px] border border-border/80 p-4">
      <div className="min-w-0 space-y-1">
        <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-text-muted">{label}</p>
        <div className="text-sm text-text">{children}</div>
      </div>
      <Button variant="ghost" size="sm" onClick={onEdit}>
        {t('common.edit')}
      </Button>
    </div>
  );
}
