/**
 * The error envelope — FRONTEND.md §4.5.
 *
 * `GlobalExceptionHandler` and the security filters return one shape for every failure. This
 * module normalises it into a single `ApiException` so nothing above `packages/api` ever
 * inspects a raw `Response`, and so every call site switches on `code` — the machine-readable
 * field — rather than pattern-matching `message`, which is human text and will change.
 */

export interface ApiFieldError {
  field: string;
  message: string;
}

export interface ApiErrorBody {
  timestamp: string;
  status: number;
  error: string;
  code: string;
  message: string;
  path: string;
  correlationId: string | null;
  fieldErrors?: ApiFieldError[] | null;
}

/**
 * Codes the backend emits.
 *
 * The generic set comes from `GlobalExceptionHandler` and the security filters. On top of it,
 * **services throw their own specific codes at the same HTTP statuses** — `ConflictException`,
 * `GoneException` and friends all take an optional `code`. So `ILLEGAL_TRANSITION`,
 * `FLAT_OCCUPIED` and `LOGIN_ID_TAKEN` are all 409s that are *not* literally `"CONFLICT"`.
 *
 * That is why the classification helpers below key off **status**, not off this list: a handler
 * matching `code === 'CONFLICT'` would silently miss most conflicts that actually happen. Use
 * `code` for specific per-case copy; use the helpers for "what kind of failure is this".
 */
export const API_ERROR_CODES = [
  // Generic — GlobalExceptionHandler and the security filters
  'VALIDATION_FAILED',
  'MALFORMED_BODY',
  'MISSING_PARAMETER',
  'TYPE_MISMATCH',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'PASSWORD_RESET_REQUIRED',
  'NOT_FOUND',
  'CONFLICT',
  'CONCURRENT_MODIFICATION',
  'GONE',
  'TOO_MANY_REQUESTS',
  'METHOD_NOT_ALLOWED',
  'UNSUPPORTED_MEDIA_TYPE',
  'UNPROCESSABLE',
  'INTERNAL_ERROR',

  // Service-specific. 401:
  'INVALID_CREDENTIALS',
  'INVALID_REFRESH_TOKEN',
  'REFRESH_TOKEN_REUSED',
  'ACCOUNT_DISABLED',
  'NOT_AUTHENTICATED',
  // 409:
  'ILLEGAL_TRANSITION',
  'LOGIN_ID_TAKEN',
  'EMAIL_TAKEN',
  'PHONE_TAKEN',
  'BLOCK_EXISTS',
  'BLOCK_NOT_EMPTY',
  'FLAT_EXISTS',
  'FLAT_OCCUPIED',
  'GATE_EXISTS',
  'MAX_USES_EXCEEDED',
  'PASS_NOT_REDEEMABLE',
  'CANNOT_DEACTIVATE_SELF',
  // 410:
  'PASS_EXPIRED',
  // 422 (BusinessValidationException) — a status §4.5's table does not mention at all:
  'AGENT_OFF_DUTY',
  'AUDIENCE_REQUIRED',
  'EMPTY_AUDIENCE',
  'IDS_REQUIRED',
  'ROLES_REQUIRED',
  'WEAK_PASSWORD',
  'FLAT_REQUIRED',
  'FLAT_NOT_ALLOWED',
  'LOGIN_ID_REQUIRED',
  'SALES_AGENT_REQUIRED',
  'TARGET_FLAT_REQUIRED',
  'NOT_A_SALES_AGENT',
  'NO_RESIDENT',
  'AMBIGUOUS_REDEMPTION',
  'INVALID_URL',
  'INVALID_WINDOW',
  'WINDOW_TOO_LONG',
  'TOO_MANY_DEVICES',
  'NOT_YET_VALID',
  'SALES_NOT_ALLOWED_FOR_ROLE',
  'POST_BODY_EMPTY',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** Anything the network or a proxy produced, where there is no envelope to read. */
export const NETWORK_ERROR_CODE = 'NETWORK_ERROR';
/** A response that parsed but did not match its Zod schema (§4.2) — a contract drift, our bug. */
export const CONTRACT_VIOLATION_CODE = 'CONTRACT_VIOLATION';

export class ApiException extends Error {
  readonly code: string;
  readonly status: number;
  readonly fieldErrors: ApiFieldError[];
  readonly correlationId: string | null;
  readonly path: string | null;

  constructor(init: {
    code: string;
    status: number;
    message: string;
    fieldErrors?: ApiFieldError[] | null;
    correlationId?: string | null;
    path?: string | null;
    cause?: unknown;
  }) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = 'ApiException';
    this.code = init.code;
    this.status = init.status;
    this.fieldErrors = init.fieldErrors ?? [];
    this.correlationId = init.correlationId ?? null;
    this.path = init.path ?? null;
  }

  /**
   * "Someone else acted first", or "that would break a rule the DB enforces" — §11.2 treats both
   * as normal outcomes rather than crashes.
   *
   * Keyed off the **status**, deliberately: services throw `ILLEGAL_TRANSITION`,
   * `FLAT_OCCUPIED`, `LOGIN_ID_TAKEN` and others as 409s, so a `code === 'CONFLICT'` test would
   * miss almost every conflict that actually happens.
   */
  get isConflict(): boolean {
    return this.status === 409;
  }

  /** Terminal — an expired pass. The UI offers a next action rather than a dead end (§9.3). */
  get isGone(): boolean {
    return this.status === 410;
  }

  /**
   * `BusinessValidationException` — 422. A rule the request violated that no single field owns
   * ("no sales agent is on duty", "that audience resolves to nobody"). The server's message is
   * the useful part here, so it is worth showing.
   */
  get isBusinessRule(): boolean {
    return this.status === 422;
  }

  /** The session is dead; the app must route to login. */
  get isAuthFailure(): boolean {
    return this.code === 'UNAUTHORIZED' || this.status === 401;
  }

  /** Authorisation, not authentication. Never refresh in response to this (§5.3). */
  get isForbidden(): boolean {
    return this.status === 403 && this.code !== 'PASSWORD_RESET_REQUIRED';
  }

  get requiresPasswordReset(): boolean {
    return this.code === 'PASSWORD_RESET_REQUIRED';
  }

  /**
   * Whether a correlation id is worth putting in front of the user. For a 409 or a validation
   * failure it is noise — the user caused it and can fix it. For a 500 it is the whole point:
   * support greps one string (§11.3).
   */
  get shouldShowCorrelationId(): boolean {
    return Boolean(this.correlationId) && (this.status >= 500 || this.code === 'INTERNAL_ERROR');
  }

  /** Retrying will not help and the caller should stop (§4.5: 403 is do-not-retry). */
  get isTerminal(): boolean {
    return this.isForbidden || this.isGone || this.status === 404;
  }
}

