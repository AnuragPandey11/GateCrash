import type {
  AudienceRule,
  Decision,
  GateId,
  PropertyLevelId,
  PropertyNodeId,
  InboxItemId,
  PostId,
  TownshipId,
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
import type { Endpoints } from '../endpoints';
import type {
  CreateTownshipBody,
  TownshipAdminBody,
  UpdateTownshipBody,
} from '../endpoints/platform';
import type { UserFilters, VisitFilters } from '../filters';
import { PAGE_DEFAULTS, type PageArgs } from '../pagination';
import type {
  BulkCreateRequest,
  CreateNodeRequest,
  CreateNotificationRequest,
  CreatePostRequest,
  DefineLevelsRequest,
  RenameLevelRequest,
  UpdateNodeRequest,
  CreateUserRequest,
  CreateVisitRequest,
  CreatedTownshipResponse,
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

// ── Property tree (§8.8) ────────────────────────────────────────────────────────────────────

/**
 * The township's levels and their labels. Everything structural depends on this, so it is fetched
 * once and held: the shape of a project changes roughly never, and a screen that re-fetches it per
 * tab flickers its own tab labels.
 */
export function usePropertyProfile() {
  const api = useEndpoints();
  return useQuery({
    queryKey: qk.admin.propertyProfile,
    queryFn: ({ signal }) => api.property.profile(signal),
    staleTime: 30 * 60_000,
  });
}

/** Static reference data — the presets. Never changes within a session. */
export function usePropertyTypes() {
  const api = useEndpoints();
  return useQuery({
    queryKey: qk.admin.propertyTypes,
    queryFn: ({ signal }) => api.property.types(signal),
    staleTime: Infinity,
  });
}

/**
 * Children of one node, or a whole level by depth. `enabled` is false when a parent is expected but
 * not chosen yet, so selecting nothing shows an empty state rather than firing a request for the
 * entire tree.
 */
export function usePropertyNodes(
  params: { parentId?: PropertyNodeId | null; depth?: number | null } = {},
  options: { enabled?: boolean } = {},
) {
  const api = useEndpoints();
  return useQuery({
    queryKey: qk.admin.propertyNodes(params.parentId, params.depth),
    queryFn: ({ signal }) => api.property.listNodes(params, signal),
    staleTime: 5 * 60_000,
    enabled: options.enabled ?? true,
  });
}

export function usePropertyOccupancy() {
  const api = useEndpoints();
  return useQuery({
    queryKey: qk.admin.propertyOccupancy,
    queryFn: ({ signal }) => api.property.occupancy(signal),
    staleTime: 60_000,
  });
}

/**
 * Every property write invalidates the whole `propertyAll` prefix rather than the one list it
 * touched. Creating a node changes its parent's `childCount`, the level's `nodeCount` and the list
 * it landed in; predicting that set per mutation is how a stale child count survives on screen.
 */
function usePropertyMutation<TArgs, TResult>(fn: (api: Endpoints, args: TArgs) => Promise<TResult>) {
  const api = useEndpoints();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: TArgs) => fn(api, args),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.admin.propertyAll }),
  });
}

export function useCreatePropertyNode() {
  return usePropertyMutation((api, body: CreateNodeRequest) => api.property.createNode(body));
}

export function useUpdatePropertyNode() {
  return usePropertyMutation((api, args: { id: PropertyNodeId; body: UpdateNodeRequest }) =>
    api.property.updateNode(args.id, args.body),
  );
}

export function useDeletePropertyNode() {
  return usePropertyMutation((api, id: PropertyNodeId) => api.property.deleteNode(id));
}

export function useBulkCreateNodes() {
  return usePropertyMutation((api, body: BulkCreateRequest) => api.property.bulkCreate(body));
}

/** Also invalidates occupancy, which `propertyAll` covers by prefix. */
export function useSetOccupancy() {
  return usePropertyMutation((api, args: { id: PropertyNodeId; declaredOccupancy: number }) =>
    api.property.setOccupancy(args.id, { declaredOccupancy: args.declaredOccupancy }),
  );
}

export function useRenamePropertyLevel() {
  return usePropertyMutation((api, args: { id: PropertyLevelId; body: RenameLevelRequest }) =>
    api.property.renameLevel(args.id, args.body),
  );
}

