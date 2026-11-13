import type { FlatId, GateId, UserRole, VisitStatus, VisitorType } from '@gatecrash/core';

/**
 * Filter shapes for the two searchable admin lists.
 *
 * These are the query-key inputs (§4.9) *and* the URL query string on `/visits` (§8.4), which is
 * why they are plain serialisable objects with no `undefined`-vs-absent ambiguity: an admin will
 * want to send a colleague a link to "all rejected visits at the service gate last Tuesday".
 */

export interface VisitFilters {
  status?: VisitStatus | null;
  visitorType?: VisitorType | null;
  /** True: only visitors who came to meet sales. False: only those who did not. Null: either. */
  meetSalesAgent?: boolean | null;
  gateId?: GateId | null;
  flatId?: FlatId | null;
  /** ISO-8601 **with offset**. A bare `2026-07-23` is rejected as `TYPE_MISMATCH` (§8.4). */
  from?: string | null;
  to?: string | null;
}

export interface UserFilters {
  role?: UserRole | null;
  /** Tri-state like `active`: only the sales team, only non-sales, or either. */
  sales?: boolean | null;
  active?: boolean | null;
  flatId?: FlatId | null;
  search?: string | null;
}

export function visitFilterParams(filters: VisitFilters): Record<string, string | undefined> {
  return {
    status: filters.status ?? undefined,
    visitorType: filters.visitorType ?? undefined,
    meetSalesAgent: filters.meetSalesAgent == null ? undefined : String(filters.meetSalesAgent),
    gateId: filters.gateId ?? undefined,
    flatId: filters.flatId ?? undefined,
    from: filters.from ?? undefined,
    to: filters.to ?? undefined,
  };
}

export function userFilterParams(filters: UserFilters): Record<string, string | boolean | undefined> {
  return {
    role: filters.role ?? undefined,
    sales: filters.sales ?? undefined,
    // `active` is a tri-state: true, false, or "either". `?? undefined` keeps `false` meaningful.
    active: filters.active ?? undefined,
    flatId: filters.flatId ?? undefined,
    search: filters.search?.trim() || undefined,
  };
}
