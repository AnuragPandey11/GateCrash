import type { GateId, PropertyNodeId, TownshipId, UserId, VisitId } from '@gatecrash/core';
import type { PageArgs } from '../pagination';
import type { UserFilters, VisitFilters } from '../filters';

/**
 * The query key factory — FRONTEND.md §4.9.
 *
 * One place, or cache invalidation becomes folklore. Every key is a tuple whose *prefix* is
 * meaningful, so `invalidateQueries({ queryKey: ['admin', 'visits'] })` catches every filter
 * combination without enumerating them.
 *
 * This is also what the realtime frame dispatcher writes through (§6.4) — a frame arriving on the
 * socket updates the exact same cache entry REST filled, which is the whole reason the two layers
 * are complementary rather than two sources of truth.
 */
export const qk = {
  me: ['me'] as const,

  visits: {
    all: ['visits'] as const,
    pending: ['visits', 'pending'] as const,
    byGate: (gateId: GateId) => ['visits', 'gate', gateId] as const,
    one: (visitId: VisitId) => ['visits', visitId] as const,
  },

  passes: {
    all: ['passes'] as const,
    mine: (page: PageArgs) => ['passes', 'mine', page] as const,
  },

  inbox: {
    all: ['inbox'] as const,
    list: (page: PageArgs) => ['inbox', page] as const,
    unread: ['inbox', 'unread'] as const,
  },

  community: {
    all: ['community'] as const,
    list: (page: PageArgs) => ['community', page] as const,
  },

  admin: {
    all: ['admin'] as const,
    inside: ['admin', 'inside'] as const,
    visits: (filters: VisitFilters, page: PageArgs) => ['admin', 'visits', filters, page] as const,
    visitsAll: ['admin', 'visits'] as const,
    users: (filters: UserFilters, page: PageArgs) => ['admin', 'users', filters, page] as const,
    usersAll: ['admin', 'users'] as const,
    user: (id: UserId) => ['admin', 'users', 'one', id] as const,
    gates: ['admin', 'gates'] as const,

    // Property tree. `propertyAll` is the invalidation root: creating a node changes its parent's
    // child count and the level's node count as well as the list it landed in, so writes invalidate
    // the whole subtree of keys rather than trying to predict which lists moved.
    propertyAll: ['admin', 'property'] as const,
    propertyProfile: ['admin', 'property', 'profile'] as const,
    propertyTypes: ['admin', 'property', 'types'] as const,
    propertyNodes: (parentId?: PropertyNodeId | null, depth?: number | null) =>
      ['admin', 'property', 'nodes', parentId ?? 'any', depth ?? 'any'] as const,
    propertyOccupancy: ['admin', 'property', 'occupancy'] as const,
    notifications: (page: PageArgs) => ['admin', 'notifications', page] as const,
    notificationsAll: ['admin', 'notifications'] as const,
  },

  /**
   * Platform (SUPER_ADMIN). Kept under its own prefix rather than beside `admin` because these are
   * the only keys whose data is *not* scoped to the acting township — invalidating `admin` on a
   * township switch must not blow away the township list itself.
   */
  platform: {
    all: ['platform'] as const,
    townships: (page: PageArgs, includeArchived: boolean) =>
      ['platform', 'townships', page, includeArchived] as const,
    townshipsAll: ['platform', 'townships'] as const,
    // Static reference data, readable before any township exists.
    propertyTypes: ['platform', 'property-types'] as const,
    township: (id: TownshipId) => ['platform', 'townships', 'one', id] as const,
    townshipAdmins: (id: TownshipId) => ['platform', 'townships', id, 'admins'] as const,
    superAdmins: ['platform', 'admins'] as const,
  },

  salesOnDuty: ['sales', 'on-duty'] as const,
  devices: ['devices'] as const,
} as const;
