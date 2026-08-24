import type { GateId, UserRole } from '@gatecrash/core';

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
 *   /user/queue/visits          any authenticated user (Spring rewrites it to self)
 *   /user/queue/notifications   any authenticated user
 *   /topic/gate/{gateId}        GUARD, ADMIN
 *   /topic/admin/inside         ADMIN only
 *
 * Client→server SEND is rejected outright; there are no `@MessageMapping` endpoints. The socket
 * is read-only and every write is REST.
 */

export const USER_QUEUE_VISITS = '/user/queue/visits';
export const USER_QUEUE_NOTIFICATIONS = '/user/queue/notifications';
export const TOPIC_ADMIN_INSIDE = '/topic/admin/inside';
export const topicGate = (gateId: GateId | string) => `/topic/gate/${gateId}`;

export interface SubscriptionContext {
  /** ADMIN: gates whose live feed the current screen wants. Usually empty on the web dashboard. */
  watchedGateIds?: readonly GateId[];
  /** GUARD: the gate this device is standing at. Nothing is subscribed until one is picked. */
  selectedGateId?: GateId | null;
}

export const SUBSCRIPTIONS: Record<UserRole, (ctx: SubscriptionContext) => string[]> = {
  ADMIN: (ctx) => [
    TOPIC_ADMIN_INSIDE,
    ...(ctx.watchedGateIds ?? []).map(topicGate),
    USER_QUEUE_NOTIFICATIONS,
  ],
  // A guard with no gate picked subscribes to nothing — there is no "all gates" firehose, and
  // asking for one would be a rejected SUBSCRIBE that kills the session.
  GUARD: (ctx) => (ctx.selectedGateId ? [topicGate(ctx.selectedGateId)] : []),
  RESIDENT: () => [USER_QUEUE_VISITS, USER_QUEUE_NOTIFICATIONS],
  SALES: () => [USER_QUEUE_VISITS, USER_QUEUE_NOTIFICATIONS],
};

export function destinationsFor(role: UserRole, ctx: SubscriptionContext = {}): string[] {
  // De-duplicate: an admin watching a gate twice would otherwise get every frame twice.
  return [...new Set(SUBSCRIPTIONS[role](ctx))];
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
