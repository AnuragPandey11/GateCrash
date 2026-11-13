import {
  AUDIENCE_LIMITS,
  COMPOSER_AUDIENCE_MODES,
  type AudienceRule,
  type AudienceRuleError,
  type UserRole,
} from '@gatecrash/core';
import { Building2, Handshake, Users, UsersRound, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Checkbox } from '@/components/ui/checkbox';
import { useNomenclature } from '@/features/property/use-nomenclature';
import { cn } from '@/lib/cn';
import { PropertyPicker } from './property-picker';

/**
 * The audience builder — FRONTEND.md §8.5.2, reworked.
 *
 * Four plain choices instead of five modes with overlapping meanings:
 *
 *  - **Everyone** in the township.
 *  - **Specific homes** — drill down building → floor → unit and tick at any level. This is the
 *    one for "please pay your electricity bill": a tower, a floor, or a handful of flats.
 *  - **By role** — residents, guards, admins.
 *  - **Sales team** — accounts with the sales flag, whatever their role.
 *
 * Selection state is held per-mode by the parent rather than being cleared on every switch, so
 * flicking between modes to compare reach does not lose a careful selection — and
 * `buildAudienceRule` guarantees only the active mode's list is ever sent (§4.3.1).
 */

/** Roles a township admin can address. SUPER_ADMIN belongs to no township, so it is never a recipient. */
const ADDRESSABLE_ROLES = ['RESIDENT', 'GUARD', 'ADMIN'] as const satisfies readonly UserRole[];

const MODE_ICONS: Record<(typeof COMPOSER_AUDIENCE_MODES)[number], LucideIcon> = {
  ALL: UsersRound,
  NODES: Building2,
  ROLES: Users,
  SALES_TEAM: Handshake,
};

export interface AudienceBuilderProps {
  rule: AudienceRule;
  onChange: (rule: AudienceRule) => void;
  error: AudienceRuleError | null;
}

export function AudienceBuilder({ rule, onChange, error }: AudienceBuilderProps) {
  const { t } = useTranslation();
  const nom = useNomenclature();
  const unitPlural = (nom.unitLevel?.plural ?? 'units').toLowerCase();
  const selectedRoles = new Set(rule.roles ?? []);

  const toggleRole = (role: UserRole) => {
    const next = new Set(selectedRoles);
    if (next.has(role)) next.delete(role);
    else next.add(role);
    onChange({ ...rule, roles: [...next] });
  };

  return (
    <div className="space-y-4">
      <div role="radiogroup" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {COMPOSER_AUDIENCE_MODES.map((mode) => {
          const Icon = MODE_ICONS[mode];
          const active = rule.mode === mode;
          return (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange({ ...rule, mode })}
              className={cn(
                'flex items-start gap-3 rounded-[14px] border p-4 text-left transition-all duration-300 ease-out-expo',
                active
                  ? 'border-accent bg-accent-soft shadow-raised ring-1 ring-accent/60'
                  : 'border-border bg-surface hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-soft',
              )}
            >
              <Icon
                className={cn('mt-0.5 size-5 shrink-0 transition-colors', active ? 'text-accent' : 'text-text-muted')}
                aria-hidden
              />
              <span className="space-y-0.5">
                <span className="block text-sm font-semibold text-text">
                  {t(`notifications.audience.${mode}.title`, { units: unitPlural })}
                </span>
                <span className="block text-xs text-text-muted">
                  {t(`notifications.audience.${mode}.hint`, { units: unitPlural })}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {t(`notifications.compose.errors.${error}`, {
            max: error.startsWith('ROLES')
              ? AUDIENCE_LIMITS.roles
              : error.startsWith('NODES')
                ? AUDIENCE_LIMITS.nodeIds
                : error.startsWith('FLATS')
                  ? AUDIENCE_LIMITS.flatIds
                  : AUDIENCE_LIMITS.blockIds,
          })}
        </p>
      ) : null}

      {rule.mode === 'NODES' ? (
        <PropertyPicker
          selected={rule.nodeIds ?? []}
          onChange={(nodeIds) => onChange({ ...rule, nodeIds })}
        />
      ) : null}

      {rule.mode === 'ROLES' ? (
        <div className="flex flex-wrap gap-4 rounded-md border border-border p-3">
          {ADDRESSABLE_ROLES.map((role) => (
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
    </div>
  );
}
