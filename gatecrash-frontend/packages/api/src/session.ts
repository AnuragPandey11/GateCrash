import type { UserId } from '@gatecrash/core';
import { ApiException, networkException, toApiException } from './errors';
import { correlationId, CORRELATION_HEADER } from './correlation';

/**
 * Session lifecycle — FRONTEND.md §5.
 *
 * Two rules here are load-bearing and both are guardrails (§14):
 *
 *  1. **The access token is never persisted** (#1). It lives in a module-scoped variable and dies
 *     with the tab. An XSS then has to stay resident to keep stealing rather than lifting a
 *     30-minute bearer out of `localStorage` for free. A reload silently refreshes instead.
 *  2. **Only ever one `/auth/refresh` in flight** (#5). Refresh tokens are one-time use and reuse
 *     revokes the *entire family* server-side — so two concurrent 401s that each fire a refresh
 *     do not race, they log the user out. `refreshOnce` serialises them onto one promise.
 */

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  /** From `LoginResponse.expiresInSeconds`. Used for proactive refresh, never for authorisation. */
  expiresInSeconds: number;
}

/**
 * The shape a platform provides. Web stores the refresh token in `localStorage`; mobile will
 * implement the same interface over `expo-secure-store`. Async throughout because the mobile
 * keychain is.
 */
export interface TokenStore {
  getAccessToken(): string | null;
  getRefreshToken(): Promise<string | null>;
  setTokens(tokens: Tokens): Promise<void>;
  clear(): Promise<void>;
}

/** The single `localStorage` key this app owns. */
export const REFRESH_TOKEN_KEY = 'gc.rt';

/** Thrown when there is nothing left to refresh with. The app must route to login. */
export class SessionExpired extends Error {
  constructor(message = 'Session expired') {
    super(message);
    this.name = 'SessionExpired';
  }
}

export function createWebTokenStore(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null = globalThis.localStorage ?? null,
): TokenStore {
  let accessToken: string | null = null;

  return {
    getAccessToken: () => accessToken,

    async getRefreshToken() {
      try {
        return storage?.getItem(REFRESH_TOKEN_KEY) ?? null;
      } catch {
        // Safari in private mode throws on storage access. Treat it as "no session" rather
        // than crashing the boot path.
        return null;
      }
    },

    async setTokens(tokens) {
      accessToken = tokens.accessToken;
      try {
        storage?.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
      } catch {
        // Session survives in memory for this tab; a reload will land on login.
      }
    },

    async clear() {
      accessToken = null;
      try {
        storage?.removeItem(REFRESH_TOKEN_KEY);
      } catch {
        /* nothing to do */
      }
    },
  };
}

/** Everything `POST /auth/login`, `/auth/refresh` and `/auth/password` return. */
export interface LoginResponseLike extends Tokens {
  tokenType: string;
  mustResetPassword: boolean;
  role: string;
  userId: string;
  fullName: string;
}

export type SessionEndReason = 'LOGOUT' | 'REFRESH_FAILED' | 'REFRESH_MISSING' | 'REVOKED';

export interface SessionManagerOptions {
  baseUrl: string;
  store: TokenStore;
  /** Called once when the session is unrecoverable. The app clears its cache and routes to login. */
  onSessionEnd?: (reason: SessionEndReason) => void;
}

export class SessionManager {
  private readonly baseUrl: string;
  private readonly store: TokenStore;
  private readonly onSessionEnd: (reason: SessionEndReason) => void;

  /** The single in-flight refresh. Everything else awaits this exact promise (§5.3). */
  private inFlight: Promise<Tokens> | null = null;
  private expiresAt: number | null = null;
  private currentUserId: UserId | null = null;

  constructor({ baseUrl, store, onSessionEnd }: SessionManagerOptions) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.store = store;
    this.onSessionEnd = onSessionEnd ?? (() => {});
  }

  getAccessToken(): string | null {
    return this.store.getAccessToken();
  }

  getUserId(): UserId | null {
    return this.currentUserId;
  }

  hasRefreshToken(): Promise<boolean> {
    return this.store.getRefreshToken().then(Boolean);
  }

  /**
   * The stored refresh token, for the one caller that legitimately needs it: `POST /auth/logout`,
   * which revokes exactly this token's family. It is never logged, never rendered, and never put
   * on a query string (§14.3).
   */
  getRefreshToken(): Promise<string | null> {
    return this.store.getRefreshToken();
  }

  /**
   * Adopt a fresh token pair.
   *
   * Used for login *and* for `POST /auth/password`, which revokes every refresh token and returns
   * a brand-new `LoginResponse`. Forgetting that second case signs the user out immediately after
   * they change their password, which reads as a broken app (§5.3).
   */
  async adopt(response: LoginResponseLike): Promise<void> {
    await this.store.setTokens(response);
    this.expiresAt = Date.now() + response.expiresInSeconds * 1000;
    this.currentUserId = response.userId as UserId;
  }

  /** Within `marginSeconds` of expiry — the cue for a proactive refresh on foreground (§5.3). */
  isAccessTokenNearExpiry(marginSeconds = 120): boolean {
    if (this.expiresAt === null) return this.store.getAccessToken() === null;
    return Date.now() >= this.expiresAt - marginSeconds * 1000;
  }

  /**
   * Refresh, at most once concurrently.
   *
   * Every caller that arrives while a refresh is running awaits the *same* promise, so N
   * concurrent 401s produce exactly one `/auth/refresh` — asserted directly in
   * `session.test.ts`, because getting this wrong is silent until it logs someone out mid-shift.
   */
  async refreshOnce(): Promise<Tokens> {
    if (this.inFlight) return this.inFlight;

    this.inFlight = (async () => {
      const refreshToken = await this.store.getRefreshToken();
      if (!refreshToken) {
        this.endSession('REFRESH_MISSING');
        throw new SessionExpired('No refresh token');
      }

      let response: Response;
      try {
        response = await fetch(`${this.baseUrl}/api/v1/auth/refresh`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            [CORRELATION_HEADER]: correlationId(),
          },
          // No bearer, ever, on /auth/refresh (§5.3).
          body: JSON.stringify({ refreshToken }),
        });
      } catch (cause) {
        // A network blip is not a dead session — keep the refresh token so the next attempt
        // (or the next page load) can still recover.
        throw networkException(cause);
      }

      if (!response.ok) {
        const error = await toApiException(response);
        // 401 here means the token was rotated away or the family was revoked by a reuse.
        // Anything else (500, 429) leaves the session alone to be retried.
        if (error.status === 401 || error.status === 403) {
          this.endSession('REFRESH_FAILED');
          throw new SessionExpired(error.message);
        }
        throw error;
      }

      const body = (await response.json()) as LoginResponseLike;
      // Persist the NEW refresh token *before* resolving: a caller that starts its retry while
      // the old token is still stored would send a revoked one and take the family down.
      await this.adopt(body);
      return body;
    })().finally(() => {
      this.inFlight = null;
    });

    return this.inFlight;
  }

  /** Local teardown. The `POST /auth/logout` call is the caller's job (see `endSessionRemote`). */
  async clear(): Promise<void> {
    await this.store.clear();
    this.expiresAt = null;
    this.currentUserId = null;
  }

  private endSession(reason: SessionEndReason): void {
    void this.clear();
    this.onSessionEnd(reason);
  }
}

export function isSessionExpired(error: unknown): error is SessionExpired {
  return error instanceof SessionExpired;
}

/** True when the failure means "stop retrying and sign out". */
export function endsSession(error: unknown): boolean {
  return isSessionExpired(error) || (error instanceof ApiException && error.isAuthFailure);
}
