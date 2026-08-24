import { describe, expect, it } from 'vitest';
import { VISIT_STATUSES, type VisitStatus } from './enums';
import {
  VISIT_TRANSITIONS,
  canCheckIn,
  canCheckOut,
  canTransition,
  isInside,
  isTerminalVisitStatus,
} from './visit-fsm';

describe('visit FSM', () => {
  it('covers every status the server can send', () => {
    for (const status of VISIT_STATUSES) {
      expect(VISIT_TRANSITIONS[status]).toBeDefined();
    }
    expect(Object.keys(VISIT_TRANSITIONS).sort()).toEqual([...VISIT_STATUSES].sort());
  });

  it('refuses to skip approval on the way to CHECKED_IN', () => {
    // Mirrors VisitFsmTest#pendingCannotSkipToCheckedIn on the backend.
    expect(canTransition('PENDING', 'CHECKED_IN')).toBe(false);
    expect(canTransition('APPROVED', 'CHECKED_IN')).toBe(true);
  });

  it('treats rejection, expiry and check-out as terminal', () => {
    expect(isTerminalVisitStatus('REJECTED')).toBe(true);
    expect(isTerminalVisitStatus('EXPIRED')).toBe(true);
    expect(isTerminalVisitStatus('CHECKED_OUT')).toBe(true);
    expect(isTerminalVisitStatus('PENDING')).toBe(false);
  });

  it('never allows a transition out of a terminal state', () => {
    const terminal: VisitStatus[] = ['REJECTED', 'EXPIRED', 'CHECKED_OUT'];
    for (const from of terminal) {
      for (const to of VISIT_STATUSES) {
        expect(canTransition(from, to)).toBe(false);
      }
    }
  });

  it('gates the check-in and check-out buttons on the FSM, not on a hardcoded status', () => {
    expect(canCheckIn('APPROVED')).toBe(true);
    expect(canCheckIn('CHECKED_IN')).toBe(false);
    expect(canCheckOut('CHECKED_IN')).toBe(true);
    expect(canCheckOut('APPROVED')).toBe(false);
  });

  it('counts only CHECKED_IN toward occupancy', () => {
    expect(VISIT_STATUSES.filter(isInside)).toEqual(['CHECKED_IN']);
  });

  it('lets an APPROVED visit still expire — the guard may never check them in', () => {
    expect(canTransition('APPROVED', 'EXPIRED')).toBe(true);
  });
});
