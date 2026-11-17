import { usePlatformPropertyTypes, type PropertyTypeOption } from '@gatecrash/api';
import type { PropertyNodeKind, PropertyType } from '@gatecrash/core';
import { ChevronRight, Loader2, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/cn';

export interface LevelDraft {
  kind: PropertyNodeKind;
  singular: string;
  plural: string;
}

/**
 * Mirrors the server's level-shape rules so an invalid structure is refused *here*, where the fix
 * is one click away, rather than as a 422 after the super admin has filled in the whole form.
 *
 * The server remains the authority — this is not a substitute for it, and the messages are kept
 * deliberately close to the server's so the two never read as different complaints. Returns an
 * i18n key, or null when the shape is fine.
 */
export function levelShapeError(levels: LevelDraft[]): string | null {
  if (levels.length === 0) return 'errors.UNIT_LEVEL_REQUIRED';
  const units = levels.filter((l) => l.kind === 'UNIT').length;
  if (units !== 1) return 'errors.UNIT_LEVEL_REQUIRED';
  if (levels[levels.length - 1]!.kind !== 'UNIT') return 'errors.UNIT_LEVEL_MUST_BE_LAST';
  for (let i = 0; i < levels.length; i++) {
    if (levels[i]!.kind === 'FLOOR' && (i === 0 || levels[i - 1]!.kind !== 'BUILDING')) {
      return 'errors.FLOOR_NEEDS_BUILDING';
    }
  }
  if (levels.some((l) => !l.singular.trim() || !l.plural.trim())) {
    return 'townships.form.levelNamesRequired';
  }
  return null;
}

/**
 * The question that opens township onboarding: what kind of project does this developer build?
 *
 * Onboarding is the *only* moment the structure is easy to get right. The level set cannot be
 * reshaped once the tree holds anything (`409 PROPERTY_TREE_NOT_EMPTY`), because inserting a level
 * under towers that already hold flats has no safe automatic answer to which floor each flat
 * belongs on. So this shows the resulting structure inline rather than hiding it behind the
 * dropdown — a super admin picking "Mall / retail centre" sees `Mall → Level → Shop` before they
 * commit, and can tell immediately whether it matches what the developer described.
 *
 * "Customise" drops the preset and edits the levels directly, for the developer whose project is
 * not any of the fifteen. That path posts explicit `levels`, and the server validates it with the
 * same rules it would apply later.
 */
export function ProjectTypePicker({
  value,
  onChange,
  levels,
  onLevelsChange,
}: {
  value: PropertyType | null;
  onChange: (type: PropertyType) => void;
  /** Null while following the preset; an array once the super admin has customised it. */
  levels: LevelDraft[] | null;
  onLevelsChange: (levels: LevelDraft[] | null) => void;
}) {
  const { t } = useTranslation();
  const types = usePlatformPropertyTypes();

  const selected = types.data?.find((option) => option.value === value) ?? null;
  const effective: LevelDraft[] = levels ?? selected?.defaultLevels ?? [];
  const customising = levels !== null;
  // Only checked while customising: a preset is valid by construction, and showing an error
  // against a shape the super admin did not choose would be noise.
  const shapeError = customising ? levelShapeError(effective) : null;

  /** Grouped so fifteen options stay navigable: Residential, Commercial, Mixed use. */
  const grouped = useMemo(() => {
    const map = new Map<string, { label: string; options: PropertyTypeOption[] }>();
    for (const option of types.data ?? []) {
      const group = map.get(option.category) ?? { label: option.categoryLabel, options: [] };
      group.options.push(option);
      map.set(option.category, group);
    }
    return [...map.values()];
  }, [types.data]);

  if (types.isPending) {
    return (
      <div className="flex items-center gap-2 text-sm text-text-muted">
        <Loader2 className="animate-spin" aria-hidden />
        {t('common.loading')}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Field label={t('townships.form.projectType')} hint={t('townships.form.projectTypeHint')} required>
        {(props) => (
          <Select
            value={value ?? ''}
            onValueChange={(next) => {
              onChange(next as PropertyType);
              // Switching preset abandons a customisation, which would otherwise silently survive
              // and make the preview disagree with what gets created.
              onLevelsChange(null);
            }}
          >
            <SelectTrigger {...props}>
              <SelectValue placeholder={t('townships.form.projectTypePlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {grouped.map((group) => (
                <SelectGroup key={group.label}>
                  <SelectLabel>{group.label}</SelectLabel>
                  {group.options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>

      {selected ? <p className="text-xs text-text-muted">{selected.description}</p> : null}

      {effective.length > 0 ? (
        <div className="rounded-md border border-border bg-surface-muted p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-text-muted">
              {t('townships.form.structure')}
            </p>
            {customising ? (
              <Button variant="ghost" size="sm" onClick={() => onLevelsChange(null)}>
                <RotateCcw aria-hidden />
                {t('townships.form.usePreset')}
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onLevelsChange(effective.map((l) => ({ ...l })))}
              >
                <Pencil aria-hidden />
                {t('townships.form.customise')}
              </Button>
            )}
          </div>

          {customising ? (
            <LevelEditor levels={effective} onChange={onLevelsChange} />
          ) : (
            <StructurePreview levels={effective} />
          )}

          {shapeError ? (
            <p role="alert" className="mt-2 text-xs text-danger">
              {t(shapeError as 'errors.UNIT_LEVEL_REQUIRED')}
            </p>
          ) : null}

          <p className="mt-2 text-xs text-text-muted">{t('townships.form.structureLocked')}</p>
        </div>
      ) : null}
    </div>
  );
}

/** `Phase → Block → Floor → Flat`, with the addressable level marked. */
function StructurePreview({ levels }: { levels: LevelDraft[] }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-1 text-sm">
      {levels.map((level, index) => (
        <span key={`${level.kind}-${index}`} className="flex items-center gap-1">
          {index > 0 ? <ChevronRight className="size-3 text-text-muted" aria-hidden /> : null}
          <span
            className={cn(
              'rounded px-1.5 py-0.5',
              level.kind === 'UNIT'
                ? 'bg-primary/10 font-medium text-primary'
                : 'text-text',
            )}
            // The unit level is where residents live and visits are routed, so it is worth
            // pointing out rather than leaving as one word among four.
            title={level.kind === 'UNIT' ? t('townships.form.unitLevelHint') : level.kind}
          >
            {level.singular}
          </span>
        </span>
      ))}
    </div>
  );
}

const KINDS: PropertyNodeKind[] = ['GROUP', 'BUILDING', 'FLOOR', 'UNIT'];

/**
 * Direct level editing, for a structure no preset covers.
 *
 * Kept deliberately plain: the server validates the shape (exactly one unit level, it must be
 * last, a floor must sit inside a building) and returns a named error, so this does not attempt to
 * re-implement those rules and risk disagreeing with them.
 */
function LevelEditor({
  levels,
  onChange,
}: {
  levels: LevelDraft[];
  onChange: (levels: LevelDraft[]) => void;
}) {
  const { t } = useTranslation();
  const [dragless] = useState(true); // reordering is add/remove only; see the note above

  const update = (index: number, patch: Partial<LevelDraft>) =>
    onChange(levels.map((level, i) => (i === index ? { ...level, ...patch } : level)));

  return (
    <div className="space-y-2">
      {levels.map((level, index) => (
        <div key={index} className="flex flex-wrap items-end gap-2">
          <Select
            value={level.kind}
            onValueChange={(kind) => update(index, { kind: kind as PropertyNodeKind })}
          >
            <SelectTrigger className="w-32" aria-label={t('township.levels.kind')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KINDS.map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {kind}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={level.singular}
            onChange={(e) => update(index, { singular: e.target.value })}
            placeholder={t('township.levels.singular')}
            aria-label={t('township.levels.singular')}
            className="w-32"
          />
          <Input
            value={level.plural}
            onChange={(e) => update(index, { plural: e.target.value })}
            placeholder={t('township.levels.plural')}
            aria-label={t('township.levels.plural')}
            className="w-32"
          />
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('common.delete')}
            disabled={levels.length <= 2 || !dragless}
            onClick={() => onChange(levels.filter((_, i) => i !== index))}
          >
            <Trash2 className="text-danger" />
          </Button>
        </div>
      ))}

      {levels.length < 6 ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={() =>
            // Inserted before the unit level, which must stay last.
            onChange([
              ...levels.slice(0, -1),
              { kind: 'BUILDING', singular: '', plural: '' },
              levels[levels.length - 1]!,
            ])
          }
        >
          <Plus aria-hidden />
          {t('townships.form.addLevel')}
        </Button>
      ) : null}
    </div>
  );
}