export function useDefineLevels() {
  return usePropertyMutation((api, body: DefineLevelsRequest) => api.property.defineLevels(body));
}

// ── Gates (§8.8) ────────────────────────────────────────────────────────────────────────────

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


// ── Platform / SUPER_ADMIN (§8.9) ───────────────────────────────────────────────────────────

/**
 * These are the only hooks whose data is not scoped to the acting township — they act *on*
 * townships, from outside any of them, and need no `X-Township-Id`.
 *
 * Everything here answers `403` for any role but `SUPER_ADMIN`, which is the check that counts;
 * the `enabled` flags below are only there to keep a township admin's dashboard from firing a
 * request it is guaranteed to be refused.
 */
export function useTownships(
  page: PageArgs = { page: 1, size: PAGE_DEFAULTS.users },
  includeArchived = false,
  enabled = true,
) {
  const api = useEndpoints();
  return useQuery({
    queryKey: qk.platform.townships(page, includeArchived),
    queryFn: ({ signal }) => api.platform.listTownships(page, includeArchived, signal),
    placeholderData: (previous) => previous,
    enabled,
  });
}

export function useTownshipAdmins(id: TownshipId | null) {
  const api = useEndpoints();
  return useQuery({
    queryKey: qk.platform.townshipAdmins((id ?? '') as TownshipId),
    queryFn: ({ signal }) => api.platform.listTownshipAdmins(id as TownshipId, signal),
    enabled: Boolean(id),
  });
}

/**
 * Onboards a township and its first admin. The generated password comes back through the mutation
 * result only and is never cached — same rule as `useCreateUser` (§14.3).
 */
/**
 * The onboarding project-type catalogue. Never changes within a session, and must be readable
 * before a township exists — so it hangs off the `platform` key prefix, not `admin`.
 */
export function usePlatformPropertyTypes() {
  const api = useEndpoints();
  return useQuery({
    queryKey: qk.platform.propertyTypes,
    queryFn: ({ signal }) => api.platform.propertyTypes(signal),
    staleTime: Infinity,
  });
}

export function useCreateTownship() {
  const api = useEndpoints();
  const qc = useQueryClient();
  return useMutation<CreatedTownshipResponse, Error, CreateTownshipBody>({
    mutationFn: (body) => api.platform.createTownship(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.platform.townshipsAll });
    },
  });
}

export function useUpdateTownship() {
  const api = useEndpoints();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: TownshipId; body: UpdateTownshipBody }) =>
      api.platform.updateTownship(id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.platform.townshipsAll });
    },
  });
}

/**
 * Suspend / archive / restore.
 *
 * Archive carries `confirmCode` because the server requires the township's own code back — the one
 * operation on the platform that takes an entire community offline in a single request.
 */
export function useTownshipLifecycle() {
  const api = useEndpoints();
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: qk.platform.townshipsAll });
  };

  return {
    suspend: useMutation({
      mutationFn: (id: TownshipId) => api.platform.suspendTownship(id),
      onSuccess: invalidate,
    }),
    archive: useMutation({
      mutationFn: ({ id, confirmCode }: { id: TownshipId; confirmCode: string }) =>
        api.platform.archiveTownship(id, confirmCode),
      onSuccess: invalidate,
    }),
    restore: useMutation({
      mutationFn: (id: TownshipId) => api.platform.restoreTownship(id),
      onSuccess: invalidate,
    }),
  };
}

export function useAddTownshipAdmin() {
  const api = useEndpoints();
  const qc = useQueryClient();
  return useMutation<CreatedUserResponse, Error, { id: TownshipId; body: TownshipAdminBody }>({
    mutationFn: ({ id, body }) => api.platform.addTownshipAdmin(id, body),
    onSuccess: (_result, { id }) => {
      void qc.invalidateQueries({ queryKey: qk.platform.townshipAdmins(id) });
      void qc.invalidateQueries({ queryKey: qk.platform.townshipsAll });
    },
  });
}

export function useRemoveTownshipAdmin() {
  const api = useEndpoints();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, userId }: { id: TownshipId; userId: UserId }) =>
      api.platform.removeTownshipAdmin(id, userId),
    onSuccess: (_result, { id }) => {
      void qc.invalidateQueries({ queryKey: qk.platform.townshipAdmins(id) });
      void qc.invalidateQueries({ queryKey: qk.platform.townshipsAll });
    },
  });
}
