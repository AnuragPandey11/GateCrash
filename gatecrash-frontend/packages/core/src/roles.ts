import { USER_ROLES, type UserRole } from './enums';

/**
 * Role logic — FRONTEND.md §1 and guardrail #4.
 *
 * Every one of these is *navigation*, never authorization. The server re-checks each call, and
 * a client-side `true` here has no security meaning whatsoever; it decides which nav item is
 * rendered, not which row a user may touch. That goes double now that tenancy is in play: the
 * township a request acts in is decided by `TenantContextFilter` from the authenticated principal,
 * never by anything this file returns.
 */

/** Roles whose home is the admin web app. Everyone else gets the mobile app. */
export function usesAdminWeb(role: UserRole): boolean {
  return role === 'ADMIN' || role === 'SUPER_ADMIN';
}

/**
 * The platform operator, who belongs to no township.
 *
 * Two consequences the UI has to honour, both from `TenantContextFilter`:
 *
 *  1. It signs in with **no** township code, and its session has `townshipId: null`.
 *  2. Every township-scoped call it makes must carry `X-Township-Id`, so the shell has to make the
 *     operator pick a township before rendering any township screen. Without one the server answers
 *     422 `TOWNSHIP_CONTEXT_REQUIRED` — which is a clear error, not a silent default, precisely so
 *     an announcement can never land in the wrong community.
 */
export function isPlatformOperator(role: UserRole): boolean {
  return role === 'SUPER_ADMIN';
}

/** Only a super admin creates, suspends, archives or restores a township. */
export function canManageTownships(role: UserRole): boolean {
  return role === 'SUPER_ADMIN';
}

/**
 * Appointing a township's ADMIN is a platform action, not a township one — `UserProvisioningService`
 * refuses `role: 'ADMIN'` from anyone but a super admin. A township admin provisioning form must
 * not offer ADMIN in its role dropdown.
 */
export function canAppointTownshipAdmins(role: UserRole): boolean {
  return role === 'SUPER_ADMIN';
}

/**
 * The roles a township admin may create through `POST /admin/users`.
 *
 * Not simply `USER_ROLES`: the server refuses `ADMIN` from anyone but a super admin
 * (403 `ADMIN_REQUIRES_SUPER_ADMIN`) and refuses `SUPER_ADMIN` outright from that endpoint
 * (422 `ROLE_NOT_PROVISIONABLE`, since it belongs to no township). A role picker built from the
 * full enum offers two options that can only fail.
 */
export const PROVISIONABLE_ROLES = USER_ROLES.filter(
  (role) => role !== 'ADMIN' && role !== 'SUPER_ADMIN',
) as readonly UserRole[];

/**
 * `CommunityService` authorises `ADMIN, RESIDENT, SALES` — guards deliberately have no reading
 * surface at the gate (§1). Flagged in §15.6 as worth confirming with product.
 */
export function hasCommunityFeed(role: UserRole): boolean {
  return role !== 'GUARD';
}

/** Only these two roles are ever routed a visit for decision. */
export function canApproveVisits(role: UserRole): boolean {
  return role === 'RESIDENT' || role === 'SALES';
}

export function canMintPasses(role: UserRole): boolean {
  return role === 'RESIDENT' || role === 'SALES';
}

/** Gate-side operations: logging a walk-in, redeeming a pass, check-in/out. */
export function operatesGate(role: UserRole): boolean {
  return role === 'GUARD';
}

/**
 * The non-obvious one (§4.8): `TownshipService` authorises the three *list* methods for
 * `ADMIN, GUARD`. The guard app reads `/api/v1/admin/gates` and `/api/v1/admin/flats` despite
 * the `/admin` prefix — do not let a route guard block it because the URL says "admin".
 */
export function canListTownship(role: UserRole): boolean {
  // SUPER_ADMIN is granted ROLE_ADMIN on the server (`AppUserDetails.getAuthorities`), so it passes
  // every `hasRole('ADMIN')` check — but only inside the township its `X-Township-Id` header names.
  return role === 'ADMIN' || role === 'GUARD' || role === 'SUPER_ADMIN';
}
