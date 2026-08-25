import type { ApiClient } from '../client';
import { authEndpoints } from './auth';
import { communityEndpoints } from './community';
import { deviceEndpoints } from './devices';
import { notificationEndpoints } from './notifications';
import { passEndpoints } from './passes';
import { platformEndpoints } from './platform';
import { salesEndpoints } from './sales';
import { townshipEndpoints } from './township';
import { adminUserEndpoints } from './users';
import { adminVisitEndpoints, visitEndpoints } from './visits';

/**
 * The whole API surface, grouped the way §4.8 groups it.
 *
 * One object per client instance, built once and handed to the query hooks — so a test can swap
 * the whole thing, and so nothing in `apps/*` ever holds a bare URL string.
 */
export function createEndpoints(client: ApiClient) {
  return {
    auth: authEndpoints(client),
    devices: deviceEndpoints(client),
    sales: salesEndpoints(client),
    visits: visitEndpoints(client),
    passes: passEndpoints(client),
    community: communityEndpoints(client),
    notifications: notificationEndpoints(client),
    users: adminUserEndpoints(client),
    adminVisits: adminVisitEndpoints(client),
    township: townshipEndpoints(client),
    // SUPER_ADMIN only. Present on every client because the role is decided at runtime; every one
    // of these answers 403 for anyone else, which is the check that counts.
    platform: platformEndpoints(client),
  };
}

export type Endpoints = ReturnType<typeof createEndpoints>;

export {
  authEndpoints,
  communityEndpoints,
  deviceEndpoints,
  notificationEndpoints,
  passEndpoints,
  platformEndpoints,
  salesEndpoints,
  townshipEndpoints,
  adminUserEndpoints,
  adminVisitEndpoints,
  visitEndpoints,
};
