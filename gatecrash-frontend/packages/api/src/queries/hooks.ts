import type {
  AudienceRule,
  BlockId,
  Decision,
  FlatId,
  GateId,
  InboxItemId,
  PostId,
  UserId,
  VisitId,
} from '@gatecrash/core';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
  type UseQueryOptions,
} from '@tanstack/react-query';
import type { UserFilters, VisitFilters } from '../filters';
import { PAGE_DEFAULTS, type PageArgs } from '../pagination';
import type {
  CreateNotificationRequest,
  CreatePostRequest,
  CreateUserRequest,
  CreateVisitRequest,
  CreatedUserResponse,
  ResetPasswordResponse,
  UpdateUserRequest,
  UserResponse,
  VisitResponse,
} from '../schemas';
import { useEndpoints } from './provider';
import { qk } from './keys';

/**
 * Query hooks — the surface every screen actually consumes.
 *
 * Two conventions worth knowing before reading them:
 *
 *  - **Mutations invalidate by key prefix, never by hand-rolled key.** `qk.admin.visitsAll` is a
 *    prefix of every filtered page, so one invalidation refreshes them all.
 *  - **Nothing here caches a one-time secret.** `useCreateUser` and `useResetPassword` return
 *    their `generatedPassword` through the mutation result only; it never lands in the query
 *    cache, which would put it in devtools, in a persisted cache, and in a crash report (§14.3).
 */

type QueryOpts<T> = Omit<UseQueryOptions<T, Error, T, readonly unknown[]>, 'queryKey' | 'queryFn'>;

// ── Session ─────────────────────────────────────────────────────────────────────────────────

export function useMe(options?: QueryOpts<Awaited<ReturnType<ReturnType<typeof useEndpoints>['auth']['me']>>>) {
  const api = useEndpoints();
  return useQuery({
    queryKey: qk.me,
    queryFn: ({ signal }) => api.auth.me(signal),
    // The shell reads this constantly; it changes only on a duty toggle or a password change.
    staleTime: 5 * 60_000,
    ...options,
  });
}

// ── Occupancy (§8.3) ────────────────────────────────────────────────────────────────────────

export function useOccupancy() {
  const api = useEndpoints();
  return useQuery({
    queryKey: qk.admin.inside,
    queryFn: ({ signal }) => api.adminVisits.inside(signal),
    // The socket pushes OCCUPANCY_CHANGED; this interval is the belt to that braces, so a
    // silently dead socket still shows the truth within a minute (guardrail #7).
    refetchInterval: 60_000,
    staleTime: 0,
  });
}

// ── Visitor log (§8.4) ──────────────────────────────────────────────────────────────────────

export function useVisitSearch(filters: VisitFilters, page: PageArgs) {
  const api = useEndpoints();
  return useQuery({
    queryKey: qk.admin.visits(filters, page),
    queryFn: ({ signal }) => api.adminVisits.search(filters, page, signal),
    // Keeps the previous page rendered while the next loads, so paging does not flash empty.
    placeholderData: (previous) => previous,
  });
}

export function useVisit(id: VisitId | null | undefined, options?: { pollMs?: number }) {
  const api = useEndpoints();
  return useQuery({
    queryKey: qk.visits.one(id as VisitId),
    queryFn: ({ signal }) => api.visits.one(id as VisitId, signal),
    enabled: Boolean(id),
    // §9.3: the guard's awaiting screen polls while mounted rather than trusting the socket
    // alone. A hung spinner in front of a queue is not an acceptable failure mode.
    refetchInterval: options?.pollMs ?? false,
  });
}

export function usePendingVisits() {
  const api = useEndpoints();
  return useQuery({
    queryKey: qk.visits.pending,
    queryFn: ({ signal }) => api.visits.pending(signal),
    staleTime: 0,
  });
}

export function useGateFeed(gateId: GateId | null, limit = 50) {
  const api = useEndpoints();
  return useQuery({
    queryKey: qk.visits.byGate(gateId as GateId),
    queryFn: ({ signal }) => api.visits.byGate(gateId as GateId, limit, signal),
    enabled: Boolean(gateId),
  });
}

