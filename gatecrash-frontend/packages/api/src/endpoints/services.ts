import type {
  BookingStatus,
  InvoiceCategory,
  InvoiceStatus,
  MoveStatus,
  MoveType,
  PropertyNodeId,
  TicketCategory,
  TicketStatus,
} from '@gatecrash/core';
import type { ApiClient } from '../client';
import type { PageArgs, PageResponse } from '../pagination';
import { toPageParams } from '../pagination';

/**
 * Resident services (V8): help desk, amenities, move-in/move-out and bills.
 *
 * Types are hand-written to the backend DTOs and trusted, like the rest of the non-critical
 * payloads (§4.2). Optional fields are `?:` because the API omits nulls entirely.
 */

// ── Types ──────────────────────────────────────────────────────────────────────────────────────

export interface TicketSummary {
  id: string;
  category: TicketCategory;
  subject: string;
  status: TicketStatus;
  unitCode?: string | null;
  raisedByName: string;
  replies: number;
  createdAt: string;
  updatedAt: string;
}

export interface TicketMessage {
  id: string;
  authorName: string;
  fromStaff: boolean;
  body: string;
  createdAt: string;
}

export interface TicketDetail extends Omit<TicketSummary, 'replies'> {
  description: string;
  resolvedAt?: string | null;
  messages: TicketMessage[];
}

export interface RaiseTicketBody {
  category: TicketCategory;
  subject: string;
  description: string;
}

export interface Amenity {
  id: string;
  name: string;
  description?: string | null;
  /** Bookings allowed in one slot. */
  capacity: number;
  /** "HH:mm:ss", the township's local time. */
  openTime: string;
  closeTime: string;
  slotMinutes: number;
  maxSlotsPerBooking: number;
  active: boolean;
}

export interface AmenityBody {
  name: string;
  description?: string;
  capacity: number;
  openTime: string;
  closeTime: string;
  slotMinutes: number;
  maxSlotsPerBooking: number;
  active?: boolean;
}

export interface Slot {
  startTime: string;
  endTime: string;
  startsAt: string;
  endsAt: string;
  booked: number;
  capacity: number;
  available: boolean;
  mine: boolean;
  past: boolean;
}

export interface Availability {
  amenityId: string;
  date: string;
  slots: Slot[];
}

export interface BookBody {
  amenityId: string;
  date: string;
  startTime: string;
  slots: number;
  guests?: number;
  note?: string;
}

export interface Booking {
  id: string;
  amenityId: string;
  amenityName: string;
  bookedByName: string;
  unitCode?: string | null;
  startsAt: string;
  endsAt: string;
  guests: number;
  note?: string | null;
  status: BookingStatus;
  cancelReason?: string | null;
  createdAt: string;
}

export interface MoveRequestBody {
  moveType: MoveType;
  moveDate: string;
  timeFrom: string;
  timeTo: string;
  vehicleDetails?: string;
  helpersCount?: number;
  notes?: string;
}

export interface MoveRequest {
  id: string;
  unitId: string;
  unitCode: string;
  requestedByName: string;
  moveType: MoveType;
  moveDate: string;
  timeFrom: string;
  timeTo: string;
  vehicleDetails?: string | null;
  helpersCount?: number | null;
  notes?: string | null;
  status: MoveStatus;
  adminNote?: string | null;
  decidedByName?: string | null;
  decidedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  /** Office view only. */
  unpaidCount?: number | null;
  unpaidAmountPaise?: number | null;
}

export interface Invoice {
  id: string;
  unitId: string;
  unitCode: string;
  category: InvoiceCategory;
  title: string;
  periodLabel?: string | null;
  amountPaise: number;
  dueDate?: string | null;
  status: InvoiceStatus;
  paidAt?: string | null;
  paymentMethod?: string | null;
  paymentReference?: string | null;
  receiptNo?: string | null;
  createdAt: string;
}

export interface RecordInvoiceBody {
  unitId: PropertyNodeId;
  category: InvoiceCategory;
  title: string;
  periodLabel?: string;
  amountPaise: number;
  dueDate?: string;
  paid: boolean;
  paidAt?: string;
  paymentMethod?: string;
  paymentReference?: string;
}

// ── Endpoints ──────────────────────────────────────────────────────────────────────────────────

