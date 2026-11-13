import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';

/** The common lengths of a visit, in minutes. "Custom" opens a minutes field. */
export const DURATION_PRESETS = [15, 30, 60, 120, 240] as const;

export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/**
 * How long a visitor will stay. Shows the out time it implies ("Out by ≈ 6:45 pm"), counted from
 * `from` (now, at the gate) — which is the whole point of asking: it is what the overstay alert
 * later measures against.
 */
export function DurationPicker({
  value,
  onChange,
  from,
  allowNone = true,
  max = 1440,
}: {
  value: number | undefined;
  onChange: (minutes: number | undefined) => void;
  from?: Date;
  allowNone?: boolean;
  max?: number;
}) {
  const { t } = useTranslation();
  const isPreset = value === undefined || (DURATION_PRESETS as readonly number[]).includes(value);
  const out = value && from ? new Date(from.getTime() + value * 60_000) : null;

  const chip = (active: boolean) =>
    cn(
      'h-9 shrink-0 rounded-full border px-3.5 text-xs font-semibold transition-colors',
      active
        ? 'border-primary bg-primary text-primary-fg'
        : 'border-border bg-surface text-text-muted hover:border-accent/50 hover:text-text',
    );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {allowNone ? (
          <button type="button" className={chip(value === undefined)} onClick={() => onChange(undefined)}>
            {t('portal.duration.notSure')}
          </button>
        ) : null}
        {DURATION_PRESETS.filter((m) => m <= max).map((minutes) => (
          <button
            key={minutes}
            type="button"
            className={chip(value === minutes)}
            onClick={() => onChange(minutes)}
          >
            {formatMinutes(minutes)}
          </button>
        ))}
        <button
          type="button"
          className={chip(!isPreset)}
          onClick={() => onChange(isPreset ? 45 : value)}
        >
          {t('portal.duration.custom')}
        </button>
      </div>
      {!isPreset ? (
        <div className="flex items-center gap-2">
          <Input
            type="number"
            inputMode="numeric"
            min={5}
            max={max}
            value={value ?? ''}
            onChange={(e) => {
              const n = Number(e.target.value);
              onChange(Number.isFinite(n) && n > 0 ? Math.min(max, Math.round(n)) : undefined);
            }}
            className="h-9 w-28"
            aria-label={t('portal.duration.minutes')}
          />
          <span className="text-sm text-text-muted">{t('portal.duration.minutes')}</span>
        </div>
      ) : null}
      {out ? (
        <p className="text-xs text-text-muted">
          {t('portal.duration.outBy', {
            time: out.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
          })}
        </p>
      ) : null}
    </div>
  );
}
