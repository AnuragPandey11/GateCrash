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
  setMe: (me: MeResponse) => void;
  setUnauthenticated: (reason?: string | null) => void;
  setLoading: () => void;
}

export const useSessionStore = create<SessionStore>((set) => ({
  state: 'loading',
  me: null,
  endedReason: null,

  setMe: (me) =>
    set({
      me,
      state: me.mustResetPassword ? 'mustResetPassword' : 'authenticated',
      endedReason: null,
    }),

  setUnauthenticated: (reason = null) =>
    set({ state: 'unauthenticated', me: null, endedReason: reason }),

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
    store.setMe(await endpoints.auth.me());
  } catch {
    // A dead refresh token on boot is the ordinary "came back a month later" case, not an error
    // worth showing. Land on login quietly.
    store.setUnauthenticated();
  }
}

export async function signOut(): Promise<void> {
  await runLogout({
    client: apiClient,
    queryClient,
    // Web push is opt-in and off by default (§7.3), so there is normally no device to
    // de-register here. When the settings toggle lands, its device id is passed through.
    deviceId: null,
  });
  useSessionStore.getState().setUnauthenticated();
}
