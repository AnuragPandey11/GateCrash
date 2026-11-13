import {
  createApiClient,
  createQueryClient,
  createEndpoints,
  createWebTokenStore,
  logout as runLogout,
  SessionManager,
  type ApiClient,
  type MeResponse,
} from '@gatecrash/api';
import type { QueryClient } from '@tanstack/react-query';
import { create } from 'zustand';
import { API_URL } from './env';

/**
 * The session state machine — FRONTEND.md §5.1.
 *
 * Four states, and the backend can force three of them on us:
 *
 *   loading             → bootstrapping: refresh, then GET /auth/me
 *   unauthenticated     → no session; only /login renders
 *   mustResetPassword   → PasswordResetEnforcementFilter returns 403 for every path except
 *                         /auth/password, /auth/logout, /auth/refresh and /auth/me. STOMP CONNECT
 *                         is refused too. So exactly one screen renders and the socket stays down.
 *   authenticated       → normal operation
 *
 * `mustResetPassword` is not advisory, which is why it is a *state* here rather than a flag some
 * screens remember to check.
 */

export type SessionState =
  | 'loading'
  | 'unauthenticated'
  | 'mustResetPassword'
  | 'authenticated';

interface SessionStore {
  state: SessionState;
  me: MeResponse | null;
  /** Why the session ended, so the login screen can say something more useful than nothing. */
  endedReason: string | null;
  /**
   * The township a SUPER_ADMIN is currently acting inside.
   *
   * Null for every other role, and null for a super admin who has not picked one yet. It is read
   * per request by `ApiClient` and turned into the `X-Township-Id` header; for an ordinary account
   * the server ignores the question entirely and takes the township from the account row, so this
   * can never widen anyone's reach — it only tells the platform operator's requests where to land.
   */
  actingTownshipId: string | null;
  setMe: (me: MeResponse) => void;
  setActingTownship: (townshipId: string | null) => void;
  setUnauthenticated: (reason?: string | null) => void;
  setLoading: () => void;
}

/**
 * A platform operator's chosen township survives a page refresh.
 *
 * Kept per account (the key carries the user id), so two operators sharing a browser never inherit
 * each other's context, and cleared on an explicit sign-out. It is only a *preference*: the server
 * validates `X-Township-Id` on every request, and `bootstrapSession` re-checks that the township
 * still exists and is active before trusting it.
 */
const actingKey = (userId: string) => `gc.acting-township.${userId}`;

function readActing(userId: string): string | null {
  try {
    return localStorage.getItem(actingKey(userId));
  } catch {
    return null;
  }
}

function writeActing(userId: string, townshipId: string | null): void {
  try {
    if (townshipId) localStorage.setItem(actingKey(userId), townshipId);
    else localStorage.removeItem(actingKey(userId));
  } catch {
    // Private mode: the choice lasts for this tab only. Acceptable.
  }
}

export const useSessionStore = create<SessionStore>((set) => ({
  state: 'loading',
  me: null,
  endedReason: null,
  actingTownshipId: null,

  setMe: (me) =>
    set((prev) => ({
      me,
      state: me.mustResetPassword ? 'mustResetPassword' : 'authenticated',
      endedReason: null,
      // An ordinary account acts in its own township and nowhere else. Seeding it from `me` rather
      // than leaving it null keeps the value meaningful for the shell to display, while the client
      // still only sends the header when the session has no township of its own. A platform
      // operator keeps the township they had selected — in memory, or remembered from before a
      // refresh.
      actingTownshipId:
        me.townshipId ??
        (prev.me?.id === me.id ? prev.actingTownshipId : null) ??
        readActing(me.id),
    })),

  setActingTownship: (townshipId) =>
    set((state) => {
      if (state.me && !state.me.townshipId) writeActing(state.me.id, townshipId);
      return { actingTownshipId: townshipId };
    }),

  setUnauthenticated: (reason = null) =>
    set({ state: 'unauthenticated', me: null, endedReason: reason, actingTownshipId: null }),

  setLoading: () => set({ state: 'loading' }),
}));

/**
 * Build the singletons once, at module scope.
 *
 * They must outlive React's tree: a `SessionManager` recreated on a re-render would lose the
 * in-flight refresh promise, and two of those is exactly the concurrent-refresh bug guardrail #5
 * exists to prevent.
 */
export const queryClient: QueryClient = createQueryClient();

const tokenStore = createWebTokenStore();

export const sessionManager = new SessionManager({
  baseUrl: API_URL,
  store: tokenStore,
  onSessionEnd: () => {
    useSessionStore.getState().setUnauthenticated('errors.UNAUTHORIZED');
    queryClient.clear();
  },
});

export const apiClient: ApiClient = createApiClient({
  baseUrl: API_URL,
  session: sessionManager,
  // Read fresh on every request, so a super admin switching township in the console takes effect
  // on the very next call rather than after a reload.
  actingTownshipId: () => useSessionStore.getState().actingTownshipId,
  onPasswordResetRequired: () => {
    // Can arrive from *any* endpoint (§5.4). Flipping the state here is what force-navigates to
    // the change-password screen no matter which query tripped the filter.
    const store = useSessionStore.getState();
    if (store.me) store.setMe({ ...store.me, mustResetPassword: true });
  },
});

/** The typed endpoint surface, bound to the singleton client. */
export const endpoints = createEndpoints(apiClient);

/**
 * Boot — FRONTEND.md §5.4.
 *
 * With a refresh token present: `refresh()` → `GET /auth/me` → route by role and
 * `mustResetPassword`. Note what this deliberately does *not* do: decode the JWT. It is a
 * server-signed artefact, and parsing it client-side invites treating its claims as authority
 * (guardrail #2). Everything the shell needs is on `MeResponse`.
 */
export async function bootstrapSession(): Promise<void> {
  const store = useSessionStore.getState();

  if (!(await sessionManager.hasRefreshToken())) {
    store.setUnauthenticated();
    return;
  }

  try {
    await sessionManager.refreshOnce();
    const me = await endpoints.auth.me();
    // A remembered township is checked before it is trusted: one archived, suspended or deleted
    // since the last visit would otherwise land the operator on screens that all fail.
    if (!me.townshipId && !me.mustResetPassword) {
      const remembered = readActing(me.id);
      if (remembered) {
        try {
          const township = await endpoints.platform.getTownship(remembered as never);
          if (township.status !== 'ACTIVE') writeActing(me.id, null);
        } catch {
          writeActing(me.id, null);
        }
      }
    }
    store.setMe(me);
  } catch {
    // A dead refresh token on boot is the ordinary "came back a month later" case, not an error
    // worth showing. Land on login quietly.
    store.setUnauthenticated();
  }
}

export async function signOut(): Promise<void> {
  const me = useSessionStore.getState().me;
  if (me && !me.townshipId) writeActing(me.id, null);
  await runLogout({
    client: apiClient,
    queryClient,
    // Web push is opt-in and off by default (§7.3), so there is normally no device to
    // de-register here. When the settings toggle lands, its device id is passed through.
    deviceId: null,
  });
  useSessionStore.getState().setUnauthenticated();
}
