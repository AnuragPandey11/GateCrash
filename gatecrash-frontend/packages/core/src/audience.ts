import type { AudienceMode, UserRole } from './enums';
import type { BlockId, FlatId } from './ids';

/**
 * The notification targeting rule — mirrors `NotificationDtos.AudienceRule`.
 *
 * Which list is required depends on `mode`, and the backend checks that in `AudienceResolver`
 * rather than with bean-validation annotations (it cannot express "required only when mode is
 * FLATS"). So the client has to carry the same knowledge to tell the admin *before* the
 * round-trip — that is what `validateAudienceRule` is.
 */
export interface AudienceRule {
  mode: AudienceMode;
  roles?: UserRole[] | null;
  flatIds?: FlatId[] | null;
  blockIds?: BlockId[] | null;
}

/** Backend `@Size` caps on the rule's lists (§4.7). */
export const AUDIENCE_LIMITS = {
  roles: 4,
  flatIds: 2000,
  blockIds: 200,
} as const;

/**
 * Build the request body for one mode, carrying *only* the list that mode uses.
 *
 * This is the §4.3 rule made concrete: Jackson runs with `fail-on-unknown-properties`, and more
 * importantly a rule that carries a stale `flatIds` from a mode the admin has since switched
 * away from would resolve an audience nobody reviewed. The builder drops what the mode does not
 * use rather than trusting the form to have cleared it.
 */
export function buildAudienceRule(draft: AudienceRule): AudienceRule {
  switch (draft.mode) {
    case 'ALL':
      return { mode: 'ALL' };
    case 'ALL_EXCEPT':
    case 'ROLES':
      return { mode: draft.mode, roles: draft.roles ?? [] };
    case 'FLATS':
      return { mode: 'FLATS', flatIds: draft.flatIds ?? [] };
    case 'BLOCKS':
      return { mode: 'BLOCKS', blockIds: draft.blockIds ?? [] };
  }
}

export type AudienceRuleError =
  | 'ROLES_REQUIRED'
  | 'ROLES_TOO_MANY'
  | 'FLATS_REQUIRED'
  | 'FLATS_TOO_MANY'
  | 'BLOCKS_REQUIRED'
  | 'BLOCKS_TOO_MANY';

/** Null when the rule is sendable; otherwise the reason, for an inline message on the builder. */
export function validateAudienceRule(rule: AudienceRule): AudienceRuleError | null {
  switch (rule.mode) {
    case 'ALL':
      return null;
    case 'ALL_EXCEPT':
    case 'ROLES': {
      const roles = rule.roles ?? [];
      if (roles.length === 0) return 'ROLES_REQUIRED';
      if (roles.length > AUDIENCE_LIMITS.roles) return 'ROLES_TOO_MANY';
      return null;
    }
    case 'FLATS': {
      const flats = rule.flatIds ?? [];
      if (flats.length === 0) return 'FLATS_REQUIRED';
      if (flats.length > AUDIENCE_LIMITS.flatIds) return 'FLATS_TOO_MANY';
      return null;
    }
    case 'BLOCKS': {
      const blocks = rule.blockIds ?? [];
      if (blocks.length === 0) return 'BLOCKS_REQUIRED';
      if (blocks.length > AUDIENCE_LIMITS.blockIds) return 'BLOCKS_TOO_MANY';
      return null;
    }
  }
}

/**
 * A stable identity for a rule, so the composer can tell "the preview on screen describes the
 * rule currently in the form" from "the preview is stale" (§8.5: Send stays disabled until the
 * preview has resolved for the *current* rule). Lists are sorted so reordering a multi-select
 * does not invalidate a preview that is still accurate.
 */
export function audienceRuleKey(rule: AudienceRule): string {
  const normalised = buildAudienceRule(rule);
  const parts: string[] = [normalised.mode];
  if (normalised.roles) parts.push(`r:${[...normalised.roles].sort().join(',')}`);
  if (normalised.flatIds) parts.push(`f:${[...normalised.flatIds].sort().join(',')}`);
  if (normalised.blockIds) parts.push(`b:${[...normalised.blockIds].sort().join(',')}`);
  return parts.join('|');
}

/**
 * Render a stored rule back to prose for the history list (§8.5.5). Names are looked up where
 * the caller has them; ids that no longer resolve (a deleted flat) degrade to a count rather
 * than printing a raw UUID at someone.
 */
export function describeAudienceRule(
  rule: AudienceRule,
  lookup?: { flat?: (id: FlatId) => string | undefined; block?: (id: BlockId) => string | undefined },
): string {
  const names = <T extends string>(ids: T[], resolve?: (id: T) => string | undefined, noun = 'item') => {
    const resolved = ids.map((id) => resolve?.(id)).filter((n): n is string => Boolean(n));
    if (resolved.length === ids.length && ids.length <= 6) return resolved.join(', ');
    if (resolved.length > 0 && ids.length <= 6) return `${resolved.join(', ')} +${ids.length - resolved.length} more`;
    return `${ids.length} ${noun}${ids.length === 1 ? '' : 's'}`;
  };

  switch (rule.mode) {
    case 'ALL':
      return 'Everyone';
    case 'ALL_EXCEPT':
      return `Everyone except ${(rule.roles ?? []).join(', ') || 'nobody'}`;
    case 'ROLES':
      return (rule.roles ?? []).join(', ') || 'No roles';
    case 'FLATS':
      return `Flats: ${names(rule.flatIds ?? [], lookup?.flat, 'flat')}`;
    case 'BLOCKS':
      return `Blocks: ${names(rule.blockIds ?? [], lookup?.block, 'block')}`;
  }
}
