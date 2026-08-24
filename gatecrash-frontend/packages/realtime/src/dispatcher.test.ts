import { qk, type OccupancyResponse, type VisitResponse } from '@gatecrash/api';
import { QueryClient } from '@tanstack/react-query';
import type { GateId, NotificationId, VisitId } from '@gatecrash/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFrameDispatcher, reconcile } from './dispatcher';
import { parseFrame, type RealtimeFrame } from './frames';

/**
 * Frame → cache tests — FRONTEND.md §12 ("Realtime" row): all five frame types, plus the
 * reconnect-triggers-reconciliation guarantee.
 */

const VISIT = '88888888-8888-4888-8888-888888888888' as VisitId;
const GATE = '55555555-5555-4555-8555-555555555555' as GateId;
const NOTIFICATION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as NotificationId;

const baseVisit = {
  id: VISIT,
  gateId: GATE,
  gateName: 'Main Gate',
  visitorName: 'Anjali Desai',
  visitorPhone: '+919876543210',
  visitorType: 'GUEST',
  vehicleNo: null,
  photoUrl: null,
  status: 'PENDING',
  approverKind: 'RESIDENT',
  approverId: null,
  approverName: null,
  targetFlatId: null,
  targetFlatNumber: 'A-101',
  preApprovalId: null,
  loggedByName: 'Gate Guard 1',
  createdAt: '2026-07-23T14:30:00+05:30',
  decidedAt: null,
  checkedInAt: null,
  checkedOutAt: null,
} as unknown as VisitResponse;

let qc: QueryClient;

beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

function invalidationSpy() {
  const keys: unknown[][] = [];
  vi.spyOn(qc, 'invalidateQueries').mockImplementation((filters) => {
    keys.push((filters?.queryKey ?? []) as unknown[]);
    return Promise.resolve();
  });
  return keys;
}

const sawKey = (keys: unknown[][], prefix: readonly unknown[]) =>
  keys.some((key) => prefix.every((part, i) => key[i] === part));

describe('VISIT_REQUESTED', () => {
  it('refetches the pending list rather than synthesising a half-populated card', () => {
    const keys = invalidationSpy();
    const dispatch = createFrameDispatcher(qc);

    dispatch({
      type: 'VISIT_REQUESTED',
      visitId: VISIT,
      gateId: GATE,
      gateName: 'Main Gate',
      visitorName: 'Anjali Desai',
      visitorType: 'GUEST',
      flatNumber: 'A-101',
      createdAt: '2026-07-23T14:30:00+05:30',
    });

    // The frame carries no phone number or photo (§6.1), so a card built from it alone would be
    // wrong. Invalidating fetches the real record.
    expect(sawKey(keys, qk.visits.pending)).toBe(true);
  });
});

describe('VISIT_DECIDED', () => {
  it('flips the cached visit instantly, then invalidates for the truth', () => {
    qc.setQueryData(qk.visits.one(VISIT), baseVisit);
    const dispatch = createFrameDispatcher(qc);

    dispatch({
      type: 'VISIT_DECIDED',
      visitId: VISIT,
      gateId: GATE,
      status: 'APPROVED',
      visitorName: 'Anjali Desai',
      decidedByName: 'Ravi Kumar',
      decidedAt: '2026-07-23T14:31:00+05:30',
    });

    // This is the sub-second optic the guard sees — the card flips green before the refetch lands.
    const cached = qc.getQueryData<VisitResponse>(qk.visits.one(VISIT));
    expect(cached?.status).toBe('APPROVED');
    expect(cached?.approverName).toBe('Ravi Kumar');
    expect(cached?.decidedAt).toBe('2026-07-23T14:31:00+05:30');
  });

  it('invalidates the gate feed and the pending list', () => {
    const keys = invalidationSpy();
    createFrameDispatcher(qc)({
      type: 'VISIT_DECIDED',
      visitId: VISIT,
      gateId: GATE,
      status: 'REJECTED',
      visitorName: 'Anjali Desai',
      decidedByName: 'Ravi Kumar',
      decidedAt: '2026-07-23T14:31:00+05:30',
    });

    expect(sawKey(keys, qk.visits.byGate(GATE))).toBe(true);
    // A resident who decided on their other device should see it leave this one's list.
    expect(sawKey(keys, qk.visits.pending)).toBe(true);
  });

  it('does not invent a cache entry for a visit it has never seen', () => {
    createFrameDispatcher(qc)({
      type: 'VISIT_DECIDED',
      visitId: VISIT,
      gateId: GATE,
      status: 'APPROVED',
      visitorName: 'Anjali Desai',
      decidedByName: 'Ravi Kumar',
      decidedAt: '2026-07-23T14:31:00+05:30',
    });

    // A frame carries display text only; a record fabricated from it would be missing the phone
    // number and photo the detail screen needs.
    expect(qc.getQueryData(qk.visits.one(VISIT))).toBeUndefined();
  });
});

