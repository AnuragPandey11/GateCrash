import { describe, expect, it } from 'vitest';
import type { BlockId, FlatId } from './ids';
import {
  audienceRuleKey,
  buildAudienceRule,
  describeAudienceRule,
  validateAudienceRule,
} from './audience';

const flat = (v: string) => v as FlatId;
const block = (v: string) => v as BlockId;

describe('buildAudienceRule', () => {
  it('drops lists the selected mode does not use', () => {
    // The admin picked flats, then switched to ROLES. The stale flatIds must not travel:
    // an audience nobody reviewed is exactly the blast the preview exists to prevent.
    const built = buildAudienceRule({
      mode: 'ROLES',
      roles: ['RESIDENT'],
      flatIds: [flat('f1'), flat('f2')],
      blockIds: [block('b1')],
    });
    expect(built).toEqual({ mode: 'ROLES', roles: ['RESIDENT'] });
    expect('flatIds' in built).toBe(false);
  });

  it('sends ALL with no lists at all', () => {
    expect(buildAudienceRule({ mode: 'ALL', roles: ['ADMIN'] })).toEqual({ mode: 'ALL' });
  });
});

describe('validateAudienceRule', () => {
  it('accepts ALL with nothing selected', () => {
    expect(validateAudienceRule({ mode: 'ALL' })).toBeNull();
  });

  it.each(['ROLES', 'ALL_EXCEPT'] as const)('requires at least one role for %s', (mode) => {
    expect(validateAudienceRule({ mode, roles: [] })).toBe('ROLES_REQUIRED');
    expect(validateAudienceRule({ mode, roles: ['GUARD'] })).toBeNull();
  });

  it('enforces the backend @Size caps', () => {
    expect(
      validateAudienceRule({ mode: 'FLATS', flatIds: Array.from({ length: 2001 }, (_, i) => flat(`f${i}`)) }),
    ).toBe('FLATS_TOO_MANY');
    expect(
      validateAudienceRule({ mode: 'BLOCKS', blockIds: Array.from({ length: 201 }, (_, i) => block(`b${i}`)) }),
    ).toBe('BLOCKS_TOO_MANY');
  });

  it('requires a selection for FLATS and BLOCKS', () => {
    expect(validateAudienceRule({ mode: 'FLATS', flatIds: [] })).toBe('FLATS_REQUIRED');
    expect(validateAudienceRule({ mode: 'BLOCKS', blockIds: [] })).toBe('BLOCKS_REQUIRED');
  });
});

describe('audienceRuleKey', () => {
  it('is stable across list reordering, so a still-accurate preview is not invalidated', () => {
    const a = audienceRuleKey({ mode: 'FLATS', flatIds: [flat('b'), flat('a')] });
    const b = audienceRuleKey({ mode: 'FLATS', flatIds: [flat('a'), flat('b')] });
    expect(a).toBe(b);
  });

  it('changes when the audience actually changes', () => {
    const before = audienceRuleKey({ mode: 'FLATS', flatIds: [flat('a')] });
    const after = audienceRuleKey({ mode: 'FLATS', flatIds: [flat('a'), flat('b')] });
    expect(before).not.toBe(after);
  });

  it('separates modes that carry no lists', () => {
    expect(audienceRuleKey({ mode: 'ALL' })).not.toBe(audienceRuleKey({ mode: 'ROLES', roles: [] }));
  });
});

describe('describeAudienceRule', () => {
  it('names a small selection', () => {
    const names = new Map([['f1', 'A-101']]);
    expect(
      describeAudienceRule({ mode: 'FLATS', flatIds: [flat('f1')] }, { flat: (id) => names.get(id) }),
    ).toBe('Flats: A-101');
  });

  it('falls back to a count rather than printing a raw UUID at an admin', () => {
    expect(describeAudienceRule({ mode: 'FLATS', flatIds: [flat('gone-1'), flat('gone-2')] })).toBe(
      'Flats: 2 flats',
    );
  });

  it('renders ALL as prose', () => {
    expect(describeAudienceRule({ mode: 'ALL' })).toBe('Everyone');
  });
});
