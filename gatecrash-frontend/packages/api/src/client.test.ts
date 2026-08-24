import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ApiClient } from './client';
import { ApiException, fieldErrorMap, isApiException } from './errors';
import { SessionExpired, SessionManager, type TokenStore } from './session';
import { apiError } from './mocks/fixtures';

const BASE = 'http://api.test';
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function store(access: string | null = 'at-0', refresh: string | null = 'rt-0'): TokenStore {
  let a = access;
  let r = refresh;
  return {
    getAccessToken: () => a,
    getRefreshToken: async () => r,
    setTokens: async (t) => {
      a = t.accessToken;
      r = t.refreshToken;
    },
    clear: async () => {
      a = null;
      r = null;
    },
  };
}

function build(tokens = store(), onSessionEnd?: () => void) {
  const session = new SessionManager({
    baseUrl: BASE,
    store: tokens,
    ...(onSessionEnd ? { onSessionEnd } : {}),
  });
  return { session, client: new ApiClient({ baseUrl: BASE, session }) };
}

const refreshedBody = {
  accessToken: 'at-refreshed',
  refreshToken: 'rt-refreshed',
  tokenType: 'Bearer',
  expiresInSeconds: 1800,
  mustResetPassword: false,
  role: 'ADMIN',
  userId: '11111111-1111-4111-8111-111111111111',
  fullName: 'Priya Nair',
};

describe('request basics', () => {
  it('sends the bearer and a correlation id', async () => {
    const seen: Record<string, string | null> = {};
    server.use(
      http.get(`${BASE}/api/v1/auth/me`, ({ request }) => {
        seen.auth = request.headers.get('Authorization');
        seen.correlation = request.headers.get('X-Correlation-Id');
        return HttpResponse.json({ ok: true });
      }),
    );

    const { client } = build();
    await client.get('auth/me');

    expect(seen.auth).toBe('Bearer at-0');
    expect(seen.correlation).toMatch(/.+/);
  });

  it('never attaches a bearer to an anonymous request', async () => {
    let auth: string | null = 'unset';
    server.use(
      http.post(`${BASE}/api/v1/auth/login`, ({ request }) => {
        auth = request.headers.get('Authorization');
        return HttpResponse.json({ ok: true });
      }),
    );

    const { client } = build();
    await client.post('auth/login', { json: { loginId: 'a', password: 'b' }, anonymous: true });

    expect(auth).toBeNull();
  });

  it('sends JSON bodies with the content type the server demands', async () => {
    let contentType: string | null = null;
    server.use(
      http.post(`${BASE}/api/v1/visits`, ({ request }) => {
        contentType = request.headers.get('Content-Type');
        return HttpResponse.json({ ok: true }, { status: 201 });
      }),
    );

    const { client } = build();
    await client.post('visits', { json: { visitorName: 'A' } });

    // Without this the backend answers 415 UNSUPPORTED_MEDIA_TYPE (§4.3.2).
    expect(contentType).toContain('application/json');
  });

  it('drops empty query params rather than sending `?status=`', async () => {
    let query = '';
    server.use(
      http.get(`${BASE}/api/v1/admin/visits`, ({ request }) => {
        query = new URL(request.url).search;
        return HttpResponse.json({ content: [] });
      }),
    );

    const { client } = build();
    await client.get('admin/visits', {
      searchParams: { status: undefined, visitorType: null, gateId: '', page: 0, size: 50 },
    });

    // A present-but-blank `status` binds to a VisitStatus and 400s as TYPE_MISMATCH.
    expect(query).not.toContain('status=');
    expect(query).toContain('page=0');
    expect(query).toContain('size=50');
  });

  it('resolves a 204 to undefined instead of choking on an empty body', async () => {
    server.use(http.delete(`${BASE}/api/v1/passes/x`, () => new HttpResponse(null, { status: 204 })));
    const { client } = build();
    await expect(client.delete('passes/x')).resolves.toBeUndefined();
  });
});