export function serviceEndpoints(client: ApiClient) {
  const opt = (signal?: AbortSignal) => (signal ? { signal } : {});
  return {
    tickets: {
      raise: (body: RaiseTicketBody) => client.post<TicketDetail>('support-tickets', { json: body }),
      mine: (page: PageArgs, signal?: AbortSignal) =>
        client.get<PageResponse<TicketSummary>>('support-tickets/mine', {
          searchParams: toPageParams(page),
          ...opt(signal),
        }),
      one: (id: string, signal?: AbortSignal) => client.get<TicketDetail>(`support-tickets/${id}`, opt(signal)),
      reply: (id: string, body: string) =>
        client.post<TicketDetail>(`support-tickets/${id}/messages`, { json: { body } }),
      reopen: (id: string) => client.post<TicketDetail>(`support-tickets/${id}/reopen`),
      close: (id: string) => client.post<TicketDetail>(`support-tickets/${id}/close`),
      list: (status: TicketStatus | null, page: PageArgs, signal?: AbortSignal) =>
        client.get<PageResponse<TicketSummary>>('admin/support-tickets', {
          searchParams: { ...(status ? { status } : {}), ...toPageParams(page) },
          ...opt(signal),
        }),
      setStatus: (id: string, status: TicketStatus) =>
        client.patch<TicketDetail>(`admin/support-tickets/${id}/status`, { json: { status } }),
    },
    amenities: {
      list: (signal?: AbortSignal) => client.get<Amenity[]>('amenities', opt(signal)),
      availability: (id: string, date: string, signal?: AbortSignal) =>
        client.get<Availability>(`amenities/${id}/availability`, { searchParams: { date }, ...opt(signal) }),
      create: (body: AmenityBody) => client.post<Amenity>('admin/amenities', { json: body }),
      update: (id: string, body: AmenityBody) => client.put<Amenity>(`admin/amenities/${id}`, { json: body }),
      book: (body: BookBody) => client.post<Booking>('amenity-bookings', { json: body }),
      myBookings: (signal?: AbortSignal) => client.get<Booking[]>('amenity-bookings/mine', opt(signal)),
      cancel: (id: string, reason?: string) =>
        client.post<Booking>(`amenity-bookings/${id}/cancel`, { json: reason ? { reason } : {} }),
      forDay: (date: string, signal?: AbortSignal) =>
        client.get<Booking[]>('admin/amenity-bookings', { searchParams: { date }, ...opt(signal) }),
    },
    moves: {
      request: (body: MoveRequestBody) => client.post<MoveRequest>('move-requests', { json: body }),
      mine: (signal?: AbortSignal) => client.get<MoveRequest[]>('move-requests/mine', opt(signal)),
      cancel: (id: string) => client.post<MoveRequest>(`move-requests/${id}/cancel`),
      today: (signal?: AbortSignal) => client.get<MoveRequest[]>('move-requests/today', opt(signal)),
      list: (status: MoveStatus | null, page: PageArgs, signal?: AbortSignal) =>
        client.get<PageResponse<MoveRequest>>('admin/move-requests', {
          searchParams: { ...(status ? { status } : {}), ...toPageParams(page) },
          ...opt(signal),
        }),
      decide: (id: string, decision: 'APPROVED' | 'REJECTED', note?: string) =>
        client.post<MoveRequest>(`admin/move-requests/${id}/decision`, {
          json: note ? { decision, note } : { decision },
        }),
      complete: (id: string, deactivateResidents: boolean) =>
        client.post<MoveRequest>(`admin/move-requests/${id}/complete`, { json: { deactivateResidents } }),
    },
    invoices: {
      myPaid: (page: PageArgs, signal?: AbortSignal) =>
        client.get<PageResponse<Invoice>>('invoices/mine', { searchParams: toPageParams(page), ...opt(signal) }),
      list: (filters: { unitId?: string | null; status?: InvoiceStatus | null }, page: PageArgs, signal?: AbortSignal) =>
        client.get<PageResponse<Invoice>>('admin/invoices', {
          searchParams: {
            ...(filters.unitId ? { unitId: filters.unitId } : {}),
            ...(filters.status ? { status: filters.status } : {}),
            ...toPageParams(page),
          },
          ...opt(signal),
        }),
      record: (body: RecordInvoiceBody) => client.post<Invoice>('admin/invoices', { json: body }),
      markPaid: (id: string, body: { paidAt?: string; paymentMethod?: string; paymentReference?: string }) =>
        client.post<Invoice>(`admin/invoices/${id}/mark-paid`, { json: body }),
    },
  };
}

/** Rupees from paise, Indian grouping: 350000 -> "₹3,500.00". */
export function formatPaise(paise: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(paise / 100);
}
