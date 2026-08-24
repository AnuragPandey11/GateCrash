import type {
  BlockResponse,
  FlatResponse,
  GateResponse,
  NotificationResponse,
  PostResponse,
  UserResponse,
  VisitResponse,
} from '../schemas';
import type { PageResponse } from '../pagination';

/**
 * Recorded-shape fixtures — FRONTEND.md §12 ("contract" row).
 *
 * These mirror what the backend actually serialises, nulls included, so the Zod schemas are
 * exercised against realistic payloads rather than against objects hand-shaped to pass. Ids are
 * real UUIDs because the schemas validate them as such.
 */

export const IDS = {
  admin: '11111111-1111-4111-8111-111111111111',
  resident: '22222222-2222-4222-8222-222222222222',
  guard: '33333333-3333-4333-8333-333333333333',
  sales: '44444444-4444-4444-8444-444444444444',
  gateMain: '55555555-5555-4555-8555-555555555555',
  gateService: '5555aaaa-5555-4555-8555-555555555555',
  blockA: '66666666-6666-4666-8666-666666666666',
  flatA101: '77777777-7777-4777-8777-777777777777',
  flatA102: '7777aaaa-7777-4777-8777-777777777777',
  visitPending: '88888888-8888-4888-8888-888888888888',
  visitInside: '8888aaaa-8888-4888-8888-888888888888',
  pass: '99999999-9999-4999-8999-999999999999',
  notification: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  post: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
} as const;

export const loginResponseFixture = {
  accessToken: 'header.payload.signature',
  refreshToken: 'opaque-refresh-token-value',
  tokenType: 'Bearer',
  expiresInSeconds: 1800,
  mustResetPassword: false,
  role: 'ADMIN',
  userId: IDS.admin,
  fullName: 'Priya Nair',
};

export const meResponseFixture = {
  id: IDS.admin,
  loginId: 'admin',
  fullName: 'Priya Nair',
  role: 'ADMIN',
  mustResetPassword: false,
  onDuty: false,
  flatId: null,
  flatNumber: null,
  blockName: null,
};

export const residentMeFixture = {
  ...meResponseFixture,
  id: IDS.resident,
  loginId: 'A-101-1',
  fullName: 'Ravi Kumar',
  role: 'RESIDENT',
  flatId: IDS.flatA101,
  flatNumber: 'A-101',
  blockName: 'Block A',
};

export const pendingVisitFixture: VisitResponse = {
  id: IDS.visitPending,
  gateId: IDS.gateMain,
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
  targetFlatId: IDS.flatA101,
  targetFlatNumber: 'A-101',
  preApprovalId: null,
  loggedByName: 'Gate Guard 1',
  createdAt: '2026-07-23T14:30:00+05:30',
  decidedAt: null,
  checkedInAt: null,
  checkedOutAt: null,
} as VisitResponse;

export const insideVisitFixture: VisitResponse = {
  ...pendingVisitFixture,
  id: IDS.visitInside,
  visitorName: 'Suresh Iyer',
  visitorType: 'DELIVERY',
  vehicleNo: 'MH12AB1234',
  status: 'CHECKED_IN',
  approverName: 'Ravi Kumar',
  approverId: IDS.resident,
  decidedAt: '2026-07-23T14:31:12+05:30',
  checkedInAt: '2026-07-23T14:32:04+05:30',
} as VisitResponse;

export const gatesFixture: GateResponse[] = [
  { id: IDS.gateMain, name: 'Main Gate', createdAt: '2026-01-04T09:00:00+05:30' },
  { id: IDS.gateService, name: 'Service Gate', createdAt: '2026-01-04T09:01:00+05:30' },
] as GateResponse[];

export const blocksFixture: BlockResponse[] = [
  { id: IDS.blockA, name: 'Block A', flatCount: 2, createdAt: '2026-01-04T09:00:00+05:30' },
] as BlockResponse[];

export const flatsFixture: FlatResponse[] = [
  {
    id: IDS.flatA101,
    number: 'A-101',
    blockId: IDS.blockA,
    blockName: 'Block A',
    createdAt: '2026-01-04T09:02:00+05:30',
  },
  {
    id: IDS.flatA102,
    number: 'A-102',
    blockId: IDS.blockA,
    blockName: 'Block A',
    createdAt: '2026-01-04T09:03:00+05:30',
  },
] as FlatResponse[];

export const usersFixture: UserResponse[] = [
  {
    id: IDS.resident,
    loginId: 'A-101-1',
    fullName: 'Ravi Kumar',
    role: 'RESIDENT',
    phone: '+919812345678',
    email: null,
    active: true,
    mustResetPassword: false,
    onDuty: false,
    flatId: IDS.flatA101,
    flatNumber: 'A-101',
    blockName: 'Block A',
    createdAt: '2026-02-10T11:00:00+05:30',
  },
  {
    id: IDS.guard,
    loginId: 'guard-01',
    fullName: 'Gate Guard 1',
    role: 'GUARD',
    phone: null,
    email: null,
    active: true,
    mustResetPassword: true,
    onDuty: false,
    flatId: null,
    flatNumber: null,
    blockName: null,
    createdAt: '2026-02-11T08:00:00+05:30',
  },
] as UserResponse[];

export const notificationFixture: NotificationResponse = {
  id: IDS.notification,
  title: 'Water supply interruption',
  body: 'Water will be off in Block A from 10am to 2pm on Tuesday for tank cleaning.',
  audienceRule: { mode: 'BLOCKS', blockIds: [IDS.blockA] },
  status: 'SENT',
  recipientCount: 312,
  deliveredCount: 441,
  sentAt: '2026-07-20T09:00:00+05:30',
  createdAt: '2026-07-20T08:59:00+05:30',
} as NotificationResponse;

export const postFixture: PostResponse = {
  id: IDS.post,
  title: 'Clubhouse reopens Saturday',
  body: 'The clubhouse reopens this Saturday after repainting. Booking resumes from Monday.',
  imageUrl: null,
  pinned: true,
  authorName: 'Priya Nair',
  publishedAt: '2026-07-19T17:20:00+05:30',
} as PostResponse;

export function page<T>(content: T[], overrides: Partial<PageResponse<T>> = {}): PageResponse<T> {
  return {
    content,
    page: 0,
    size: 25,
    totalElements: content.length,
    totalPages: content.length === 0 ? 0 : 1,
    first: true,
    last: true,
    ...overrides,
  };
}

/** The error envelope, for the §12 requirement that every screen is tested against every code. */
export function apiError(status: number, code: string, message: string, extra: object = {}) {
  return {
    timestamp: '2026-07-23T14:30:00+05:30',
    status,
    error: code,
    code,
    message,
    path: '/api/v1/test',
    correlationId: 'cid-0000-1111',
    ...extra,
  };
}