describe('errors', () => {
  it('normalises the envelope into an ApiException', async () => {
    server.use(
      http.patch(`${BASE}/api/v1/visits/x/decision`, () =>
        HttpResponse.json(apiError(409, 'CONFLICT', 'Already decided.'), { status: 409 }),
      ),
    );

    const { client } = build();
    const error = await client.patch('visits/x/decision', { json: {} }).catch((e) => e);

    expect(isApiException(error)).toBe(true);
    expect(error).toMatchObject({ code: 'CONFLICT', status: 409, correlationId: 'cid-0000-1111' });
    expect((error as ApiException).isConflict).toBe(true);
  });

  it('maps fieldErrors so a form can show them inline', async () => {
    server.use(
      http.post(`${BASE}/api/v1/admin/users`, () =>
        HttpResponse.json(
          apiError(400, 'VALIDATION_FAILED', 'Validation failed.', {
            fieldErrors: [
              { field: 'loginId', message: 'must match the pattern' },
              { field: 'phone', message: 'must be 7-15 digits' },
            ],
          }),
          { status: 400 },
        ),
      ),
    );

    const { client } = build();
    const error = await client.post('admin/users', { json: {} }).catch((e) => e);

    expect(fieldErrorMap(error)).toEqual({
      loginId: 'must match the pattern',
      phone: 'must be 7-15 digits',
    });
  });

  it('produces a coded exception even when there is no envelope to read', async () => {
    server.use(
      http.get(`${BASE}/api/v1/admin/inside`, () => new HttpResponse('<html>502</html>', { status: 502 })),
    );

    const { client } = build();
    const error = await client.get('admin/inside').catch((e) => e);

    expect(isApiException(error)).toBe(true);
    expect((error as ApiException).code).toBe('INTERNAL_ERROR');
    expect((error as ApiException).status).toBe(502);
  });

  it('reports a correlation id only where it helps — a 500, not a 409', async () => {
    const conflict = new ApiException({
      code: 'CONFLICT',
      status: 409,
      message: 'x',
      correlationId: 'cid',
    });
    const boom = new ApiException({
      code: 'INTERNAL_ERROR',
      status: 500,
      message: 'x',
      correlationId: 'cid',
    });

    expect(conflict.shouldShowCorrelationId).toBe(false);
    expect(boom.shouldShowCorrelationId).toBe(true);
  });

  it('routes PASSWORD_RESET_REQUIRED to the callback from any endpoint', async () => {
    server.use(
      http.get(`${BASE}/api/v1/admin/inside`, () =>
        HttpResponse.json(
          apiError(403, 'PASSWORD_RESET_REQUIRED', 'Password reset required.'),
          { status: 403 },
        ),
      ),
    );

    const onPasswordResetRequired = vi.fn();
    const session = new SessionManager({ baseUrl: BASE, store: store() });
    const client = new ApiClient({ baseUrl: BASE, session, onPasswordResetRequired });

    await client.get('admin/inside').catch(() => {});

    // PasswordResetEnforcementFilter guards every path, so this can arrive from anywhere (§5.4).
    expect(onPasswordResetRequired).toHaveBeenCalledOnce();
  });
});

describe('401 handling', () => {
  it('refreshes once and retries the original request', async () => {
    let attempts = 0;
    let refreshes = 0;
    server.use(
      http.get(`${BASE}/api/v1/auth/me`, ({ request }) => {
        attempts += 1;
        if (request.headers.get('Authorization') === 'Bearer at-refreshed') {
          return HttpResponse.json({ id: 'ok' });
        }
        return HttpResponse.json(apiError(401, 'UNAUTHORIZED', 'Expired.'), { status: 401 });
      }),
      http.post(`${BASE}/api/v1/auth/refresh`, () => {
        refreshes += 1;
        return HttpResponse.json(refreshedBody);
      }),
    );

    const { client } = build();
    await expect(client.get<{ id: string }>('auth/me')).resolves.toEqual({ id: 'ok' });

    expect(refreshes).toBe(1);
    expect(attempts).toBe(2);
  });

  it('gives up after one retry rather than looping', async () => {
    let attempts = 0;
    let refreshes = 0;
    server.use(
      http.get(`${BASE}/api/v1/auth/me`, () => {
        attempts += 1;
        return HttpResponse.json(apiError(401, 'UNAUTHORIZED', 'Expired.'), { status: 401 });
      }),
      http.post(`${BASE}/api/v1/auth/refresh`, () => {
        refreshes += 1;
        return HttpResponse.json(refreshedBody);
      }),
    );

    const { client } = build();
    const error = await client.get('auth/me').catch((e) => e);

    expect(attempts).toBe(2);
    expect(refreshes).toBe(1);
    expect((error as ApiException).code).toBe('UNAUTHORIZED');
  });

  it('fires exactly one refresh for concurrent 401s across different endpoints', async () => {
    let refreshes = 0;
    const authed = (request: Request) =>
      request.headers.get('Authorization') === 'Bearer at-refreshed';

    server.use(
      http.get(`${BASE}/api/v1/auth/me`, ({ request }) =>
        authed(request)
          ? HttpResponse.json({ id: 'me' })
          : HttpResponse.json(apiError(401, 'UNAUTHORIZED', 'Expired.'), { status: 401 }),
      ),
      http.get(`${BASE}/api/v1/admin/inside`, ({ request }) =>
        authed(request)
          ? HttpResponse.json({ insideCount: 0, visits: [] })
          : HttpResponse.json(apiError(401, 'UNAUTHORIZED', 'Expired.'), { status: 401 }),
      ),
      http.get(`${BASE}/api/v1/admin/gates`, ({ request }) =>
        authed(request)
          ? HttpResponse.json([])
          : HttpResponse.json(apiError(401, 'UNAUTHORIZED', 'Expired.'), { status: 401 }),
      ),
      http.post(`${BASE}/api/v1/auth/refresh`, async () => {
        refreshes += 1;
        return HttpResponse.json(refreshedBody);
      }),
    );

    const { client } = build();
    // The real scenario: a dashboard wakes up, three panels refetch, all three 401.
    await Promise.all([
      client.get('auth/me'),
      client.get('admin/inside'),
      client.get('admin/gates'),
    ]);

    expect(refreshes).toBe(1);
  });

  it('never refreshes on a 403 — that is authorisation, not authentication', async () => {
    let refreshes = 0;
    server.use(
      http.get(`${BASE}/api/v1/admin/inside`, () =>
        HttpResponse.json(apiError(403, 'FORBIDDEN', 'Not permitted.'), { status: 403 }),
      ),
      http.post(`${BASE}/api/v1/auth/refresh`, () => {
        refreshes += 1;
        return HttpResponse.json(refreshedBody);
      }),
    );

    const { client } = build();
    const error = await client.get('admin/inside').catch((e) => e);

    expect(refreshes).toBe(0);
    expect((error as ApiException).isForbidden).toBe(true);
  });

  it('surfaces a dead session when the refresh family has been revoked', async () => {
    server.use(
      http.get(`${BASE}/api/v1/auth/me`, () =>
        HttpResponse.json(apiError(401, 'UNAUTHORIZED', 'Expired.'), { status: 401 }),
      ),
      http.post(`${BASE}/api/v1/auth/refresh`, () =>
        HttpResponse.json(apiError(401, 'UNAUTHORIZED', 'Reuse detected.'), { status: 401 }),
      ),
    );

    const onSessionEnd = vi.fn();
    const { client } = build(store(), onSessionEnd);
    const error = await client.get('auth/me').catch((e) => e);

    expect(error).toBeInstanceOf(SessionExpired);
    expect(onSessionEnd).toHaveBeenCalledWith('REFRESH_FAILED');
  });
});

