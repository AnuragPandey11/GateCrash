import type { UserRole } from './enums';

/**
 * Role logic — FRONTEND.md §1 and guardrail #4.
 *
 * Every one of these is *navigation*, never authorization. The server re-checks each call, and
 * a client-side `true` here has no security meaning whatsoever; it decides which nav item is
 * rendered, not which row a user may touch.
 */

/** Roles whose home is the admin web app. Everyone else gets the mobile app. */
export function usesAdminWeb(role: UserRole): boolean {
  return role === 'ADMIN';
}

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
  return role === 'ADMIN' || role === 'GUARD';
}
