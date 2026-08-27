import { usePropertyNodes } from '@gatecrash/api';
import {
  AUDIENCE_LIMITS,
  AUDIENCE_MODES,
  USER_ROLES,
  type AudienceMode,
  type AudienceRule,
  type AudienceRuleError,
  type BlockId,
  type FlatId,
  type UserRole,
} from '@gatecrash/core';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { useNomenclature } from '@/features/property/use-nomenclature';

/**
 * The audience builder — FRONTEND.md §8.5.2.
 *
 * A mode selector driving different controls, because the five modes take genuinely different
 * inputs and a single "who" widget that tried to cover all of them would be worse at each.
 *
 * Selection state is held per-mode by the parent rather than being cleared on every switch, so
 * an admin who flicks between FLATS and BLOCKS to compare reach does not lose their work — and
 * `buildAudienceRule` guarantees only the active mode's list is ever sent (§4.3.1).
 */

export interface AudienceBuilderProps {
  rule: AudienceRule;
  onChange: (rule: AudienceRule) => void;
  error: AudienceRuleError | null;
  flatSearch: string;
  onFlatSearchChange: (value: string) => void;
}

export function AudienceBuilder({
  rule,
  onChange,
  error,
  flatSearch,
  onFlatSearchChange,
}: AudienceBuilderProps) {
  const { t } = useTranslation();
  const nom = useNomenclature();
  // BLOCKS outgrew its name server-side: it now means "everyone anywhere beneath these nodes", at
  // any depth. Offering the outermost level keeps the picker meaningful for every project shape --
  // towers in a high-rise, clusters in a villa community, phases in a mixed-use township.
  const blocks = usePropertyNodes({ depth: 0 });
  const flats = usePropertyNodes(
    { depth: nom.unitLevel?.depth ?? null },
    { enabled: nom.unitLevel != null },
  );

  const selectedRoles = new Set(rule.roles ?? []);
  const selectedFlats = new Set(rule.flatIds ?? []);
  const selectedBlocks = new Set(rule.blockIds ?? []);

  const flatsByBlock = useMemo(() => {
    const needle = flatSearch.trim().toLowerCase();
    const groups = new Map<string, { name: string; flats: { id: FlatId; number: string }[] }>();
    for (const flat of flats.data ?? []) {
      const label = flat.code ?? flat.name;
      if (needle && !label.toLowerCase().includes(needle)) continue;
      const key = flat.containerName ?? '';
      const group = groups.get(key) ?? { name: key, flats: [] };
      group.flats.push({ id: flat.id, number: label });
      groups.set(key, group);
    }
    return groups;
  }, [flats.data, flatSearch]);

  const toggleRole = (role: UserRole) => {
    const next = new Set(selectedRoles);
    if (next.has(role)) next.delete(role);
    else next.add(role);
    onChange({ ...rule, roles: [...next] });
  };

  const toggleFlat = (id: FlatId) => {
    const next = new Set(selectedFlats);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange({ ...rule, flatIds: [...next] });
  };

  const toggleBlockOfFlats = (ids: FlatId[]) => {
    const next = new Set(selectedFlats);
    // "Select all in block" is a toggle: if every flat in the block is already selected, the
    // same click clears them. A button that only ever adds is a trap on a 40-flat block.
    const allSelected = ids.every((id) => next.has(id));
    for (const id of ids) {
      if (allSelected) next.delete(id);
      else next.add(id);
    }
    onChange({ ...rule, flatIds: [...next] });
  };

  const toggleBlock = (id: BlockId) => {
    const next = new Set(selectedBlocks);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange({ ...rule, blockIds: [...next] });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {AUDIENCE_MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={rule.mode === mode}
            onClick={() => onChange({ ...rule, mode: mode as AudienceMode })}
            className={cn(
              'rounded-md border px-3 py-1.5 text-sm font-medium transition-colors',
              rule.mode === mode
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-text-muted hover:text-text',
            )}
          >
            {t(`notifications.compose.mode.${mode}`)}
          </button>
        ))}
      </div>

      <p className="text-sm text-text-muted">{t(`notifications.compose.modeHint.${rule.mode}`)}</p>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {t(`notifications.compose.errors.${error}`, {
            max:
              error.startsWith('ROLES')
                ? AUDIENCE_LIMITS.roles
                : error.startsWith('FLATS')
                  ? AUDIENCE_LIMITS.flatIds
                  : AUDIENCE_LIMITS.blockIds,
          })}
        </p>
      ) : null}

      {rule.mode === 'ROLES' || rule.mode === 'ALL_EXCEPT' ? (
        <div className="flex flex-wrap gap-3 rounded-md border border-border p-3">
          {USER_ROLES.map((role) => (
            <label key={role} className="flex cursor-pointer items-center gap-2 text-sm text-text">
              <Checkbox
                checked={selectedRoles.has(role)}
                onCheckedChange={() => toggleRole(role)}
                aria-label={t(`role.${role}`)}
              />
              {t(`role.${role}`)}
            </label>
          ))}
        </div>
      ) : null}

      {rule.mode === 'BLOCKS' ? (
        <div className="space-y-2 rounded-md border border-border p-3">
          {(blocks.data ?? []).map((block) => (
            <label key={block.id} className="flex cursor-pointer items-center gap-2 text-sm text-text">
              <Checkbox
                checked={selectedBlocks.has(block.id)}
                onCheckedChange={() => toggleBlock(block.id)}
                aria-label={block.name}
              />
              {block.name}
              <span className="text-xs text-text-muted">
                {t('township.node.childCount', {
                  count: block.childCount,
                  level: nom.singular(1),
                  levels: nom.plural(1),
                })}
              </span>
            </label>
          ))}
          {selectedBlocks.size > 0 ? (
            <Badge tone="primary">
              {t('notifications.compose.blocksSelected', { count: selectedBlocks.size })}
            </Badge>
          ) : null}
        </div>
      ) : null}

      {rule.mode === 'FLATS' ? (
        <div className="space-y-3 rounded-md border border-border p-3">
          <div className="flex items-center gap-2">
            <Input
              value={flatSearch}
              onChange={(e) => onFlatSearchChange(e.target.value)}
              placeholder="101"
              aria-label={t('common.search')}
              className="h-8 w-40"
            />
            {selectedFlats.size > 0 ? (
              <Badge tone="primary">
                {t('notifications.compose.flatsSelected', { count: selectedFlats.size })}
              </Badge>
            ) : null}
          </div>

          <div className="max-h-72 space-y-3 overflow-y-auto">
            {[...flatsByBlock.entries()].map(([blockId, group]) => {
              const ids = group.flats.map((f) => f.id);
              const allSelected = ids.length > 0 && ids.every((id) => selectedFlats.has(id));
              return (
                <div key={blockId} className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                      {group.name}
                    </p>
                    <button
                      type="button"
                      onClick={() => toggleBlockOfFlats(ids)}
                      className="text-xs text-primary hover:underline"
                    >
                      {allSelected
                        ? t('common.clear')
                        : t('notifications.compose.selectAllInBlock', { block: group.name })}
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-1 sm:grid-cols-4">
                    {group.flats.map((flat) => (
                      <label
                        key={flat.id}
                        className="flex cursor-pointer items-center gap-1.5 text-sm text-text"
                      >
                        <Checkbox
                          checked={selectedFlats.has(flat.id)}
                          onCheckedChange={() => toggleFlat(flat.id)}
                          aria-label={flat.number}
                        />
                        {flat.number}
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
