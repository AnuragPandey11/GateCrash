import type {
  Decision,
  GateId,
  InvoiceStatus,
  MoveStatus,
  PassId,
  TicketStatus,
  VisitId,
} from '@gatecrash/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RedeemCorrections } from '../endpoints/passes';
import type {
  AmenityBody,
  BookBody,
  MoveRequestBody,
  RaiseTicketBody,
  RecordInvoiceBody,
} from '../endpoints/services';
import type { PageArgs } from '../pagination';
import type { CreatePassRequest } from '../schemas';
import { qk } from './keys';
import { useEndpoints } from './provider';

/**
 * Hooks for the gate flows and the resident services (V8).
 *
 * Same conventions as `hooks.ts`: writes invalidate by key prefix, and nothing one-time — a pass
 * PIN, a collection code — is ever written into the cache; it comes back through the mutation
 * result only.
 */

export const sk = {
  visitsMine: (page: PageArgs) => ['visits', 'mine', page] as const,
  tickets: ['tickets'] as const,
  ticketsMine: (page: PageArgs) => ['tickets', 'mine', page] as const,
  ticketsAll: (status: TicketStatus | null, page: PageArgs) => ['tickets', 'all', status, page] as const,
  ticket: (id: string) => ['tickets', 'one', id] as const,
  amenities: ['amenities'] as const,
  availability: (id: string, date: string) => ['amenities', 'availability', id, date] as const,
  bookings: ['bookings'] as const,
  bookingsMine: ['bookings', 'mine'] as const,
  bookingsDay: (date: string) => ['bookings', 'day', date] as const,
  moves: ['moves'] as const,
  movesMine: ['moves', 'mine'] as const,
  movesToday: ['moves', 'today'] as const,
  movesAll: (status: MoveStatus | null, page: PageArgs) => ['moves', 'all', status, page] as const,
  invoices: ['invoices'] as const,
  invoicesMine: (page: PageArgs) => ['invoices', 'mine', page] as const,
  invoicesAll: (unitId: string | null, status: InvoiceStatus | null, page: PageArgs) =>
    ['invoices', 'all', unitId, status, page] as const,
} as const;

// ── Visits (resident & guard) ───────────────────────────────────────────────────────────────────

export function useMyVisits(page: PageArgs) {
  const api = useEndpoints();
  return useQuery({
    queryKey: sk.visitsMine(page),
    queryFn: ({ signal }) => api.visits.mine(page, signal),
    placeholderData: (prev) => prev,
  });
}

export function useDecide() {
  const api = useEndpoints();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: VisitId; decision: Decision; expectedDurationMinutes?: number }) =>
      api.visits.decide(v.id, v.decision, v.expectedDurationMinutes),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.visits.all }),
  });
}

export function useExtendStay() {
  const api = useEndpoints();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: VisitId; extendMinutes: number }) => api.visits.extendStay(v.id, v.extendMinutes),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.visits.all }),
  });
}

export function useCollectionCode() {
  const api = useEndpoints();
  return useMutation({ mutationFn: (id: VisitId) => api.visits.collectionCode(id) });
}

export function useCollectParcel() {
  const api = useEndpoints();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: VisitId; code: string }) => api.visits.collect(v.id, v.code),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.visits.all }),
  });
}

// ── Passes ──────────────────────────────────────────────────────────────────────────────────────

export function useMyPasses(page: PageArgs) {
  const api = useEndpoints();
  return useQuery({
    queryKey: qk.passes.mine(page),
    queryFn: ({ signal }) => api.passes.mine(page, signal),
    placeholderData: (prev) => prev,
  });
}

export function useCreatePass() {
  const api = useEndpoints();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePassRequest) => api.passes.create(body),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.passes.all }),
  });
}

export function useRevokePass() {
  const api = useEndpoints();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: PassId) => api.passes.revoke(id),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.passes.all }),
  });
}

export function usePassLookup() {
  const api = useEndpoints();
  return useMutation({
    mutationFn: (v: { pin?: string; qrToken?: string; gateId: GateId }) => api.passes.lookup(v),
  });
}

export function useRedeemPass() {
  const api = useEndpoints();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { pin?: string; qrToken?: string; gateId: GateId; corrections?: RedeemCorrections }) =>
      api.passes.redeem({ pin: v.pin, qrToken: v.qrToken, gateId: v.gateId }, v.corrections),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.visits.all }),
  });
}

// ── Help desk ───────────────────────────────────────────────────────────────────────────────────

export function useMyTickets(page: PageArgs) {
  const api = useEndpoints();
  return useQuery({
    queryKey: sk.ticketsMine(page),
    queryFn: ({ signal }) => api.services.tickets.mine(page, signal),
    placeholderData: (prev) => prev,
  });
}

export function useAllTickets(status: TicketStatus | null, page: PageArgs) {
  const api = useEndpoints();
  return useQuery({
    queryKey: sk.ticketsAll(status, page),
    queryFn: ({ signal }) => api.services.tickets.list(status, page, signal),
    placeholderData: (prev) => prev,
  });
}

export function useTicket(id: string | null) {
  const api = useEndpoints();
  return useQuery({
    queryKey: sk.ticket(id ?? 'none'),
    queryFn: ({ signal }) => api.services.tickets.one(id as string, signal),
    enabled: Boolean(id),
  });
}

function useTicketMutation<V>(fn: (v: V) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => qc.invalidateQueries({ queryKey: sk.tickets }),
  });
}

