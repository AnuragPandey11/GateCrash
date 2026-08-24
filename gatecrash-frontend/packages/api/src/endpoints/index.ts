import type { ApiClient } from '../client';
import { authEndpoints } from './auth';
import { communityEndpoints } from './community';
import { deviceEndpoints } from './devices';
import { notificationEndpoints } from './notifications';
import { passEndpoints } from './passes';
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
  };
}

export type Endpoints = ReturnType<typeof createEndpoints>;

export {
  authEndpoints,
  communityEndpoints,
  deviceEndpoints,
  notificationEndpoints,
  passEndpoints,
  salesEndpoints,
  townshipEndpoints,
  adminUserEndpoints,
  adminVisitEndpoints,
  visitEndpoints,
};
