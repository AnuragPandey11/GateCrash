import { usePropertyNodes } from '@gatecrash/api';
import type { PropertyNodeId } from '@gatecrash/core';
import { ChevronRight, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { useNomenclature } from '@/features/property/use-nomenclature';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/errors';
import {
  breadcrumb,
  buildTree,
  checkStates,
  coveredUnits,
  toggle,
  type CheckState,
  type Tree,
} from './node-selection';

const MAX_SEARCH_RESULTS = 60;
const MAX_CHIPS = 12;

/**
 * "Who receives this" as a drill-down: building, then floor, then the units themselves.
 *
 * One column per level of *this township's* tree, labelled in its own words — Towers, Floors,
 * Flats for a high-rise; Clusters, Villas for a villa community — so the same picker works for
 * every project shape. Pick a building to see its floors, a floor to see its units, and tick at
 * whatever level you mean: a whole tower, two floors of another, three individual flats.
 *
 * The selection is kept compact (see `node-selection.ts`), so ticking a tower sends one id and
 * the server resolves "everyone beneath it".
 */
export function PropertyPicker({
  selected,
  onChange,
}: {
  selected: readonly PropertyNodeId[];
  onChange: (next: PropertyNodeId[]) => void;
}) {
  const { t } = useTranslation();
  const nom = useNomenclature();
  // No parent and no depth: the whole tree in one request. Towers and floors are a handful of
  // rows; units are the bulk, and the picker needs all of them to search and to count.
  const nodes = usePropertyNodes({});
  const tree = useMemo(() => buildTree(nodes.data ?? []), [nodes.data]);

  const [focus, setFocus] = useState<PropertyNodeId[]>([]);
  const [search, setSearch] = useState('');

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const stateOf = useMemo(() => checkStates(tree, selectedSet), [tree, selectedSet]);
  const units = coveredUnits(tree, selected);

  if (nodes.isPending || nom.isPending) return <LoadingState />;
  if (nodes.isError) {
    return <ErrorState message={errorMessage(nodes.error, t)} onRetry={() => void nodes.refetch()} />;
  }
  if (tree.roots.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border p-4 text-sm text-text-muted">
        {t('notifications.picker.emptyTree')}
      </p>
    );
  }

  const unitWords = nom.unitLevel
    ? { level: nom.unitLevel.singular, levels: nom.unitLevel.plural }
    : { level: 'unit', levels: 'units' };
  const depthCount = Math.max(nom.levels.length, 1);
  const onToggle = (id: PropertyNodeId) => onChange(toggle(tree, selected, id));

  // Column d lists the roots (d = 0) or the children of whatever is focused one column to the left.
  const columns = Array.from({ length: depthCount }, (_, depth) => {
    if (depth === 0) return { depth, parentId: null as PropertyNodeId | null, ids: tree.roots };
    const parentId = focus[depth - 1] ?? null;
    return {
      depth,
      parentId,
      ids: parentId ? (tree.byId.get(parentId)?.children ?? []) : null,
    };
  });

  const needle = search.trim().toLowerCase();
  const searchResults = needle
    ? [...tree.byId.values()]
        .filter(
          (node) =>
            node.label.toLowerCase().includes(needle) ||
            breadcrumb(tree, node.id).toLowerCase().includes(needle),
        )
        .sort((a, b) => a.depth - b.depth)
        .slice(0, MAX_SEARCH_RESULTS)
    : [];

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-text-muted"
          aria-hidden
        />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('notifications.picker.searchPlaceholder', unitWords)}
          aria-label={t('common.search')}
          className="pl-8"
        />
      </div>

      {needle ? (
        <div className="max-h-80 overflow-y-auto rounded-md border border-border">
          {searchResults.length === 0 ? (
            <p className="p-3 text-sm text-text-muted">{t('notifications.picker.noMatches')}</p>
          ) : (
            searchResults.map((node) => (
              <PickerRow
                key={node.id}
                tree={tree}
                id={node.id}
                state={stateOf(node.id)}
                label={breadcrumb(tree, node.id)}
                onToggle={onToggle}
              />
            ))
          )}
        </div>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {columns.map((column) => (
            <div
              key={column.depth}
              className="flex min-w-[13rem] flex-1 flex-col rounded-md border border-border"
            >
              <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                  {nom.plural(column.depth)}
                </p>
                {column.depth > 0 && column.parentId ? (
                  <button
                    type="button"
                    className="text-xs text-primary hover:underline"
                    onClick={() => onToggle(column.parentId!)}
                  >
                    {stateOf(column.parentId) === 'checked' || stateOf(column.parentId) === 'implied'
                      ? t('common.clear')
                      : t('notifications.picker.selectAll')}
                  </button>
                ) : null}
              </div>

              {column.ids === null ? (
                <p className="p-3 text-xs text-text-muted">
                  {t('notifications.picker.pickParent', {
                    level: nom.singular(column.depth - 1).toLowerCase(),
                    levels: nom.plural(column.depth).toLowerCase(),
                  })}
                </p>
              ) : column.ids.length === 0 ? (
                <p className="p-3 text-xs text-text-muted">{t('notifications.picker.nothingHere')}</p>
              ) : (
                <div className="max-h-72 overflow-y-auto py-1">
                  {column.ids.map((id) => {
                    const node = tree.byId.get(id)!;
                    const canDrill = node.children.length > 0;
                    return (
                      <PickerRow
                        key={id}
                        tree={tree}
                        id={id}
                        state={stateOf(id)}
                        label={node.label}
                        focused={focus[column.depth] === id}
                        onToggle={onToggle}
                        onDrill={
                          canDrill
                            ? () => setFocus((prev) => [...prev.slice(0, column.depth), id])
                            : undefined
                        }
                      />
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <SelectionSummary
        tree={tree}
        selected={selected}
        units={units}
        unitWords={unitWords}
        onRemove={onToggle}
        onClear={() => onChange([])}
      />
    </div>
  );
}

function PickerRow({
  tree,
  id,
  state,
  label,
  focused = false,
  onToggle,
  onDrill,
}: {
  tree: Tree;
  id: PropertyNodeId;
  state: CheckState;
  label: string;
  focused?: boolean;
  onToggle: (id: PropertyNodeId) => void;
  onDrill?: () => void;
}) {
  const { t } = useTranslation();
  const node = tree.byId.get(id)!;
  const isUnit = node.kind === 'UNIT';
  const covered = state === 'checked' || state === 'implied';

  return (
    <div
      className={cn(
        'flex items-center gap-2 px-3 py-1.5 text-sm',
        focused ? 'bg-accent-soft' : 'hover:bg-surface-raised',
      )}
    >
      <Checkbox
        checked={covered ? true : state === 'partial' ? 'indeterminate' : false}
        onCheckedChange={() => onToggle(id)}
        aria-label={label}
      />
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        // A row's text drills into it; the checkbox is the only thing that selects. Units have
        // nowhere to drill, so for them the text toggles too — a bigger target for the common case.
        onClick={onDrill ?? (() => onToggle(id))}
      >
        <span className="min-w-0 flex-1 truncate text-text">{label}</span>
        <span className="shrink-0 text-xs text-text-muted">
          {isUnit
            ? node.residentAccounts === 0
              ? t('notifications.picker.noAccounts')
              : t('notifications.picker.accounts', { count: node.residentAccounts })
            : t('notifications.picker.unitCount', { count: node.unitCount })}
        </span>
        {onDrill ? <ChevronRight className="size-4 shrink-0 text-text-muted" aria-hidden /> : null}
      </button>
    </div>
  );
}

function SelectionSummary({
  tree,
  selected,
  units,
  unitWords,
  onRemove,
  onClear,
}: {
  tree: Tree;
  selected: readonly PropertyNodeId[];
  units: number;
  unitWords: { level: string; levels: string };
  onRemove: (id: PropertyNodeId) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  if (selected.length === 0) {
    return <p className="text-sm text-text-muted">{t('notifications.picker.nothingSelected')}</p>;
  }

  // Broadest first, so "Tower A" leads and individual flats trail.
  const ordered = [...selected].sort(
    (a, b) => (tree.byId.get(a)?.depth ?? 0) - (tree.byId.get(b)?.depth ?? 0),
  );
  const shown = ordered.slice(0, MAX_CHIPS);

  return (
    <div className="space-y-2 rounded-[12px] border border-border/70 bg-surface-raised/60 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-text">
          {t('notifications.picker.covers', {
            count: units,
            level: unitWords.level.toLowerCase(),
            levels: unitWords.levels.toLowerCase(),
          })}
        </p>
        <Button variant="link" size="sm" className="h-auto px-0" onClick={onClear}>
          {t('notifications.picker.clearAll')}
        </Button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {shown.map((id) => (
          <span
            key={id}
            className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent-soft py-0.5 pl-2.5 pr-1 text-xs font-medium text-text animate-pop-in"
          >
            {breadcrumb(tree, id)}
            <button
              type="button"
              onClick={() => onRemove(id)}
              className="rounded-full p-0.5 text-text-muted hover:bg-accent/20 hover:text-text"
              aria-label={t('notifications.picker.remove', { name: breadcrumb(tree, id) })}
            >
              <X className="size-3" aria-hidden />
            </button>
          </span>
        ))}
        {ordered.length > shown.length ? (
          <span className="px-1 py-0.5 text-xs text-text-muted">
            {t('notifications.picker.more', { count: ordered.length - shown.length })}
          </span>
        ) : null}
      </div>
    </div>
  );
}
