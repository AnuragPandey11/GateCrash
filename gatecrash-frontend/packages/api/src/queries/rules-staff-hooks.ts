import type { EntryRuleStatus } from '@gatecrash/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateRuleBody, CreateStaffBody, RegisterHelpBody, RuleDecision } from '../endpoints/rules-staff';
import type { PageArgs } from '../pagination';
import { qk } from './keys';
import { useEndpoints } from './provider';

/**
 * Society rules and daily help & staff.
 *
 * Writes invalidate by prefix. Entry codes come back through the mutation result only and are
 * never written into the cache — they exist on screen once, to be handed to the helper.
 */

export const rk = {
  rules: ['rules'] as const,
  rulesMine: ['rules', 'mine'] as const,
  rulesAll: (status: EntryRuleStatus | null, page: PageArgs) => ['rules', 'all', status, page] as const,
  staff: ['staff'] as const,
  staffMine: ['staff', 'mine'] as const,
  staffDirectory: ['staff', 'directory'] as const,
  staffAll: ['staff', 'all'] as const,
  staffInside: ['staff', 'inside'] as const,
  staffHistory: (id: string, days: number) => ['staff', 'history', id, days] as const,
  staffDay: (date: string) => ['staff', 'day', date] as const,
} as const;

// ── Society rules ──────────────────────────────────────────────────────────────────────────────

export function useMyRules() {
  const api = useEndpoints();
  return useQuery({ queryKey: rk.rulesMine, queryFn: ({ signal }) => api.rules.mine(signal) });
}

export function useAllRules(status: EntryRuleStatus | null, page: PageArgs) {
  const api = useEndpoints();
  return useQuery({
    queryKey: rk.rulesAll(status, page),
    queryFn: ({ signal }) => api.rules.list(status, page, signal),
    placeholderData: (prev) => prev,
  });
}

export function useRequestRule() {
  const api = useEndpoints();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateRuleBody) => api.rules.request(body),
    onSettled: () => qc.invalidateQueries({ queryKey: rk.rules }),
  });
}

export function useCancelRule() {
  const api = useEndpoints();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.rules.cancel(id),
    onSettled: () => qc.invalidateQueries({ queryKey: rk.rules }),
  });
}

export function useDecideRule() {
  const api = useEndpoints();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; decision: RuleDecision; note?: string }) =>
      api.rules.decide(v.id, v.decision, v.note),
    onSettled: () => qc.invalidateQueries({ queryKey: rk.rules }),
  });
}

export function useRevokeRule() {
  const api = useEndpoints();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; note?: string }) => api.rules.revoke(v.id, v.note),
    onSettled: () => qc.invalidateQueries({ queryKey: rk.rules }),
  });
}

// ── Daily help & staff ─────────────────────────────────────────────────────────────────────────

export function useMyHelpers() {
  const api = useEndpoints();
  return useQuery({ queryKey: rk.staffMine, queryFn: ({ signal }) => api.staff.mine(signal) });
}

export function useStaffDirectory(enabled = true) {
  const api = useEndpoints();
  return useQuery({ queryKey: rk.staffDirectory, queryFn: ({ signal }) => api.staff.directory(signal), enabled });
}

export function useAllStaff() {
  const api = useEndpoints();
  return useQuery({ queryKey: rk.staffAll, queryFn: ({ signal }) => api.staff.list(signal) });
}

/** The gate's roll. Polled as a backstop: another guard's marks arrive within half a minute. */
export function useStaffInside() {
  const api = useEndpoints();
  return useQuery({
    queryKey: rk.staffInside,
    queryFn: ({ signal }) => api.staff.inside(signal),
    refetchInterval: 30_000,
  });
}

export function useStaffHistory(id: string | null, days = 30) {
  const api = useEndpoints();
  return useQuery({
    queryKey: rk.staffHistory(id ?? '', days),
    queryFn: ({ signal }) => api.staff.history(id as string, days, signal),
    enabled: id != null,
  });
}

export function useStaffDay(date: string) {
  const api = useEndpoints();
  return useQuery({ queryKey: rk.staffDay(date), queryFn: ({ signal }) => api.staff.attendanceOn(date, signal) });
}

function useStaffWrite<A, R>(fn: (a: A) => Promise<R>, alsoVisits = false) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: rk.staff });
      if (alsoVisits) void qc.invalidateQueries({ queryKey: qk.visits.all });
    },
  });
}

export function useRegisterHelper() {
  const api = useEndpoints();
  return useStaffWrite((body: RegisterHelpBody) => api.staff.register(body));
}

export function useLinkHelper() {
  const api = useEndpoints();
  return useStaffWrite((code: string) => api.staff.link(code));
}

export function useUnlinkHelper() {
  const api = useEndpoints();
  return useStaffWrite((id: string) => api.staff.unlink(id));
}

export function useRateHelper() {
  const api = useEndpoints();
  return useStaffWrite((v: { id: string; rating: number; review?: string }) => api.staff.rate(v.id, v.rating, v.review));
}

export function useCreateStaff() {
  const api = useEndpoints();
  return useStaffWrite((body: CreateStaffBody) => api.staff.create(body));
}

export function useReissueStaffCode() {
  const api = useEndpoints();
  return useStaffWrite((id: string) => api.staff.reissue(id));
}

export function useSetStaffActive() {
  const api = useEndpoints();
  return useStaffWrite((v: { id: string; active: boolean }) => api.staff.setActive(v.id, v.active));
}

/** Not cached: a lookup is a one-off read at the gate, and a stale card is worse than none. */
export function useStaffLookup() {
  const api = useEndpoints();
  return useMutation({ mutationFn: (by: { code: string } | { qrToken: string }) => api.staff.lookup(by) });
}

export function useStaffCheckIn() {
  const api = useEndpoints();
  return useStaffWrite((v: { id: string; gateId: string }) => api.staff.checkIn(v.id, v.gateId));
}

export function useStaffCheckOut() {
  const api = useEndpoints();
  return useStaffWrite((v: { id: string; gateId: string }) => api.staff.checkOut(v.id, v.gateId));
}
