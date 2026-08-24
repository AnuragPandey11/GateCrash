import { Client, type IMessage, type StompSubscription } from '@stomp/stompjs';
import type { UserRole } from '@gatecrash/core';
import { parseFrame, type RealtimeFrame } from './frames';
import { destinationsFor, type SubscriptionContext } from './subscriptions';
import { useConnectionStore } from './status';

/**
 * The connection manager — FRONTEND.md §6.3.
 *
 * One instance per app, owned by a provider. Three behaviours here are deliberate and easy to
 * get wrong by accident:
 *
 *  1. **We drive reconnection, not stompjs.** `reconnectDelay: 0` disables its internal loop so
 *     the backoff below is honest — otherwise two schedulers race and the "1s → 30s" curve is
 *     a fiction.
 *  2. **A refused CONNECT is a credential problem, not a network one.** The interceptor rejects
 *     a stale token, and retrying a stale token forever is a hot loop that never succeeds. So a
 *     STOMP-level error refreshes the access token *once* and retries; only transport-level
 *     failures go to backoff.
 *  3. **The token is read at connect time**, never captured at construction — by the time we
 *     reconnect, the token we were built with is likely the one that just expired.
 */

export type ConnectionTransport =
  | { kind: 'sockjs'; factory: () => WebSocket }
  | { kind: 'native'; brokerUrl: string };

export interface RealtimeClientOptions {
  transport: ConnectionTransport;
  /** Read fresh on every CONNECT. Return null to stay disconnected. */
  getAccessToken: () => string | null;
  /** Single-flight refresh from `SessionManager`. Called at most once per connect failure. */
  refreshAccessToken: () => Promise<unknown>;
  onFrame: (frame: RealtimeFrame) => void;
  /** Fired after every successful (re)connect, so screens can reconcile over REST (§6.5). */
  onReconnect?: () => void;
  /** Overridable for tests. */
  now?: () => number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}

const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;
const HEARTBEAT_MS = 10_000;

/** Exponential backoff with jitter, capped — §6.3. Exported so the test can assert the curve. */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const exponential = Math.min(BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1), MAX_DELAY_MS);
  // Full jitter over the lower half: a township full of tablets reconnecting after a wifi blip
  // must not arrive in a synchronised thundering herd.
  return Math.round(exponential * (0.5 + random() * 0.5));
}

export class RealtimeClient {
  private readonly options: RealtimeClientOptions;
  private client: Client | null = null;
  private subscriptions = new Map<string, StompSubscription>();
  private desired: string[] = [];
  private role: UserRole | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshedForThisAttempt = false;
  private stopped = true;

  constructor(options: RealtimeClientOptions) {
    this.options = options;
  }

  /**
   * Start (or restart) the connection for a role.
   *
   * Not called while the session is in `MUST_RESET_PASSWORD`: the interceptor refuses CONNECT
   * outright in that state, so attempting it would be a guaranteed failure loop (§5.1).
   */
  connect(role: UserRole, context: SubscriptionContext = {}): void {
    this.role = role;
    this.desired = destinationsFor(role, context);
    this.stopped = false;

    if (this.client?.connected) {
      this.reconcileSubscriptions();
      return;
    }
    this.open();
  }

  /** Change what we watch without dropping the socket — the guard switching gates. */
  updateContext(context: SubscriptionContext): void {
    if (!this.role) return;
    this.desired = destinationsFor(this.role, context);
    if (this.client?.connected) this.reconcileSubscriptions();
  }

  disconnect(): void {
    this.stopped = true;
    this.clearReconnectTimer();
    this.subscriptions.clear();
    const client = this.client;
    this.client = null;
    if (client) void client.deactivate();
    useConnectionStore.getState().setState('idle', null);
  }

  get connected(): boolean {
    return this.client?.connected ?? false;
  }

