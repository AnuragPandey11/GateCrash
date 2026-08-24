import ky, { HTTPError, type KyInstance, type Options } from 'ky';
import { ApiException, networkException, toApiException } from './errors';
import { CORRELATION_HEADER, correlationId } from './correlation';
import { SessionExpired, type SessionManager } from './session';

/**
 * The HTTP transport — FRONTEND.md §4.
 *
 * Nothing outside this package constructs a request to the backend (§3, enforced by the
 * `no-restricted-globals: fetch` lint rule). Centralising it is what makes all of these true
 * everywhere at once rather than per call site:
 *
 *  - a correlation id on every request (§4.3.3),
 *  - `Content-Type: application/json` on every body-bearing request, or the server answers 415,
 *  - one retry after a single-flight refresh on 401, and never a refresh on a 403 (§5.3),
 *  - every failure arriving as an `ApiException`, never a raw `Response` (§4.5).
 *
 * The surface is deliberately small — `get/post/patch/delete` returning parsed JSON — rather than
 * re-exporting ky. Endpoint modules should not be choosing retry policies or header sets.
 */

/** Marks a request we have already retried once, so a second 401 is a hard logout, not a loop. */
const RETRY_MARKER = 'X-Gc-Retried';

export type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  /** Serialised onto the query string; `null`/`undefined` entries are dropped, not sent empty. */
  searchParams?: Record<string, QueryValue | QueryValue[]>;
  /** Request body. Always sent as JSON with the correct `Content-Type`. */
  json?: unknown;
  signal?: AbortSignal;
  /**
   * Send without an `Authorization` header. Only `/auth/login` and `/auth/refresh` may set this
   * — a bearer on either is a §5.3 violation.
   */
  anonymous?: boolean;
}

export interface ApiClientOptions {
  /** e.g. `https://api.gatecrash.example` — no trailing `/api/v1`, that is added here. */
  baseUrl: string;
  session: SessionManager;
  /** Called when any endpoint answers `403 PASSWORD_RESET_REQUIRED` (§5.4). */
  onPasswordResetRequired?: () => void;
}

export class ApiClient {
  readonly baseUrl: string;
  readonly session: SessionManager;

  private readonly authed: KyInstance;
  private readonly anon: KyInstance;

  constructor({ baseUrl, session, onPasswordResetRequired }: ApiClientOptions) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.session = session;

    const shared: Options = {
      prefixUrl: `${this.baseUrl}/api/v1`,
      // ky's own retry would replay a 401 without refreshing, and would retry non-idempotent
      // mutations. Retrying is our job, exactly once, in the `afterResponse` hook below.
      retry: 0,
      timeout: 20_000,
      throwHttpErrors: true,
    };

    this.anon = ky.create({ ...shared, hooks: { beforeRequest: [stampCorrelationId] } });

    this.authed = ky.create({
      ...shared,
      hooks: {
        beforeRequest: [
          stampCorrelationId,
          (request) => {
            const token = session.getAccessToken();
            if (token) request.headers.set('Authorization', `Bearer ${token}`);
          },
        ],
        afterResponse: [
          async (request, _options, response) => {
            // Only 401 means "the bearer is stale". A 403 is authorisation and refreshing it
            // would be both pointless and a way to burn a one-time refresh token (§5.3).
            if (response.status !== 401) return response;
            if (request.headers.get(RETRY_MARKER)) return response;

            // Throws SessionExpired when the family is revoked; that propagates and the app
            // signs out, which is exactly right.
            await session.refreshOnce();

            const token = session.getAccessToken();
            if (!token) return response;

            const retried = request.clone();
            retried.headers.set('Authorization', `Bearer ${token}`);
            retried.headers.set(RETRY_MARKER, '1');
            // A retry is a new attempt and deserves its own correlation id, so support sees two
            // distinct log lines rather than one confusing duplicate.
            retried.headers.set(CORRELATION_HEADER, correlationId());
            return ky(retried, { retry: 0, throwHttpErrors: true });
          },
        ],
      },
    });

    this.onPasswordResetRequired = onPasswordResetRequired;
  }

  private readonly onPasswordResetRequired: (() => void) | undefined;

  get<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>('get', path, options);
  }

  post<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>('post', path, options);
  }

  patch<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>('patch', path, options);
  }

  put<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>('put', path, options);
  }

  /**
   * Most `DELETE`s here answer 204, but `DELETE /admin/users/{id}` deactivates and returns the
   * updated `UserResponse` — so this is generic, and resolves to `undefined` on a 204 body.
   */
  delete<T = void>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>('delete', path, options);
  }

  private async request<T>(
    method: 'get' | 'post' | 'patch' | 'put' | 'delete',
    path: string,
    options: RequestOptions,
  ): Promise<T> {
    const instance = options.anonymous ? this.anon : this.authed;
    // ky's `prefixUrl` refuses a leading slash — strip it so call sites can write either.
    const url = path.replace(/^\/+/, '');

    const kyOptions: Options = {};
    if (options.searchParams) kyOptions.searchParams = toSearchParams(options.searchParams);
    if (options.json !== undefined) kyOptions.json = options.json;
    if (options.signal) kyOptions.signal = options.signal;

    try {
      const response = await instance[method](url, kyOptions);
      return (await parseBody<T>(response)) as T;
    } catch (error) {
      throw await this.normalise(error);
    }
  }

  private async normalise(error: unknown): Promise<Error> {
    if (error instanceof ApiException || error instanceof SessionExpired) return error;

    if (error instanceof HTTPError) {
      const api = await toApiException(error.response);
      // §5.4: this can arrive from *any* endpoint, because `PasswordResetEnforcementFilter`
      // guards every path. The app force-navigates to the change-password screen on it.
      if (api.requiresPasswordReset) this.onPasswordResetRequired?.();
      return api;
    }

    if (error instanceof Error && error.name === 'TimeoutError') {
      return new ApiException({
        code: 'NETWORK_ERROR',
        status: 0,
        message: 'The server took too long to respond.',
        cause: error,
      });
    }

    if (error instanceof DOMException && error.name === 'AbortError') return error;

    return networkException(error);
  }
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  return new ApiClient(options);
}

function stampCorrelationId(request: Request): void {
  if (!request.headers.get(CORRELATION_HEADER)) {
    request.headers.set(CORRELATION_HEADER, correlationId());
  }
}

/**
 * Drop empty params rather than sending `?status=`.
 *
 * Spring binds a present-but-blank `status` to a `VisitStatus` and answers `TYPE_MISMATCH`, so an
 * "Any status" filter that serialised as an empty string would 400 instead of matching everything.
 */
function toSearchParams(params: Record<string, QueryValue | QueryValue[]>): URLSearchParams {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === undefined || item === null || item === '') continue;
        search.append(key, String(item));
      }
    } else {
      search.append(key, String(value));
    }
  }
  return search;
}

async function parseBody<T>(response: Response): Promise<T | undefined> {
  // 204 from every DELETE, and from POST /auth/logout.
  if (response.status === 204 || response.headers.get('Content-Length') === '0') return undefined;
  const contentType = response.headers.get('Content-Type') ?? '';
  if (!contentType.includes('json')) return undefined;
  const text = await response.text();
  return text ? (JSON.parse(text) as T) : undefined;
}
