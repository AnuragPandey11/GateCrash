import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionExpired, SessionManager, createWebTokenStore, type TokenStore } from './session';

/**
 * Session tests — FRONTEND.md §12 ("Session" row).
 *
 * The concurrent-401 test is the one the spec calls non-negotiable, and for a concrete reason:
 * refresh tokens are one-time use and reuse revokes the *entire family* server-side. A second
 * simultaneous refresh does not fail gracefully — it signs the user out, mid-shift, with no
 * error anyone can trace. The only defence is that exactly one request is ever in flight, so
 * that is asserted directly rather than inferred.
 */

function memoryStore(initialRefreshToken: string | null = 'rt-0'): TokenStore {
  let access: string | null = null;
  let refresh = initialRefreshToken;
  return {
    getAccessToken: () => access,
    getRefreshToken: async () => refresh,
    setTokens: async (tokens) => {
      access = tokens.accessToken;
      refresh = tokens.refreshToken;
    },
    clear: async () => {
      access = null;
      refresh = null;
    },
  };
}

function loginBody(overrides: Record<string, unknown> = {}) {
  return {
    accessToken: 'at-1',
    refreshToken: 'rt-1',
    tokenType: 'Bearer',
    expiresInSeconds: 1800,
    mustResetPassword: false,
    role: 'ADMIN',
    userId: '11111111-1111-4111-8111-111111111111',
    fullName: 'Priya Nair',
    ...overrides,
  };
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('single-flight refresh', () => {
  it('fires exactly one /auth/refresh for many concurrent callers', async () => {
    let resolveFetch: (value: Response) => void = () => {};
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const session = new SessionManager({ baseUrl: 'http://api.test', store: memoryStore() });

    // Ten screens all 401 at once — a dashboard waking from a locked laptop.
    const callers = Array.from({ length: 10 }, () => session.refreshOnce());
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch(
      new Response(JSON.stringify(loginBody()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const results = await Promise.all(callers);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Every caller gets the same rotated pair — nobody is left holding the revoked one.
    for (const result of results) {
      expect(result.accessToken).toBe('at-1');
      expect(result.refreshToken).toBe('rt-1');
    }
  });

  it('never attaches a bearer to /auth/refresh', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(loginBody()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const store = memoryStore();
    await store.setTokens({ accessToken: 'at-live', refreshToken: 'rt-0', expiresInSeconds: 1800 });
    const session = new SessionManager({ baseUrl: 'http://api.test', store });

    await session.refreshOnce();

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['X-Correlation-Id']).toBeTruthy();
  });

  it('allows a new refresh after the previous one settles', async () => {
    // A fresh Response per call: a body can only be read once, so a shared instance would fail
    // on the second refresh for reasons that have nothing to do with the code under test.
    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify(loginBody()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    const session = new SessionManager({ baseUrl: 'http://api.test', store: memoryStore() });

    await session.refreshOnce();
    await session.refreshOnce();

    // Serialised, not deduplicated forever: two sequential refreshes are two requests.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('persists the rotated refresh token before resolving', async () => {
    const store = memoryStore('rt-0');
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(loginBody({ refreshToken: 'rt-rotated' })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const session = new SessionManager({ baseUrl: 'http://api.test', store });

    await session.refreshOnce();

    // A caller resuming here must not find the old token still stored — sending it would be a
    // reuse and would take the whole family down.
    await expect(store.getRefreshToken()).resolves.toBe('rt-rotated');
  });
});

describe('refresh failure', () => {
  it('ends the session when the family has been revoked', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ status: 401, code: 'UNAUTHORIZED', message: 'Reuse detected.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const onSessionEnd = vi.fn();
    const store = memoryStore('rt-reused');
    const session = new SessionManager({ baseUrl: 'http://api.test', store, onSessionEnd });

    await expect(session.refreshOnce()).rejects.toBeInstanceOf(SessionExpired);
    expect(onSessionEnd).toHaveBeenCalledWith('REFRESH_FAILED');
    await expect(store.getRefreshToken()).resolves.toBeNull();
  });

  it('ends the session when there is nothing to refresh with', async () => {
    const onSessionEnd = vi.fn();
    const session = new SessionManager({
      baseUrl: 'http://api.test',
      store: memoryStore(null),
      onSessionEnd,
    });

    await expect(session.refreshOnce()).rejects.toBeInstanceOf(SessionExpired);
    expect(onSessionEnd).toHaveBeenCalledWith('REFRESH_MISSING');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the session alive through a network blip', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const onSessionEnd = vi.fn();
    const store = memoryStore('rt-0');
    const session = new SessionManager({ baseUrl: 'http://api.test', store, onSessionEnd });

    await expect(session.refreshOnce()).rejects.toThrow();
    // A dropped wifi is not a revoked token; the next attempt must still have something to try.
    expect(onSessionEnd).not.toHaveBeenCalled();
    await expect(store.getRefreshToken()).resolves.toBe('rt-0');
  });

  it('leaves the session alone when the server is merely broken', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ status: 500, code: 'INTERNAL_ERROR', message: 'boom' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const onSessionEnd = vi.fn();
    const session = new SessionManager({
      baseUrl: 'http://api.test',
      store: memoryStore('rt-0'),
      onSessionEnd,
    });

    await expect(session.refreshOnce()).rejects.toThrow();
    expect(onSessionEnd).not.toHaveBeenCalled();
  });
});

describe('adopt', () => {
  it('swaps in the tokens POST /auth/password returns', async () => {
    const store = memoryStore('rt-old');
    const session = new SessionManager({ baseUrl: 'http://api.test', store });

    // The §5.3 trap: changing a password revokes every refresh token and returns a new pair.
    // Not adopting it signs the user out the moment they succeed.
    await session.adopt(
      loginBody({ accessToken: 'at-new', refreshToken: 'rt-new' }) as never,
    );

    expect(session.getAccessToken()).toBe('at-new');
    await expect(store.getRefreshToken()).resolves.toBe('rt-new');
  });

  it('tracks expiry for proactive refresh', async () => {
    const session = new SessionManager({ baseUrl: 'http://api.test', store: memoryStore() });
    await session.adopt(loginBody({ expiresInSeconds: 1800 }) as never);

    expect(session.isAccessTokenNearExpiry(120)).toBe(false);
    // Within two minutes of expiry, the next foreground should refresh first.
    expect(session.isAccessTokenNearExpiry(1800)).toBe(true);
  });
});

describe('web token store', () => {
  it('keeps the access token out of storage entirely (guardrail #1)', async () => {
    const backing = new Map<string, string>();
    const storage = {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => void backing.set(k, v),
      removeItem: (k: string) => void backing.delete(k),
    };
    const store = createWebTokenStore(storage);

    await store.setTokens({ accessToken: 'at', refreshToken: 'rt', expiresInSeconds: 1800 });

    expect(store.getAccessToken()).toBe('at');
    expect([...backing.values()]).toEqual(['rt']);
    expect([...backing.values()]).not.toContain('at');
    expect([...backing.keys()]).toEqual(['gc.rt']);
  });

  it('survives storage that throws (Safari private mode)', async () => {
    const throwing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    const store = createWebTokenStore(throwing);

    await expect(store.getRefreshToken()).resolves.toBeNull();
    await expect(
      store.setTokens({ accessToken: 'at', refreshToken: 'rt', expiresInSeconds: 1 }),
    ).resolves.toBeUndefined();
    // The tab still works; a reload lands on login rather than crashing the boot path.
    expect(store.getAccessToken()).toBe('at');
  });
});
