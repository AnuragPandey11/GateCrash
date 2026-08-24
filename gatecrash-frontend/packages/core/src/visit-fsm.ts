import type { Decision, VisitStatus } from './enums';

/**
 * The visit FSM — mirrors `VisitStatus.java` exactly (FRONTEND.md §10.2).
 *
 * The point of holding this in shared code is guardrail #9: never optimistically render a state
 * the FSM forbids. A button asks `canTransition(visit.status, 'CHECKED_IN')` rather than
 * hardcoding `status === 'APPROVED'`, so when the backend's map changes this changes with it —
 * in the same PR, in one file, instead of in six `disabled` props.
 *
 * Note that pass redemption skips `PENDING`/`APPROVED` entirely and mints a visit already
 * `CHECKED_IN`; that is a creation path, not a transition, so it does not appear here.
 */
export const VISIT_TRANSITIONS: Record<VisitStatus, readonly VisitStatus[]> = {
  PENDING: ['APPROVED', 'REJECTED', 'EXPIRED'],
  APPROVED: ['CHECKED_IN', 'EXPIRED'],
  CHECKED_IN: ['CHECKED_OUT'],
  REJECTED: [],
  EXPIRED: [],
  CHECKED_OUT: [],
};

export function canTransition(from: VisitStatus, to: VisitStatus): boolean {
  return VISIT_TRANSITIONS[from].includes(to);
}

/** No further transition is possible — the row is history. */
export function isTerminalVisitStatus(status: VisitStatus): boolean {
  return VISIT_TRANSITIONS[status].length === 0;
}

/** Still waiting on an approver, and therefore still racing the pending TTL. */
export function isAwaitingDecision(status: VisitStatus): boolean {
  return status === 'PENDING';
}

/** Counts toward occupancy. */
export function isInside(status: VisitStatus): boolean {
  return status === 'CHECKED_IN';
}

export function canCheckIn(status: VisitStatus): boolean {
  return canTransition(status, 'CHECKED_IN');
}

export function canCheckOut(status: VisitStatus): boolean {
  return canTransition(status, 'CHECKED_OUT');
}

export function canDecide(status: VisitStatus): boolean {
  return canTransition(status, 'APPROVED');
}

/** The status a decision produces, so an optimistic update never has to guess. */
export function statusForDecision(decision: Decision): VisitStatus {
  return decision;
}