  private open(): void {
    const token = this.options.getAccessToken();
    if (!token) {
      useConnectionStore.getState().setState('offline', 'No access token');
      return;
    }

    useConnectionStore.getState().setState(this.client ? 'reconnecting' : 'connecting');

    const client = new Client({
      // Our loop, not theirs — see the note at the top of this file.
      reconnectDelay: 0,
      heartbeatIncoming: HEARTBEAT_MS,
      heartbeatOutgoing: HEARTBEAT_MS,
      connectHeaders: { Authorization: `Bearer ${token}` },
      ...(this.options.transport.kind === 'sockjs'
        ? { webSocketFactory: this.options.transport.factory as () => never }
        : { brokerURL: this.options.transport.brokerUrl }),
      onConnect: () => {
        this.refreshedForThisAttempt = false;
        useConnectionStore.getState().noteConnected();
        this.reconcileSubscriptions();
        // Reconciliation is mandatory (§6.5): frames that arrived while we were down are gone,
        // so the screens refetch rather than assuming they missed nothing.
        this.options.onReconnect?.();
      },
      onStompError: (frame) => {
        // The interceptor rejected us — almost always an expired token on CONNECT.
        void this.handleAuthFailure(frame.headers.message ?? 'Connection refused');
      },
      onWebSocketClose: () => {
        if (this.stopped) return;
        this.scheduleReconnect('Connection lost');
      },
      onWebSocketError: () => {
        if (this.stopped) return;
        useConnectionStore.getState().setState('reconnecting', 'Network error');
      },
    });

    this.client = client;
    this.subscriptions.clear();
    client.activate();
  }

  /**
   * A refused CONNECT gets exactly one refresh-and-retry.
   *
   * Looping on a refusal would hammer the server with a credential it has already rejected;
   * falling through to plain backoff would leave the user "reconnecting" forever with a token
   * that will never work again.
   */
  private async handleAuthFailure(reason: string): Promise<void> {
    if (this.stopped) return;

    if (this.refreshedForThisAttempt) {
      useConnectionStore.getState().setState('offline', reason);
      this.scheduleReconnect(reason);
      return;
    }

    this.refreshedForThisAttempt = true;
    try {
      await this.options.refreshAccessToken();
      this.restart();
    } catch {
      // The session is gone; the app's session-end handler will route to login. Nothing here
      // should keep retrying a dead credential.
      useConnectionStore.getState().setState('offline', 'Session expired');
      this.stopped = true;
    }
  }

  private restart(): void {
    const client = this.client;
    this.client = null;
    this.subscriptions.clear();
    if (client) void client.deactivate();
    if (!this.stopped) this.open();
  }

  private scheduleReconnect(reason: string): void {
    if (this.stopped || this.reconnectTimer) return;

    const status = useConnectionStore.getState();
    status.noteAttempt();
    const attempts = useConnectionStore.getState().attempts;
    status.setState(attempts > 3 ? 'offline' : 'reconnecting', reason);

    const setTimeoutFn = this.options.setTimeoutFn ?? setTimeout;
    this.reconnectTimer = setTimeoutFn(() => {
      this.reconnectTimer = null;
      if (!this.stopped) this.restart();
    }, backoffDelay(attempts));
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer === null) return;
    const clearTimeoutFn = this.options.clearTimeoutFn ?? clearTimeout;
    clearTimeoutFn(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  /** Add what is newly wanted, drop what is not — never tear the whole set down and rebuild it. */
  private reconcileSubscriptions(): void {
    const client = this.client;
    if (!client?.connected) return;

    for (const [destination, subscription] of this.subscriptions) {
      if (!this.desired.includes(destination)) {
        subscription.unsubscribe();
        this.subscriptions.delete(destination);
      }
    }

    for (const destination of this.desired) {
      if (this.subscriptions.has(destination)) continue;
      this.subscriptions.set(destination, client.subscribe(destination, this.handleMessage));
    }
  }

  private readonly handleMessage = (message: IMessage): void => {
    const frame = parseFrame(message.body);
    useConnectionStore.getState().noteMessage();
    // A frame we cannot parse is dropped, not thrown: one malformed message must not take down
    // a connection the gate console depends on. REST reconciliation will correct the screen.
    if (frame) this.options.onFrame(frame);
  };
}
