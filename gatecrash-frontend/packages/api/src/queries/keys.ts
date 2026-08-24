import type { BlockId, GateId, UserId, VisitId } from '@gatecrash/core';
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
    blocks: ['admin', 'blocks'] as const,
    flats: (blockId?: BlockId | null) => ['admin', 'flats', blockId ?? 'all'] as const,
    flatsAll: ['admin', 'flats'] as const,
    gates: ['admin', 'gates'] as const,
    notifications: (page: PageArgs) => ['admin', 'notifications', page] as const,
    notificationsAll: ['admin', 'notifications'] as const,
  },

  salesOnDuty: ['sales', 'on-duty'] as const,
  devices: ['devices'] as const,
} as const;
