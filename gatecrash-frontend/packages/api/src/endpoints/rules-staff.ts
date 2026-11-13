import type { EntryRuleStatus, StaffCategory, StaffScope, VisitorType } from '@gatecrash/core';
import type { ApiClient } from '../client';
import type { PageArgs, PageResponse } from '../pagination';
import { toPageParams } from '../pagination';

/**
 * Society rules (V10) and daily help & staff (V11).
 *
 * Hand-written to the backend DTOs, like the other service payloads. Optional fields are `?:`
 * because the API omits nulls — which is also how audience-scoped fields arrive: a resident never
 * receives `householdUnits`, the gate never receives `qrToken`.
 */

// ── Society rules ──────────────────────────────────────────────────────────────────────────────

export interface EntryRule {
  id: string;
  unitCode: string;
  requestedByName: string;
  visitorType: VisitorType;
  label: string;
  /** Matched against the walk-in's name and purpose. Absent = any visitor of the type. */
  matchText?: string;
  visitorPhone?: string;
  /** "HH:mm:ss" in the township's local time; both or neither. */
  allowedFrom?: string;
  allowedTo?: string;
  validUntil?: string;
  note?: string;
  status: EntryRuleStatus;
  adminNote?: string;
  decidedByName?: string;
  decidedAt?: string;
  createdAt: string;
}

export interface CreateRuleBody {
  visitorType: VisitorType;
  label: string;
  matchText?: string;
  visitorPhone?: string;
  allowedFrom?: string;
  allowedTo?: string;
  validUntil?: string;
  note?: string;
}

export type RuleDecision = 'APPROVED' | 'REJECTED';

// ── Daily help & staff ─────────────────────────────────────────────────────────────────────────

export interface StaffMember {
  id: string;
  scope: StaffScope;
  category: StaffCategory;
  fullName: string;
  phone?: string;
  active: boolean;
  /** What the ID-card QR carries. Sent to the office and the helper's own homes only. */
  qrToken?: string;
  /** Unit codes the helper works for. Sent to the office and the gate only. */
  householdUnits?: string[];
  householdCount: number;
  averageRating?: number;
  ratingCount: number;
  myRating?: number;
  myReview?: string;
  insideNow: boolean;
  insideSince?: string;
  lastSeenAt?: string;
  createdAt: string;
}

/** `code` is the only time the plaintext entry code is ever sent. Never cache it. */
export interface StaffCreated {
  staff: StaffMember;
  code: string;
}

export interface Attendance {
  id: string;
  staffId: string;
  staffName: string;
  category: StaffCategory;
  scope: StaffScope;
  gateName: string;
  exitGateName?: string;
  checkedInAt: string;
  checkedOutAt?: string;
}

export interface RegisterHelpBody {
  category: StaffCategory;
  fullName: string;
  phone: string;
}

export interface CreateStaffBody {
  scope: StaffScope;
  category: StaffCategory;
  fullName: string;
  phone?: string;
}

export function rulesEndpoints(client: ApiClient) {
  const opt = (signal?: AbortSignal) => (signal ? { signal } : {});
  return {
    request: (body: CreateRuleBody) => client.post<EntryRule>('entry-rules', { json: body }),
    mine: (signal?: AbortSignal) => client.get<EntryRule[]>('entry-rules/mine', opt(signal)),
    cancel: (id: string) => client.post<EntryRule>(`entry-rules/${id}/cancel`),
    list: (status: EntryRuleStatus | null, page: PageArgs, signal?: AbortSignal) =>
      client.get<PageResponse<EntryRule>>('admin/entry-rules', {
        searchParams: { ...toPageParams(page), ...(status ? { status } : {}) },
        ...opt(signal),
      }),
    decide: (id: string, decision: RuleDecision, note?: string) =>
      client.post<EntryRule>(`admin/entry-rules/${id}/decision`, { json: { decision, ...(note ? { note } : {}) } }),
    revoke: (id: string, note?: string) =>
      client.post<EntryRule>(`admin/entry-rules/${id}/revoke`, { json: note ? { note } : {} }),
  };
}

export function staffEndpoints(client: ApiClient) {
  const opt = (signal?: AbortSignal) => (signal ? { signal } : {});
  return {
    mine: (signal?: AbortSignal) => client.get<StaffMember[]>('staff/mine', opt(signal)),
    register: (body: RegisterHelpBody) => client.post<StaffCreated>('staff', { json: body }),
    link: (code: string) => client.post<StaffMember>('staff/link', { json: { code } }),
    unlink: (id: string) => client.delete<void>(`staff/${id}/households/mine`),
    rate: (id: string, rating: number, review?: string) =>
      client.put<StaffMember>(`staff/${id}/rating`, { json: { rating, ...(review ? { review } : {}) } }),
    history: (id: string, days: number, signal?: AbortSignal) =>
      client.get<Attendance[]>(`staff/${id}/attendance`, { searchParams: { days }, ...opt(signal) }),
    directory: (signal?: AbortSignal) => client.get<StaffMember[]>('staff/directory', opt(signal)),
    lookup: (by: { code: string } | { qrToken: string }) =>
      client.post<StaffMember>('staff/gate/lookup', { json: by }),
    checkIn: (id: string, gateId: string) => client.post<Attendance>(`staff/${id}/check-in`, { json: { gateId } }),
    checkOut: (id: string, gateId: string) => client.post<Attendance>(`staff/${id}/check-out`, { json: { gateId } }),
    inside: (signal?: AbortSignal) => client.get<Attendance[]>('staff/inside', opt(signal)),
    list: (signal?: AbortSignal) => client.get<StaffMember[]>('admin/staff', opt(signal)),
    create: (body: CreateStaffBody) => client.post<StaffCreated>('admin/staff', { json: body }),
    reissue: (id: string) => client.post<StaffCreated>(`admin/staff/${id}/reissue-code`),
    setActive: (id: string, active: boolean) =>
      client.post<StaffMember>(`admin/staff/${id}/active`, { json: { active } }),
    attendanceOn: (date: string, signal?: AbortSignal) =>
      client.get<Attendance[]>('admin/staff/attendance', { searchParams: { date }, ...opt(signal) }),
  };
}
