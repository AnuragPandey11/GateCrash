/**
 * `X-Correlation-Id` — FRONTEND.md §4.3.3 and §11.3.
 *
 * The backend's `CorrelationIdFilter` honours an incoming id and echoes it on the response (the
 * CORS config exposes the header). One UUID per request, surfaced in error toasts, is how a
 * support ticket becomes a log line.
 */
export const CORRELATION_HEADER = 'X-Correlation-Id';

export function correlationId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  // No `crypto.randomUUID` (older Safari, a non-secure origin). Uniqueness here only needs to be
  // good enough to correlate one request with one log line, so a weak fallback is acceptable.
  return `gc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
