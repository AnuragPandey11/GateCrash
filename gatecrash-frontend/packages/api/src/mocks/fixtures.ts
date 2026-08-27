import type {
  OccupancySummaryResponse,
  PropertyNodeResponse,
  PropertyTypeOption,
  PropertyProfileResponse,
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
  levelBlock: '6666aaaa-6666-4666-8666-666666666666',
  levelFlat: '6666bbbb-6666-4666-8666-666666666666',
  flatA101: '77777777-7777-4777-8777-777777777777',
  flatA102: '7777aaaa-7777-4777-8777-777777777777',
  visitPending: '88888888-8888-4888-8888-888888888888',
  visitInside: '8888aaaa-8888-4888-8888-888888888888',
  pass: '99999999-9999-4999-8999-999999999999',
  notification: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  post: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  township: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
} as const;

/** Every fixture below belongs to this one township — see `TOWNSHIP_CODE` for the login half. */
export const TOWNSHIP_CODE = 'GREENWOOD';

export const loginResponseFixture = {
  accessToken: 'header.payload.signature',
  refreshToken: 'opaque-refresh-token-value',
  tokenType: 'Bearer',
  expiresInSeconds: 1800,
  mustResetPassword: false,
  role: 'ADMIN',
  userId: IDS.admin,
  fullName: 'Priya Nair',
  townshipId: IDS.township,
  townshipCode: TOWNSHIP_CODE,
  townshipName: 'Greenwood Township',
};

/** A platform operator: no township at all, which is what `SUPER_ADMIN` means. */
export const superAdminLoginResponseFixture = {
  ...loginResponseFixture,
  role: 'SUPER_ADMIN',
  fullName: 'Platform Operator',
  townshipId: null,
  townshipCode: null,
  townshipName: null,
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
  townshipId: IDS.township,
  townshipCode: TOWNSHIP_CODE,
  townshipName: 'Greenwood Township',
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

/**
 * A two-level Block -> Flat project, matching what the backend seeds. The tree can express
 * Cluster -> Villa or Tower -> Floor -> Flat just as well; the default fixture stays the simple
 * shape so tests that do not care about structure read as they always did.
 */
export const propertyProfileFixture: PropertyProfileResponse = {
  propertyType: 'APARTMENT',
  propertyTypeLabel: 'Apartment complex',
  hasFloors: false,
  levels: [
    { id: IDS.levelBlock, depth: 0, kind: 'BUILDING', singular: 'Block', plural: 'Blocks', nodeCount: 1 },
    { id: IDS.levelFlat, depth: 1, kind: 'UNIT', singular: 'Flat', plural: 'Flats', nodeCount: 2 },
  ],
} as PropertyProfileResponse;

export const blocksFixture: PropertyNodeResponse[] = [
  {
    id: IDS.blockA,
    parentId: null,
    depth: 0,
    kind: 'BUILDING',
    name: 'Block A',
    code: null,
    levelNumber: null,
    declaredOccupancy: 0,
    residentAccounts: 0,
    childCount: 2,
    createdAt: '2026-01-04T09:00:00+05:30',
  },
] as PropertyNodeResponse[];

export const flatsFixture: PropertyNodeResponse[] = [
  {
    id: IDS.flatA101,
    parentId: IDS.blockA,
    depth: 1,
    kind: 'UNIT',
    name: 'A-101',
    code: 'A-101',
    levelNumber: null,
    // Four people live here; one of them has a login. That gap is the whole point of the field.
    declaredOccupancy: 4,
    residentAccounts: 1,
    childCount: 0,
    createdAt: '2026-01-04T09:02:00+05:30',
  },
  {
    id: IDS.flatA102,
    parentId: IDS.blockA,
    depth: 1,
    kind: 'UNIT',
    name: 'A-102',
    code: 'A-102',
    levelNumber: null,
    declaredOccupancy: 0,
    residentAccounts: 0,
    childCount: 0,
    createdAt: '2026-01-04T09:03:00+05:30',
  },
] as PropertyNodeResponse[];

/** Three of the fifteen presets — enough to prove grouping and structure preview. */
export const propertyTypesFixture = [
  {
    value: 'APARTMENT',
    label: 'Apartment complex',
    category: 'RESIDENTIAL',
    categoryLabel: 'Residential',
    description: 'Towers of floors of flats. The default for most urban housing projects.',
    hasFloors: true,
    defaultLevels: [
      { kind: 'BUILDING', singular: 'Tower', plural: 'Towers' },
      { kind: 'FLOOR', singular: 'Floor', plural: 'Floors' },
      { kind: 'UNIT', singular: 'Flat', plural: 'Flats' },
    ],
  },
  {
    value: 'VILLA',
    label: 'Villa community',
    category: 'RESIDENTIAL',
    categoryLabel: 'Residential',
    description: 'Clusters of independent villas. No floor level -- a villa is addressed whole.',
    hasFloors: false,
    defaultLevels: [
      { kind: 'GROUP', singular: 'Cluster', plural: 'Clusters' },
      { kind: 'UNIT', singular: 'Villa', plural: 'Villas' },
    ],
  },
  {
    value: 'RETAIL',
    label: 'Mall / retail centre',
    category: 'COMMERCIAL',
    categoryLabel: 'Commercial',
    description: 'Levels of shops. Visitors are routed to a tenant, not to a resident.',
    hasFloors: true,
    defaultLevels: [
      { kind: 'BUILDING', singular: 'Mall', plural: 'Malls' },
      { kind: 'FLOOR', singular: 'Level', plural: 'Levels' },
      { kind: 'UNIT', singular: 'Shop', plural: 'Shops' },
    ],
  },
] as PropertyTypeOption[];

export const occupancySummaryFixture: OccupancySummaryResponse = {
  totalUnits: 2,
  occupiedUnits: 1,
  vacantUnits: 1,
  occupancyRate: 0.5,
  residentHeadcount: 4,
  registeredResidentAccounts: 1,
  visitorsInside: 1,
};

export const usersFixture: UserResponse[] = [
  {
    id: IDS.resident,
    loginId: 'A-101-1',
    townshipId: IDS.township,
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
    townshipId: IDS.township,
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


// ── Platform (SUPER_ADMIN) ──────────────────────────────────────────────────────────────────

export const townshipFixture = {
  id: IDS.township,
  code: TOWNSHIP_CODE,
  name: 'Greenwood Township',
  status: 'ACTIVE',
  contactEmail: null,
  contactPhone: null,
  activeUserCount: 12,
  activeAdminCount: 1,
  blockCount: 2,
  gateCount: 1,
  createdAt: '2026-01-04T09:00:00+05:30',
  archivedAt: null,
};

/** A second tenant, archived — so a listing test can assert the includeArchived filter honestly. */
export const archivedTownshipFixture = {
  ...townshipFixture,
  id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  code: 'WESTGATE',
  name: 'Westgate Township',
  status: 'ARCHIVED',
  activeUserCount: 0,
  activeAdminCount: 1,
  archivedAt: '2026-06-01T10:00:00+05:30',
};