export function useDecideVisit() {
  const api = useEndpoints();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision }: { id: VisitId; decision: Decision }) => api.visits.decide(id, decision),
    onSuccess: (visit) => {
      qc.setQueryData(qk.visits.one(visit.id), visit);
      void qc.invalidateQueries({ queryKey: qk.visits.pending });
      void qc.invalidateQueries({ queryKey: qk.admin.visitsAll });
    },
    onError: () => {
      // A 409 means a flat-mate decided first — normal, not exceptional (§11.2). Refetching is
      // how the screen re-renders the truth instead of showing a red error.
      void qc.invalidateQueries({ queryKey: qk.visits.pending });
    },
  });
}

export function useCreateVisit() {
  const api = useEndpoints();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateVisitRequest) => api.visits.create(body),
    onSuccess: (visit) => {
      qc.setQueryData(qk.visits.one(visit.id), visit);
      void qc.invalidateQueries({ queryKey: qk.visits.byGate(visit.gateId) });
      void qc.invalidateQueries({ queryKey: qk.admin.visitsAll });
    },
  });
}

function useVisitTransition(fn: (id: VisitId) => Promise<VisitResponse>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (visit) => {
      qc.setQueryData(qk.visits.one(visit.id), visit);
      void qc.invalidateQueries({ queryKey: qk.visits.byGate(visit.gateId) });
      // Check-in and check-out both move the occupancy count.
      void qc.invalidateQueries({ queryKey: qk.admin.inside });
      void qc.invalidateQueries({ queryKey: qk.admin.visitsAll });
    },
  });
}

export function useCheckIn() {
  const api = useEndpoints();
  return useVisitTransition((id) => api.visits.checkIn(id));
}

export function useCheckOut() {
  const api = useEndpoints();
  return useVisitTransition((id) => api.visits.checkOut(id));
}

// ── Notifications (§8.5) ────────────────────────────────────────────────────────────────────

export function useNotificationHistory(page: PageArgs) {
  const api = useEndpoints();
  return useQuery({
    queryKey: qk.admin.notifications(page),
    queryFn: ({ signal }) => api.notifications.history(page, signal),
    placeholderData: (previous) => previous,
  });
}

/**
 * The audience preview.
 *
 * Keyed by the *rule*, so switching back to a rule already previewed is instant and the composer
 * can tell "resolved for the rule on screen" from "stale" without extra bookkeeping. Debouncing
 * is the caller's job (§8.5.3) — the hook only decides whether the request is enabled.
 */
export function useAudiencePreview(rule: AudienceRule, enabled: boolean) {
  const api = useEndpoints();
  return useQuery({
    queryKey: ['admin', 'audience-preview', rule] as const,
    queryFn: ({ signal }) => api.notifications.preview(rule, signal),
    enabled,
    staleTime: 30_000,
  });
}

export function useSendNotification() {
  const api = useEndpoints();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateNotificationRequest) => api.notifications.send(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.admin.notificationsAll });
    },
  });
}

export function useInbox(page: PageArgs = { page: 1, size: PAGE_DEFAULTS.inbox }) {
  const api = useEndpoints();
  return useQuery({
    queryKey: qk.inbox.list(page),
    queryFn: ({ signal }) => api.notifications.inbox(page, signal),
  });
}

export function useUnreadCount() {
  const api = useEndpoints();
  return useQuery({
    queryKey: qk.inbox.unread,
    queryFn: ({ signal }) => api.notifications.unreadCount(signal),
  });
}

export function useMarkRead() {
  const api = useEndpoints();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: InboxItemId) => api.notifications.markRead(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.inbox.all });
    },
  });
}

// ── Community (§8.6) ────────────────────────────────────────────────────────────────────────

export function useCommunityFeed(page: PageArgs) {
  const api = useEndpoints();
  return useQuery({
    queryKey: qk.community.list(page),
    queryFn: ({ signal }) => api.community.feed(page, signal),
    placeholderData: (previous) => previous,
  });
}

export function useCreatePost() {
  const api = useEndpoints();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePostRequest) => api.community.create(body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.community.all }),
  });
}

export function useDeletePost() {
  const api = useEndpoints();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: PostId) => api.community.remove(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.community.all }),
  });
}

// ── Users (§8.7) ────────────────────────────────────────────────────────────────────────────

