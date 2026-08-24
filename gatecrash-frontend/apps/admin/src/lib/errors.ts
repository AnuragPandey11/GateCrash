import { type ApiException, isApiException, isSessionExpired } from '@gatecrash/api';
import type { TFunction } from 'i18next';
import { toast } from './toast';

/**
 * Turning an `ApiException` into something a human should read — FRONTEND.md §4.5 and §11.
 *
 * The rule is that we switch on `code`, never on `message`: `message` is human text from the
 * server, it is not localised, and it will change. `code` is the contract.
 *
 * Server messages are shown only where they add something the code cannot — a validation
 * message naming a constraint, for instance. For everything else the localised copy wins,
 * because "Could not execute statement" is not a sentence to put in front of an administrator.
 */

/**
 * Codes we have written localised copy for.
 *
 * Anything not in here falls through to the server's own `message`, which is English but always
 * a real sentence — a better outcome than a generic "something went wrong" that discards what
 * the server actually said. The set covers every code an *admin* can reach; the gate-side ones
 * (`AMBIGUOUS_REDEMPTION`, `NO_RESIDENT`) will matter when the mobile app lands.
 */
const CODE_KEYS = new Set([
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
  'INTERNAL_ERROR',
  'METHOD_NOT_ALLOWED',
  'UNSUPPORTED_MEDIA_TYPE',
  'UNPROCESSABLE',
  'INVALID_CREDENTIALS',
  'ACCOUNT_DISABLED',
  'INVALID_REFRESH_TOKEN',
  'REFRESH_TOKEN_REUSED',
  'ILLEGAL_TRANSITION',
  'LOGIN_ID_TAKEN',
  'EMAIL_TAKEN',
  'PHONE_TAKEN',
  'BLOCK_EXISTS',
  'BLOCK_NOT_EMPTY',
  'FLAT_EXISTS',
  'FLAT_OCCUPIED',
  'GATE_EXISTS',
  'CANNOT_DEACTIVATE_SELF',
  'WEAK_PASSWORD',
  'EMPTY_AUDIENCE',
  'AUDIENCE_REQUIRED',
  'ROLES_REQUIRED',
  'IDS_REQUIRED',
  'INVALID_URL',
  'TOO_MANY_DEVICES',
  'PASS_EXPIRED',
  'PASS_NOT_REDEEMABLE',
  'MAX_USES_EXCEEDED',
  'AGENT_OFF_DUTY',
]);

export function errorMessage(error: unknown, t: TFunction): string {
  if (isSessionExpired(error)) return t('errors.UNAUTHORIZED');

  if (isApiException(error)) {
    if (error.code === 'NETWORK_ERROR') return t('errors.network');
    if (error.code === 'CONTRACT_VIOLATION') return error.message;

    // 422 business rules are the one place the server's own message beats ours. It carries the
    // *specific* reason — "Password must not contain your login id", "that audience matches
    // nobody" — which no code-keyed string can reproduce, and which is the only thing that tells
    // the user what to change. Unlocalised, and worth it.
    if (error.isBusinessRule && error.message) return error.message;

    if (CODE_KEYS.has(error.code)) {
      return t(`errors.${error.code}` as 'errors.CONFLICT');
    }
    return error.message || t('errors.generic');
  }

  return t('errors.generic');
}

/**
 * The standard failed-mutation surface: a toast that keeps the form filled (§11.1).
 *
 * Field-level failures are deliberately *not* toasted — they belong on the field, via
 * `applyFieldErrors`. A toast saying "please correct the highlighted fields" on top of fields
 * that are already highlighted is noise.
 */
export function toastError(error: unknown, t: TFunction, fallbackTitle?: string): void {
  if (isApiException(error) && error.code === 'VALIDATION_FAILED' && error.fieldErrors.length > 0) {
    return;
  }

  const correlationId =
    isApiException(error) && error.shouldShowCorrelationId ? error.correlationId : null;

  toast.error(fallbackTitle ?? t('errors.title'), errorMessage(error, t), correlationId);
}

/**
 * Map `fieldErrors[].field` onto React Hook Form errors (§11.1).
 *
 * The server names fields exactly as the DTO does, which is exactly how the Zod schemas name
 * them — so the mapping is direct. A field the form does not have (a server-only constraint)
 * falls back to the form-level error rather than being silently dropped.
 */
export function applyFieldErrors(
  error: unknown,
  setError: (name: string, err: { type: string; message: string }) => void,
  knownFields: readonly string[],
): boolean {
  if (!isApiException(error) || error.fieldErrors.length === 0) return false;

  let applied = false;
  for (const fieldError of error.fieldErrors) {
    const target = knownFields.includes(fieldError.field) ? fieldError.field : 'root';
    setError(target, { type: 'server', message: fieldError.message });
    applied = true;
  }
  return applied;
}

/** `409` is a first-class outcome, not a crash (§11.2). */
export function isConflict(error: unknown): error is ApiException {
  return isApiException(error) && error.isConflict;
}

/**
 * A delete blocked by a foreign key comes back as a 409 — usually with a specific code like
 * `FLAT_OCCUPIED` or `BLOCK_NOT_EMPTY`. §8.8 wants that rendered as "This flat has residents or
 * visit history and can't be removed" rather than "Error 409".
 *
 * Where the server gave us a specific code we already have copy for, that wins: it is more
 * precise than the caller's generic in-use text.
 */
export function conflictMessage(error: unknown, whenInUse: string, t: TFunction): string {
  if (!isConflict(error)) return errorMessage(error, t);
  return CODE_KEYS.has(error.code) ? errorMessage(error, t) : whenInUse;
}
