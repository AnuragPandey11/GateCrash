import { describe, expect, it } from 'vitest';
import {
  datetimeLocalToOffset,
  formatCountdown,
  formatDuration,
  offsetToDatetimeLocal,
  parseInstant,
  secondsUntilExpiry,
  toOffsetDateTime,
} from './format';

describe('parseInstant', () => {
  it('parses an OffsetDateTime with a non-UTC offset', () => {
    const parsed = parseInstant('2026-07-23T14:30:00+05:30');
    expect(parsed?.toISOString()).toBe('2026-07-23T09:00:00.000Z');
  });

  it('returns null rather than an Invalid Date', () => {
    expect(parseInstant('not-a-date')).toBeNull();
    expect(parseInstant(null)).toBeNull();
    expect(parseInstant(undefined)).toBeNull();
  });
});

describe('toOffsetDateTime', () => {
  it('emits an offset, never a bare date — Spring answers TYPE_MISMATCH to `2026-07-23`', () => {
    const serialised = toOffsetDateTime(new Date('2026-07-23T09:00:00Z'));
    expect(serialised).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/);
    expect(parseInstant(serialised)?.toISOString()).toBe('2026-07-23T09:00:00.000Z');
  });
});

describe('datetime-local round trip', () => {
  it('survives a trip through the filter form', () => {
    const offset = datetimeLocalToOffset('2026-07-23T14:30');
    expect(offset).not.toBeNull();
    expect(offsetToDatetimeLocal(offset)).toBe('2026-07-23T14:30');
  });

  it('treats an empty input as no filter', () => {
    expect(datetimeLocalToOffset('')).toBeNull();
    expect(offsetToDatetimeLocal(null)).toBe('');
  });
});

describe('formatDuration', () => {
  const now = new Date('2026-07-23T12:00:00Z');

  it('renders hours and minutes', () => {
    expect(formatDuration('2026-07-23T10:48:00Z', now)).toBe('1h 12m');
  });

  it('drops the hour when there is none', () => {
    expect(formatDuration('2026-07-23T11:45:00Z', now)).toBe('15m');
  });

  it('says "just now" under a minute instead of "0m"', () => {
    expect(formatDuration('2026-07-23T11:59:30Z', now)).toBe('just now');
  });

  it('clamps a future timestamp rather than rendering negative time', () => {
    expect(formatDuration('2026-07-23T12:30:00Z', now)).toBe('just now');
  });
});

describe('formatCountdown', () => {
  it('zero-pads the seconds', () => {
    expect(formatCountdown(272)).toBe('4:32');
    expect(formatCountdown(65)).toBe('1:05');
  });

  it('clamps at zero — an overdue visit shows 0:00, not -1:07', () => {
    expect(formatCountdown(-67)).toBe('0:00');
  });
});

describe('secondsUntilExpiry', () => {
  const now = new Date('2026-07-23T12:00:00Z');

  it('counts down the pending TTL from createdAt', () => {
    expect(secondsUntilExpiry('2026-07-23T11:56:00Z', 10, now)).toBe(360);
  });

  it('bottoms out at zero once the sweeper is due', () => {
    expect(secondsUntilExpiry('2026-07-23T11:40:00Z', 10, now)).toBe(0);
  });
});
