import type { GateId, TownshipId, UserRole } from '@gatecrash/core';

/**
 * The subscription registry — FRONTEND.md §6.3.
 *
 * Subscriptions are declared *by role* so an unauthorised SUBSCRIBE can never be attempted. That
 * matters more than it looks: `StompAuthChannelInterceptor` throws `AccessDeniedException` on a
 * bad destination, and a thrown interceptor kills the **session**, not just the one subscription.
 * A stray subscribe therefore takes down the guard's whole gate console — so the client never
 * guesses, it looks the destinations up here.
 *
 * Destinations, and who the backend lets subscribe:
 *
 *   /user/queue/visits              any authenticated user (Spring rewrites it to self)
 *   /user/queue/notifications       any authenticated user
 *   /topic/gate/{gateId}            GUARD, ADMIN, SUPER_ADMIN — and only for a gate in the
 *                                   subscriber's own township
 *   /topic/admin/inside/{townshipId} ADMIN of that township, or SUPER_ADMIN
 *
 * **The occupancy topic carries the township id.** It used to be a single `/topic/admin/inside`,
 * which on a multi-tenant deployment would push every township's movements to every township's
 * dashboard — and no amount of client-side filtering fixes that, because the frame has already
 * left the server. Subscribing to the bare path now fails the interceptor, and a failed SUBSCRIBE
 * kills the session (see above), so this is not a soft migration: the id is required.
 *
 * Client→server SEND is rejected outright; there are no `@MessageMapping` endpoints. The socket
 * is read-only and every write is REST.
 */

export const USER_QUEUE_VISITS = '/user/queue/visits';
export const USER_QUEUE_NOTIFICATIONS = '/user/queue/notifications';
export const topicAdminInside = (townshipId: TownshipId | string) =>
  `/topic/admin/inside/${townshipId}`;
export const topicGate = (gateId: GateId | string) => `/topic/gate/${gateId}`;

export interface SubscriptionContext {
  /**
   * The township whose live feeds this screen is showing. For every role but SUPER_ADMIN it is the
   * session's own `townshipId`; for a super admin it is the township they have selected, and until
   * they select one there is nothing to subscribe to.
   */
  townshipId?: TownshipId | null;
  /** ADMIN: gates whose live feed the current screen wants. Usually empty on the web dashboard. */
  watchedGateIds?: readonly GateId[];
  /** GUARD: the gate this device is standing at. Nothing is subscribed until one is picked. */
  selectedGateId?: GateId | null;
  /**
   * The account carries the sales flag (an ADMIN or GUARD on the sales team). Sales is not a role
   * any more, so it adds the personal visit queue on top of whatever the role subscribes to —
   * that is where "meet a sales agent" requests arrive.
   */
  sales?: boolean;
}

/** An admin's occupancy feed, or nothing at all if no township is in context yet. */
const adminInside = (ctx: SubscriptionContext): string[] =>
  ctx.townshipId ? [topicAdminInside(ctx.townshipId)] : [];

export const SUBSCRIPTIONS: Record<UserRole, (ctx: SubscriptionContext) => string[]> = {
  // A super admin has no township of its own, so it subscribes to whichever one it is looking at
  // and to nothing before it has picked one.
  SUPER_ADMIN: (ctx) => [...adminInside(ctx), ...(ctx.watchedGateIds ?? []).map(topicGate)],
  ADMIN: (ctx) => [
    ...adminInside(ctx),
    ...(ctx.watchedGateIds ?? []).map(topicGate),
    USER_QUEUE_NOTIFICATIONS,
  ],
  // A guard with no gate picked subscribes to nothing — there is no "all gates" firehose, and
  // asking for one would be a rejected SUBSCRIBE that kills the session.
  GUARD: (ctx) => (ctx.selectedGateId ? [topicGate(ctx.selectedGateId)] : []),
  RESIDENT: () => [USER_QUEUE_VISITS, USER_QUEUE_NOTIFICATIONS],
};

export function destinationsFor(role: UserRole, ctx: SubscriptionContext = {}): string[] {
  const base = SUBSCRIPTIONS[role](ctx);
  // The sales flag only means anything on a staff role; the server refuses it elsewhere.
  const sales = ctx.sales && (role === 'ADMIN' || role === 'GUARD')
    ? [USER_QUEUE_VISITS, USER_QUEUE_NOTIFICATIONS]
    : [];
  // De-duplicate: an admin watching a gate twice would otherwise get every frame twice.
  return [...new Set([...base, ...sales])];
}

/**
 * Derive the WebSocket URL from the API URL — §4.1 and §6.2.
 *
 * `WebSocketConfig` registers `/ws` with `.withSockJS()` **only**, so the two platforms differ:
 *
 *   - **Web** connects through SockJS at `/ws` (pass a `webSocketFactory`).
 *   - **Mobile** has no SockJS-friendly environment, so it connects to SockJS's raw-websocket
 *     transport at `/ws/websocket`. That works today but is an implementation detail of SockJS,
 *     not a contract — §15.2 asks the backend for a plain `/ws-native` endpoint. Build against
 *     `/ws/websocket`, switch when it lands.
 */
export function sockJsUrl(apiUrl: string): string {
  return `${apiUrl.replace(/\/+$/, '')}/ws`;
}

export function nativeWebSocketUrl(apiUrl: string): string {
  const url = new URL('/ws/websocket', apiUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}
