import { differenceInSeconds, format, formatDistanceToNowStrict, parseISO } from 'date-fns';

/**
 * Wire-format helpers.
 *
 * Everything on the wire is Java `OffsetDateTime` — ISO-8601 *with an offset*. The rule that
 * matters: parse once, at the boundary, with `parseISO`; never do arithmetic on the string and
 * never hand a bare `YYYY-MM-DD` back to the server (Spring answers `TYPE_MISMATCH`).
 */

/** Parse an `OffsetDateTime` string. Returns null rather than an Invalid Date. */
export function parseInstant(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = parseISO(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Serialise for a query parameter or request body: ISO-8601 with the browser's offset.
 * `toISOString()` would emit `Z`, which is correct but silently reinterprets a value the admin
 * picked in local time — so we keep the offset explicit and visible.
 */
export function toOffsetDateTime(date: Date): string {
  return format(date, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

/**
 * `<input type="datetime-local">` gives a zone-less `2026-07-23T14:30`. Interpret it in the
 * browser's zone — which is what the admin meant — and stamp the offset on.
 */
export function datetimeLocalToOffset(value: string): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : toOffsetDateTime(parsed);
}

/** The inverse, for rehydrating a filter form from the URL. */
export function offsetToDatetimeLocal(value: string | null | undefined): string {
  const parsed = parseInstant(value);
  return parsed ? format(parsed, "yyyy-MM-dd'T'HH:mm") : '';
}

export function formatDateTime(value: string | null | undefined, fallback = '—'): string {
  const parsed = parseInstant(value);
  return parsed ? format(parsed, 'd MMM yyyy, HH:mm') : fallback;
}

export function formatTime(value: string | null | undefined, fallback = '—'): string {
  const parsed = parseInstant(value);
  return parsed ? format(parsed, 'HH:mm') : fallback;
}

export function formatRelative(value: string | null | undefined, fallback = '—'): string {
  const parsed = parseInstant(value);
  return parsed ? `${formatDistanceToNowStrict(parsed)} ago` : fallback;
}

/**
 * "1h 12m" — the occupancy board's "inside for" (§8.3).
 *
 * Computed from the server's `checkedInAt` against the current clock on every tick, never
 * accumulated in a client-side stopwatch: a backgrounded tab whose timers were throttled must
 * still show the truth when it comes back.
 */
export function formatDuration(fromIso: string | null | undefined, now: Date = new Date()): string {
  const from = parseInstant(fromIso);
  if (!from) return '—';
  const total = Math.max(0, differenceInSeconds(now, from));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours === 0 && minutes === 0) return 'just now';
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

/**
 * Remaining time against a deadline, as "4:32" — the guard's TTL countdown (§9.3) and the
 * lockout countdown (§5.6). Clamps at zero; negative time remaining is "0:00", not "-1:07".
 */
export function formatCountdown(secondsRemaining: number): string {
  const clamped = Math.max(0, Math.floor(secondsRemaining));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** Seconds left before a PENDING visit is swept, from its `createdAt` and the TTL. */
export function secondsUntilExpiry(
  createdAtIso: string | null | undefined,
  ttlMinutes: number,
  now: Date = new Date(),
): number {
  const createdAt = parseInstant(createdAtIso);
  if (!createdAt) return 0;
  return Math.max(0, ttlMinutes * 60 - differenceInSeconds(now, createdAt));
}