export function useRaiseTicket() {
  const api = useEndpoints();
  return useTicketMutation((body: RaiseTicketBody) => api.services.tickets.raise(body));
}

export function useReplyTicket() {
  const api = useEndpoints();
  return useTicketMutation((v: { id: string; body: string }) => api.services.tickets.reply(v.id, v.body));
}

export function useTicketAction() {
  const api = useEndpoints();
  return useTicketMutation(
    (
      v:
        | { id: string; action: 'reopen' }
        | { id: string; action: 'close' }
        | { id: string; action: 'status'; status: TicketStatus },
    ) => {
      if (v.action === 'reopen') return api.services.tickets.reopen(v.id);
      if (v.action === 'close') return api.services.tickets.close(v.id);
      return api.services.tickets.setStatus(v.id, v.status);
    },
  );
}

// ── Amenities ───────────────────────────────────────────────────────────────────────────────────

export function useAmenities() {
  const api = useEndpoints();
  return useQuery({ queryKey: sk.amenities, queryFn: ({ signal }) => api.services.amenities.list(signal) });
}

export function useAvailability(id: string | null, date: string) {
  const api = useEndpoints();
  return useQuery({
    queryKey: sk.availability(id ?? 'none', date),
    queryFn: ({ signal }) => api.services.amenities.availability(id as string, date, signal),
    enabled: Boolean(id),
  });
}

export function useMyBookings() {
  const api = useEndpoints();
  return useQuery({ queryKey: sk.bookingsMine, queryFn: ({ signal }) => api.services.amenities.myBookings(signal) });
}

export function useBookingsForDay(date: string) {
  const api = useEndpoints();
  return useQuery({
    queryKey: sk.bookingsDay(date),
    queryFn: ({ signal }) => api.services.amenities.forDay(date, signal),
  });
}

function useAmenityMutation<V>(fn: (v: V) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: sk.amenities });
      void qc.invalidateQueries({ queryKey: sk.bookings });
    },
  });
}

export function useSaveAmenity() {
  const api = useEndpoints();
  return useAmenityMutation((v: { id?: string; body: AmenityBody }) =>
    v.id ? api.services.amenities.update(v.id, v.body) : api.services.amenities.create(v.body),
  );
}

export function useBookAmenity() {
  const api = useEndpoints();
  return useAmenityMutation((body: BookBody) => api.services.amenities.book(body));
}

export function useCancelBooking() {
  const api = useEndpoints();
  return useAmenityMutation((v: { id: string; reason?: string }) => api.services.amenities.cancel(v.id, v.reason));
}

// ── Moves ───────────────────────────────────────────────────────────────────────────────────────

export function useMyMoves() {
  const api = useEndpoints();
  return useQuery({ queryKey: sk.movesMine, queryFn: ({ signal }) => api.services.moves.mine(signal) });
}

export function useMovesToday(enabled = true) {
  const api = useEndpoints();
  return useQuery({
    queryKey: sk.movesToday,
    queryFn: ({ signal }) => api.services.moves.today(signal),
    enabled,
    refetchInterval: 5 * 60_000,
  });
}

export function useAllMoves(status: MoveStatus | null, page: PageArgs) {
  const api = useEndpoints();
  return useQuery({
    queryKey: sk.movesAll(status, page),
    queryFn: ({ signal }) => api.services.moves.list(status, page, signal),
    placeholderData: (prev) => prev,
  });
}

function useMoveMutation<V>(fn: (v: V) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSettled: () => qc.invalidateQueries({ queryKey: sk.moves }) });
}

export function useRequestMove() {
  const api = useEndpoints();
  return useMoveMutation((body: MoveRequestBody) => api.services.moves.request(body));
}

export function useMoveAction() {
  const api = useEndpoints();
  return useMoveMutation(
    (
      v:
        | { id: string; action: 'cancel' }
        | { id: string; action: 'decide'; decision: 'APPROVED' | 'REJECTED'; note?: string }
        | { id: string; action: 'complete'; deactivateResidents: boolean },
    ) =>
      v.action === 'cancel'
        ? api.services.moves.cancel(v.id)
        : v.action === 'decide'
          ? api.services.moves.decide(v.id, v.decision, v.note)
          : api.services.moves.complete(v.id, v.deactivateResidents),
  );
}

// ── Bills ───────────────────────────────────────────────────────────────────────────────────────

export function useMyPaidInvoices(page: PageArgs) {
  const api = useEndpoints();
  return useQuery({
    queryKey: sk.invoicesMine(page),
    queryFn: ({ signal }) => api.services.invoices.myPaid(page, signal),
    placeholderData: (prev) => prev,
  });
}

export function useAllInvoices(unitId: string | null, status: InvoiceStatus | null, page: PageArgs) {
  const api = useEndpoints();
  return useQuery({
    queryKey: sk.invoicesAll(unitId, status, page),
    queryFn: ({ signal }) => api.services.invoices.list({ unitId, status }, page, signal),
    placeholderData: (prev) => prev,
  });
}

export function useRecordInvoice() {
  const api = useEndpoints();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RecordInvoiceBody) => api.services.invoices.record(body),
    onSettled: () => qc.invalidateQueries({ queryKey: sk.invoices }),
  });
}

export function useMarkInvoicePaid() {
  const api = useEndpoints();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; paymentMethod?: string; paymentReference?: string }) =>
      api.services.invoices.markPaid(v.id, { paymentMethod: v.paymentMethod, paymentReference: v.paymentReference }),
    onSettled: () => qc.invalidateQueries({ queryKey: sk.invoices }),
  });
}
