import type { AudienceMode, UserRole } from './enums';
import type { BlockId, FlatId, PropertyNodeId } from './ids';

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
  /**
   * NODES: any mix of property nodes at any level, each meaning "every resident beneath it". The
   * drill-down picker sends the most compact form — a whole tower as one id, not its 200 flats.
   */
  nodeIds?: PropertyNodeId[] | null;
  /** USERS: exactly the accounts ticked in the composer's people list. */
  userIds?: string[] | null;
}

/** Backend `@Size` caps on the rule's lists (§4.7). */
export const AUDIENCE_LIMITS = {
  roles: 4,
  flatIds: 2000,
  blockIds: 200,
  nodeIds: 2000,
  userIds: 5000,
} as const;

/** The modes the composer offers, in the order it offers them. */
export const COMPOSER_AUDIENCE_MODES = ['ALL', 'NODES', 'ROLES', 'SALES_TEAM'] as const satisfies readonly AudienceMode[];

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
    case 'NODES':
      return { mode: 'NODES', nodeIds: draft.nodeIds ?? [] };
    case 'SALES_TEAM':
      return { mode: 'SALES_TEAM' };
    case 'USERS':
      return { mode: 'USERS', userIds: draft.userIds ?? [] };
  }
}

export type AudienceRuleError =
  | 'ROLES_REQUIRED'
  | 'ROLES_TOO_MANY'
  | 'FLATS_REQUIRED'
  | 'FLATS_TOO_MANY'
  | 'BLOCKS_REQUIRED'
  | 'BLOCKS_TOO_MANY'
  | 'NODES_REQUIRED'
  | 'NODES_TOO_MANY'
  | 'USERS_REQUIRED'
  | 'USERS_TOO_MANY';

/** Null when the rule is sendable; otherwise the reason, for an inline message on the builder. */
export function validateAudienceRule(rule: AudienceRule): AudienceRuleError | null {
  switch (rule.mode) {
    case 'ALL':
    case 'SALES_TEAM':
      return null;
    case 'USERS': {
      const users = rule.userIds ?? [];
      if (users.length === 0) return 'USERS_REQUIRED';
      if (users.length > AUDIENCE_LIMITS.userIds) return 'USERS_TOO_MANY';
      return null;
    }
    case 'NODES': {
      const nodes = rule.nodeIds ?? [];
      if (nodes.length === 0) return 'NODES_REQUIRED';
      if (nodes.length > AUDIENCE_LIMITS.nodeIds) return 'NODES_TOO_MANY';
      return null;
    }
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
  if (normalised.nodeIds) parts.push(`n:${[...normalised.nodeIds].sort().join(',')}`);
  if (normalised.userIds) parts.push(`u:${[...normalised.userIds].sort().join(',')}`);
  return parts.join('|');
}

/**
 * Render a stored rule back to prose for the history list (§8.5.5). Names are looked up where
 * the caller has them; ids that no longer resolve (a deleted flat) degrade to a count rather
 * than printing a raw UUID at someone.
 */
export function describeAudienceRule(
  rule: AudienceRule,
  lookup?: {
    flat?: (id: FlatId) => string | undefined;
    block?: (id: BlockId) => string | undefined;
    node?: (id: PropertyNodeId) => string | undefined;
  },
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
    case 'NODES':
      return names(rule.nodeIds ?? [], lookup?.node, 'location');
    case 'SALES_TEAM':
      return 'Sales team';
    case 'USERS': {
      const count = (rule.userIds ?? []).length;
      return `${count} ${count === 1 ? 'person' : 'people'}`;
    }
  }
}
