import { describe, expect, it } from 'vitest';
import { backoffDelay } from './client';
import { destinationsFor, nativeWebSocketUrl, sockJsUrl } from './subscriptions';
import type { GateId, TownshipId } from '@gatecrash/core';

const GATE_A = 'aaaa1111-1111-4111-8111-111111111111' as GateId;
const GATE_B = 'bbbb2222-2222-4222-8222-222222222222' as GateId;
const TOWNSHIP = 'cccc3333-3333-4333-8333-333333333333' as TownshipId;

describe('backoff', () => {
  it('climbs from ~1s and caps at 30s', () => {
    // `random` pinned to 1 so the jitter is at its maximum and the ceiling is observable.
    const max = (attempt: number) => backoffDelay(attempt, () => 1);
    expect(max(1)).toBe(1_000);
    expect(max(2)).toBe(2_000);
    expect(max(5)).toBe(16_000);
    expect(max(10)).toBe(30_000);
    expect(max(50)).toBe(30_000);
  });

  it('jitters over the lower half so tablets do not reconnect in lockstep', () => {
    // A township of gate tablets coming back after one wifi blip must not arrive together.
    expect(backoffDelay(4, () => 0)).toBe(4_000);
    expect(backoffDelay(4, () => 1)).toBe(8_000);
  });
});

describe('subscription registry', () => {
  it('gives a guard only their own gate', () => {
    expect(destinationsFor('GUARD', { selectedGateId: GATE_A })).toEqual([`/topic/gate/${GATE_A}`]);
  });

  it('subscribes a guard to nothing until a gate is picked', () => {
    // There is no "all gates" firehose; asking for one would be a rejected SUBSCRIBE, and a
    // rejected SUBSCRIBE kills the whole session rather than just that subscription.
    expect(destinationsFor('GUARD', { selectedGateId: null })).toEqual([]);
    expect(destinationsFor('GUARD', {})).toEqual([]);
  });

  it('gives an admin occupancy, their notifications and any watched gates', () => {
    expect(
      destinationsFor('ADMIN', { townshipId: TOWNSHIP, watchedGateIds: [GATE_A, GATE_B] }),
    ).toEqual([
      `/topic/admin/inside/${TOWNSHIP}`,
      `/topic/gate/${GATE_A}`,
      `/topic/gate/${GATE_B}`,
      '/user/queue/notifications',
    ]);
  });

  it('never subscribes to occupancy without a township in context', () => {
    // The bare `/topic/admin/inside` is not a destination any more; subscribing to it would be
    // refused by the interceptor, and a refused SUBSCRIBE takes the whole session down.
    const destinations = destinationsFor('ADMIN', {});
    expect(destinations).toEqual(['/user/queue/notifications']);
    expect(destinations.some((d) => d.startsWith('/topic/admin/inside'))).toBe(false);
  });

  it('gives a super admin nothing until it has picked a township to look at', () => {
    expect(destinationsFor('SUPER_ADMIN', {})).toEqual([]);
    expect(destinationsFor('SUPER_ADMIN', { townshipId: TOWNSHIP })).toEqual([
      `/topic/admin/inside/${TOWNSHIP}`,
    ]);
  });

  it('never routes a resident at a gate topic', () => {
    const destinations = destinationsFor('RESIDENT', { selectedGateId: GATE_A });
    expect(destinations).toEqual(['/user/queue/visits', '/user/queue/notifications']);
    expect(destinations.some((d) => d.startsWith('/topic/gate/'))).toBe(false);
  });

  it('adds the personal visit queue for a sales-flagged guard, on top of its gate', () => {
    expect(destinationsFor('GUARD', { selectedGateId: GATE_A, sales: true })).toEqual([
      `/topic/gate/${GATE_A}`,
      '/user/queue/visits',
      '/user/queue/notifications',
    ]);
    // The flag means nothing on a resident; it never widens their subscriptions.
    expect(destinationsFor('RESIDENT', { sales: true })).toEqual([
      '/user/queue/visits',
      '/user/queue/notifications',
    ]);
  });

  it('de-duplicates so a doubly-watched gate does not deliver every frame twice', () => {
    expect(
      destinationsFor('ADMIN', { townshipId: TOWNSHIP, watchedGateIds: [GATE_A, GATE_A] }),
    ).toHaveLength(3);
  });
});

describe('transport urls', () => {
  it('uses SockJS on the web, at the endpoint the backend actually registers', () => {
    expect(sockJsUrl('https://api.example.com')).toBe('https://api.example.com/ws');
    expect(sockJsUrl('https://api.example.com/')).toBe('https://api.example.com/ws');
  });

  it("swaps the scheme for mobile's raw-websocket transport", () => {
    // `/ws/websocket` is a SockJS internal, not a contract — §15.2 tracks replacing it.
    expect(nativeWebSocketUrl('https://api.example.com')).toBe('wss://api.example.com/ws/websocket');
    expect(nativeWebSocketUrl('http://localhost:8080')).toBe('ws://localhost:8080/ws/websocket');
  });
});