describe('error classification', () => {
  /**
   * These are the codes the *running* backend emits, read off its service classes — not the
   * generic set in FRONTEND.md §4.5's table. Services throw their own code at the same status
   * (`ConflictException(code, message)`), so classifying by `code` misses almost every real
   * conflict. Hence: classify by status, switch on code only for specific copy.
   */
  const at = (status: number, code: string) =>
    new ApiException({ code, status, message: 'x' });

  it.each([
    ['CONFLICT'],
    ['CONCURRENT_MODIFICATION'],
    ['ILLEGAL_TRANSITION'],
    ['FLAT_OCCUPIED'],
    ['BLOCK_NOT_EMPTY'],
    ['LOGIN_ID_TAKEN'],
    ['MAX_USES_EXCEEDED'],
  ])('treats a 409 %s as a conflict', (code) => {
    expect(at(409, code).isConflict).toBe(true);
  });

  it('treats an expired pass as gone and terminal, whatever the code says', () => {
    const expired = at(410, 'PASS_EXPIRED');
    expect(expired.isGone).toBe(true);
    expect(expired.isTerminal).toBe(true);
    expect(expired.isConflict).toBe(false);
  });

  it('recognises the 422 business-rule status §4.5 never mentions', () => {
    expect(at(422, 'AGENT_OFF_DUTY').isBusinessRule).toBe(true);
    expect(at(422, 'EMPTY_AUDIENCE').isBusinessRule).toBe(true);
    expect(at(409, 'CONFLICT').isBusinessRule).toBe(false);
  });

  it('treats the login failure code as an auth failure', () => {
    // The backend answers INVALID_CREDENTIALS, not UNAUTHORIZED, on a bad password.
    expect(at(401, 'INVALID_CREDENTIALS').isAuthFailure).toBe(true);
    expect(at(401, 'ACCOUNT_DISABLED').isAuthFailure).toBe(true);
  });

  it('keeps PASSWORD_RESET_REQUIRED out of the plain-forbidden bucket', () => {
    // It is a 403, but it means "go change your password", not "you may not do that".
    const reset = at(403, 'PASSWORD_RESET_REQUIRED');
    expect(reset.requiresPasswordReset).toBe(true);
    expect(reset.isForbidden).toBe(false);
    expect(at(403, 'FORBIDDEN').isForbidden).toBe(true);
  });

  it('maps an envelope-less 422 to a usable code', async () => {
    server.use(
      http.post(`${BASE}/api/v1/visits`, () => new HttpResponse('nope', { status: 422 })),
    );
    const { client } = build();
    const error = await client.post('visits', { json: {} }).catch((e) => e);
    expect((error as ApiException).code).toBe('UNPROCESSABLE');
  });
});
