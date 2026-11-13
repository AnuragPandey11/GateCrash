import { qk, type OccupancyResponse, type VisitResponse } from '@gatecrash/api';
import type { QueryClient } from '@tanstack/react-query';
import type { RealtimeFrame } from './frames';

/**
 * Frames → query cache — FRONTEND.md §6.4.
 *
 * Components never subscribe to STOMP directly. A frame lands here, mutates the exact cache
 * entries REST already fills, and the screens re-render because their queries changed. That is
 * what makes the two layers complementary rather than two competing sources of truth.
 *
 * The pattern throughout is **`setQueryData` then `invalidateQueries`, in that order**:
 * `setQueryData` gives the instant optic (the guard's card flips green in milliseconds), and the
 * invalidation fetches the authoritative record a beat later. Postgres is always the truth; the
 * optimistic write is only ever a head start on it.
 */

export interface DispatcherOptions {
  /** Side effects that are not cache writes: a toast, a haptic, a sound. */
  onEvent?: (frame: RealtimeFrame) => void;
}

export function createFrameDispatcher(qc: QueryClient, options: DispatcherOptions = {}) {
  return function dispatch(frame: RealtimeFrame): void {
    switch (frame.type) {
      case 'VISIT_REQUESTED': {
        // Resident/sales: someone is at the gate for them. The frame carries no phone number or
        // photo, so we refetch rather than synthesising a half-populated card (§6.1).
        void qc.invalidateQueries({ queryKey: qk.visits.pending });
        break;
      }

      case 'VISIT_DECIDED':
      case 'VISIT_EXPIRED': {
        const status = frame.type === 'VISIT_DECIDED' ? frame.status : 'EXPIRED';
        qc.setQueryData<VisitResponse>(qk.visits.one(frame.visitId), (old) =>
          old
            ? {
                ...old,
                status,
                ...(frame.type === 'VISIT_DECIDED'
                  ? { decidedAt: frame.decidedAt, approverName: frame.decidedByName }
                  : {}),
              }
            : old,
        );
        void qc.invalidateQueries({ queryKey: qk.visits.byGate(frame.gateId) });
        void qc.invalidateQueries({ queryKey: qk.visits.one(frame.visitId) });
        // A resident who decided on another device should see it leave their pending list.
        void qc.invalidateQueries({ queryKey: qk.visits.pending });
        break;
      }

      case 'OCCUPANCY_CHANGED': {
        qc.setQueryData<OccupancyResponse>(qk.admin.inside, (old) =>
          old ? { ...old, insideCount: frame.insideCount } : old,
        );
        // The count is instant; the visitor grid needs the real rows.
        void qc.invalidateQueries({ queryKey: qk.admin.inside });
        void qc.invalidateQueries({ queryKey: qk.admin.visitsAll });
        break;
      }

      case 'ANNOUNCEMENT': {
        void qc.invalidateQueries({ queryKey: qk.inbox.unread });
        void qc.invalidateQueries({ queryKey: qk.inbox.all });
        break;
      }

      case 'OVERSTAY_ALERT':
      case 'VISIT_EXTENDED': {
        // The gate feed and the household history both show the overstay flag and exit time.
        void qc.invalidateQueries({ queryKey: qk.visits.all });
        void qc.invalidateQueries({ queryKey: qk.admin.inside });
        break;
      }

      case 'SERVICE_UPDATE': {
        // Keys from `service-hooks.ts` — the first segment is enough to refresh every page of them.
        // RULE/STAFF roots come from `rules-staff-hooks.ts`; a VISIT update is a walk-in a society
        // rule let in, which belongs in the household's history.
        const root = (
          {
            TICKET: 'tickets',
            MOVE: 'moves',
            BOOKING: 'bookings',
            RULE: 'rules',
            STAFF: 'staff',
            VISIT: 'visits',
          } as Record<string, string | undefined>
        )[frame.kind];
        if (root) void qc.invalidateQueries({ queryKey: [root] });
        break;
      }
    }

    options.onEvent?.(frame);
  };
}

/**
 * Reconciliation after a (re)connect or a foreground — FRONTEND.md §6.5, guardrail #7.
 *
 * Frames that arrived while the socket was down are gone; nothing replays them. So every live
 * surface refetches from its REST reconciliation endpoint instead of assuming it missed nothing.
 * Tested explicitly (§12.1) because a screen that only works when the socket is healthy is a
 * screen that will be wrong at a gate at 2am and nobody will know why.
 */
export function reconcile(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: qk.visits.pending });
  void qc.invalidateQueries({ queryKey: qk.visits.all });
  void qc.invalidateQueries({ queryKey: qk.admin.inside });
  void qc.invalidateQueries({ queryKey: qk.inbox.all });
}