export function useUsers(filters: UserFilters, page: PageArgs) {
  const api = useEndpoints();
  return useQuery({
    queryKey: qk.admin.users(filters, page),
    queryFn: ({ signal }) => api.users.list(filters, page, signal),
    placeholderData: (previous) => previous,
  });
}

/**
 * Returns `generatedPassword`. The result is deliberately **not** written to the query cache —
 * the caller reads it from the mutation result, shows it in the hand-off dialog, and lets it die
 * with the component (§14.3).
 */
export function useCreateUser(
  options?: UseMutationOptions<CreatedUserResponse, Error, CreateUserRequest>,
) {
  const api = useEndpoints();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateUserRequest) => api.users.create(body),
    ...options,
    onSuccess: (data, vars, ctx) => {
      void qc.invalidateQueries({ queryKey: qk.admin.usersAll });
      options?.onSuccess?.(data, vars, ctx);
    },
  });
}

export function useResetPassword(
  options?: UseMutationOptions<ResetPasswordResponse, Error, UserId>,
) {
  const api = useEndpoints();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: UserId) => api.users.resetPassword(id),
    ...options,
    onSuccess: (data, vars, ctx) => {
      // `mustResetPassword` flips true on the row, so the list needs refreshing.
      void qc.invalidateQueries({ queryKey: qk.admin.usersAll });
      options?.onSuccess?.(data, vars, ctx);
    },
  });
}

export function useUpdateUser() {
  const api = useEndpoints();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: UserId; body: UpdateUserRequest }) => api.users.update(id, body),
    onSuccess: (user: UserResponse) => {
      qc.setQueryData(qk.admin.user(user.id), user);
      void qc.invalidateQueries({ queryKey: qk.admin.usersAll });
    },
  });
}

export function useSetUserActive() {
  const api = useEndpoints();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, active }: { id: UserId; active: boolean }) =>
      active ? api.users.activate(id) : api.users.deactivate(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.admin.usersAll }),
  });
}

// ── Township (§8.8) ─────────────────────────────────────────────────────────────────────────

export function useBlocks() {
  const api = useEndpoints();
  return useQuery({
    queryKey: qk.admin.blocks,
    queryFn: ({ signal }) => api.township.listBlocks(signal),
    staleTime: 5 * 60_000,
  });
}

export function useFlats(blockId?: BlockId | null) {
  const api = useEndpoints();
  return useQuery({
    queryKey: qk.admin.flats(blockId),
    queryFn: ({ signal }) => api.township.listFlats(blockId, signal),
    staleTime: 5 * 60_000,
  });
}

export function useGates() {
  const api = useEndpoints();
  return useQuery({
    queryKey: qk.admin.gates,
    queryFn: ({ signal }) => api.township.listGates(signal),
    staleTime: 5 * 60_000,
  });
}

export function useSalesOnDuty() {
  const api = useEndpoints();
  return useQuery({
    queryKey: qk.salesOnDuty,
    queryFn: ({ signal }) => api.sales.onDuty(signal),
  });
}

export function useCreateBlock() {
  const api = useEndpoints();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.township.createBlock({ name }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.admin.blocks }),
  });
}

export function useDeleteBlock() {
  const api = useEndpoints();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: BlockId) => api.township.deleteBlock(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.admin.blocks });
      void qc.invalidateQueries({ queryKey: qk.admin.flatsAll });
    },
  });
}

export function useCreateFlat() {
  const api = useEndpoints();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ blockId, number }: { blockId: BlockId; number: string }) =>
      api.township.createFlat({ blockId, number }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.admin.flatsAll });
      // `BlockResponse.flatCount` moved.
      void qc.invalidateQueries({ queryKey: qk.admin.blocks });
    },
  });
}

export function useDeleteFlat() {
  const api = useEndpoints();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: FlatId) => api.township.deleteFlat(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.admin.flatsAll });
      void qc.invalidateQueries({ queryKey: qk.admin.blocks });
    },
  });
}

export function useCreateGate() {
  const api = useEndpoints();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.township.createGate({ name }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.admin.gates }),
  });
}

export function useDeleteGate() {
  const api = useEndpoints();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: GateId) => api.township.deleteGate(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.admin.gates }),
  });
}