export function isApiException(error: unknown): error is ApiException {
  return error instanceof ApiException;
}

/** Convenience for `catch (e) { if (hasCode(e, 'CONFLICT')) … }`. */
export function hasErrorCode(error: unknown, ...codes: string[]): boolean {
  return isApiException(error) && codes.includes(error.code);
}

function looksLikeApiError(value: unknown): value is ApiErrorBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ApiErrorBody).code === 'string' &&
    typeof (value as ApiErrorBody).status === 'number'
  );
}

/**
 * Turn a non-2xx `Response` into an `ApiException`.
 *
 * A failure that has no readable envelope — a 502 from a load balancer, a CORS preflight
 * rejection surfacing as an opaque error — still has to produce something with a `code`, or
 * every call site grows a second "what if it isn't one of ours" branch.
 */
export async function toApiException(
  response: Response,
  fallbackCorrelationId?: string | null,
): Promise<ApiException> {
  const correlationHeader = response.headers.get('X-Correlation-Id') ?? fallbackCorrelationId ?? null;
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }

  if (looksLikeApiError(body)) {
    return new ApiException({
      code: body.code,
      status: body.status,
      message: body.message,
      fieldErrors: body.fieldErrors,
      // The body's own id wins: it is what was written to the server log line.
      correlationId: body.correlationId ?? correlationHeader,
      path: body.path,
    });
  }

  return new ApiException({
    code: statusToCode(response.status),
    status: response.status,
    message: response.statusText || `Request failed with status ${response.status}`,
    correlationId: correlationHeader,
  });
}

function statusToCode(status: number): string {
  switch (status) {
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 410:
      return 'GONE';
    case 422:
      return 'UNPROCESSABLE';
    case 429:
      return 'TOO_MANY_REQUESTS';
    default:
      return status >= 500 ? 'INTERNAL_ERROR' : 'UNKNOWN_ERROR';
  }
}

export function networkException(cause: unknown): ApiException {
  return new ApiException({
    code: NETWORK_ERROR_CODE,
    status: 0,
    message: cause instanceof Error ? cause.message : 'Network request failed',
    cause,
  });
}

/** Field errors keyed by field name, ready to feed React Hook Form's `setError` (§11.1). */
export function fieldErrorMap(error: unknown): Record<string, string> {
  if (!isApiException(error)) return {};
  const map: Record<string, string> = {};
  for (const fe of error.fieldErrors) {
    // First message wins: a field with two violations shows the first, not a concatenation.
    if (!(fe.field in map)) map[fe.field] = fe.message;
  }
  return map;
}
