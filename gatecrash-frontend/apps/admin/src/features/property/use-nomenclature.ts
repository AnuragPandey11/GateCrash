import { usePropertyProfile } from '@gatecrash/api';
import type { PropertyLevelResponse } from '@gatecrash/api';
import type { PropertyNodeKind } from '@gatecrash/core';
import { useTranslation } from 'react-i18next';

/**
 * The township's own vocabulary, for every screen that names part of the property structure.
 *
 * This is what makes the admin panel adapt per developer. A villa community reads "Add villa" and
 * a high-rise reads "Add apartment" from the same components and the same translation strings —
 * the level words arrive from `GET /admin/property/profile` and get interpolated in.
 *
 * **Labels are for rendering only.** Nothing here should ever be compared against: the moment a
 * component asks `level.singular === 'Flat'`, renaming that level in the console changes behaviour
 * instead of wording, which is exactly the trap the server-side split between `kind` and the labels
 * exists to avoid. Branch on {@link PropertyNodeKind} — `unitLevel`, `hasFloors` and `levelOfKind`
 * below are the sanctioned ways to ask structural questions.
 */
export function useNomenclature() {
  const { t } = useTranslation();
  const profile = usePropertyProfile();

  const levels = profile.data?.levels ?? [];
  const unitLevel = levels.find((l) => l.kind === 'UNIT') ?? null;

  /**
   * A neutral fallback while the profile is still loading, so a tab strip does not flash the word
   * "undefined" at an admin. Deliberately generic rather than "Flat": guessing a developer's
   * vocabulary and being wrong for half a second is worse than being vague for half a second.
   */
  const fallback: Pick<PropertyLevelResponse, 'singular' | 'plural'> = {
    singular: t('township.node.parent', { level: 'Level' }),
    plural: 'Levels',
  };

  const at = (depth: number) => levels.find((l) => l.depth === depth) ?? null;

  return {
    isPending: profile.isPending,
    isError: profile.isError,
    error: profile.error,
    refetch: profile.refetch,

    propertyType: profile.data?.propertyType ?? null,
    propertyTypeLabel: profile.data?.propertyTypeLabel ?? '',
    /** Ordered shallowest-first. Empty until the profile loads. */
    levels,
    hasFloors: profile.data?.hasFloors ?? false,

    /** The addressable level — where residents live and visits are routed. */
    unitLevel,
    /** The outermost level: towers, clusters, phases. */
    rootLevel: at(0),
    at,
    levelOfKind: (kind: PropertyNodeKind) => levels.find((l) => l.kind === kind) ?? null,

    /** Singular label for a depth, e.g. "Villa". Falls back while loading. */
    singular: (depth: number) => at(depth)?.singular ?? fallback.singular,
    /** Plural label for a depth, e.g. "Villas". */
    plural: (depth: number) => at(depth)?.plural ?? fallback.plural,

    /** The words a level's *children* are known by — for "add one before creating villas". */
    childPlural: (depth: number) => at(depth + 1)?.plural ?? fallback.plural,

    /**
     * Interpolation values for the `{{level}}` / `{{levels}}` templates in the i18n bundle, so a
     * caller writes `t('township.node.add', words(depth))` rather than assembling the pair itself.
     */
    words: (depth: number) => ({
      level: at(depth)?.singular ?? fallback.singular,
      levels: at(depth)?.plural ?? fallback.plural,
      children: at(depth + 1)?.plural ?? fallback.plural,
    }),
  };
}

export type Nomenclature = ReturnType<typeof useNomenclature>;