describe('VISIT_EXPIRED', () => {
  it('marks the visit EXPIRED — the frame carries no status field of its own', () => {
    qc.setQueryData(qk.visits.one(VISIT), baseVisit);

    createFrameDispatcher(qc)({
      type: 'VISIT_EXPIRED',
      visitId: VISIT,
      gateId: GATE,
      visitorName: 'Anjali Desai',
    });

    expect(qc.getQueryData<VisitResponse>(qk.visits.one(VISIT))?.status).toBe('EXPIRED');
  });
});

describe('OCCUPANCY_CHANGED', () => {
  it('updates the count in place without flashing the board', () => {
    const occupancy: OccupancyResponse = { insideCount: 36, visits: [baseVisit] };
    qc.setQueryData(qk.admin.inside, occupancy);

    createFrameDispatcher(qc)({
      type: 'OCCUPANCY_CHANGED',
      visitId: VISIT,
      status: 'CHECKED_IN',
      visitorName: 'Suresh Iyer',
      gateName: 'Main Gate',
      insideCount: 37,
      at: '2026-07-23T14:32:00+05:30',
    });

    const cached = qc.getQueryData<OccupancyResponse>(qk.admin.inside);
    expect(cached?.insideCount).toBe(37);
    // The existing rows survive: replacing them would re-mount the grid and make the board
    // look broken on every entry (§8.3).
    expect(cached?.visits).toHaveLength(1);
  });
});

describe('ANNOUNCEMENT', () => {
  it('refreshes the unread badge and the inbox', () => {
    const keys = invalidationSpy();
    createFrameDispatcher(qc)({
      type: 'ANNOUNCEMENT',
      notificationId: NOTIFICATION,
      title: 'Water supply interruption',
      body: 'Water will be off in Block A.',
    });

    expect(sawKey(keys, qk.inbox.unread)).toBe(true);
    expect(sawKey(keys, qk.inbox.all)).toBe(true);
  });
});

describe('side effects', () => {
  it('hands every frame to onEvent for the toast/haptic layer', () => {
    const onEvent = vi.fn();
    const dispatch = createFrameDispatcher(qc, { onEvent });

    const frames: RealtimeFrame[] = [
      {
        type: 'VISIT_REQUESTED',
        visitId: VISIT,
        gateId: GATE,
        gateName: 'Main Gate',
        visitorName: 'A',
        visitorType: 'GUEST',
        flatNumber: null,
        createdAt: '2026-07-23T14:30:00+05:30',
      },
      { type: 'VISIT_EXPIRED', visitId: VISIT, gateId: GATE, visitorName: 'A' },
      {
        type: 'ANNOUNCEMENT',
        notificationId: NOTIFICATION,
        title: 't',
        body: 'b',
      },
    ];
    frames.forEach(dispatch);

    expect(onEvent).toHaveBeenCalledTimes(3);
  });
});

describe('reconcile', () => {
  it('refetches every live surface — the socket replays nothing (guardrail #7)', () => {
    const keys = invalidationSpy();
    reconcile(qc);

    expect(sawKey(keys, qk.visits.pending)).toBe(true);
    expect(sawKey(keys, qk.admin.inside)).toBe(true);
    expect(sawKey(keys, qk.inbox.all)).toBe(true);
  });
});

describe('parseFrame', () => {
  it('accepts each of the five frame types', () => {
    for (const type of [
      'VISIT_REQUESTED',
      'VISIT_DECIDED',
      'VISIT_EXPIRED',
      'OCCUPANCY_CHANGED',
      'ANNOUNCEMENT',
    ]) {
      expect(parseFrame(JSON.stringify({ type }))?.type).toBe(type);
    }
  });

  it('drops malformed and unknown frames instead of throwing', () => {
    // One bad message must not kill a connection the gate console depends on.
    expect(parseFrame('not json')).toBeNull();
    expect(parseFrame('null')).toBeNull();
    expect(parseFrame('{"type":"SOMETHING_NEW"}')).toBeNull();
    expect(parseFrame('{"visitId":"x"}')).toBeNull();
  });
});
