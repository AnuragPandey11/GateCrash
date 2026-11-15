import type {
  ApproverKind,
  PropertyCategory,
  PropertyLevelId,
  PropertyNodeId,
  PropertyNodeKind,
  PropertyType,
  DeviceId,
  DevicePlatform,
  FlatId,
  GateId,
  InboxItemId,
  NotifStatus,
  NotificationId,
  PassId,
  PassStatus,
  PassType,
  PostId,
  QrToken,
  TownshipId,
  TownshipStatus,
  UserId,
  UserRole,
  VisitId,
  VisitStatus,
  VisitorType,
} from '@gatecrash/core';
import type { AudienceRule } from '@gatecrash/core';
import { z } from 'zod';
import {
  approverKindSchema,
  devicePlatformSchema,
  instant,
  notifStatusSchema,
  nullish,
  passStatusSchema,
  userRoleSchema,
  visitStatusSchema,
  visitorTypeSchema,
} from './enums';

/**
 * Response shapes — FRONTEND.md Appendix B, read off the backend DTOs.
 *
 * §4.2's rule: generated types are compile-time only, and Zod parsing is reserved for the handful
 * of payloads where a wrong shape would be silently destructive. Parsing *everything* is a tax
 * with no payer — a mis-typed `createdAt` on a community post renders "—", while a mis-typed
 * `mustResetPassword` lets someone past a forced password change.
 *
 * So: plain `interface`s for most of the API, and Zod schemas for `LoginResponse`, `MeResponse`,
 * `VisitResponse` and `RedeemPassResponse`.
 *
 * **Nullable fields are optional, not `| null`.** The backend runs with
 * `spring.jackson.default-property-inclusion: non_null`, so a null field is *absent from the
 * JSON* rather than present as `null` — verified against the running server, because this is
 * exactly the kind of thing a spec gets wrong and a `undefined` reaches a screen.
 *
 * The Zod-parsed types above are the exception: their schemas normalise absent to `null`, so a
 * `VisitResponse` really does have every key. That normalisation is a large part of why those
 * four payloads are worth parsing at all.
 */

// ── Parsed at the boundary (§4.2) ────────────────────────────────────────────────────────────

export const loginResponseSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  tokenType: z.string(),
  expiresInSeconds: z.number(),
  mustResetPassword: z.boolean(),
  role: userRoleSchema,
  /** On the sales team. Absent from an older server, hence the default. */
  sales: z.boolean().default(false),
  userId: z.string().uuid(),
  fullName: z.string(),
  // Null for a SUPER_ADMIN, which belongs to no township. The client needs all three: the id to
  // scope its own queries, and the code and name to show whose township this session is in.
  townshipId: nullish(z.string().uuid()),
  townshipCode: nullish(z.string()),
  townshipName: nullish(z.string()),
});
export type LoginResponse = Omit<z.infer<typeof loginResponseSchema>, 'userId' | 'townshipId'> & {
  userId: UserId;
  townshipId: TownshipId | null;
};

export const meResponseSchema = z.object({
  id: z.string().uuid(),
  loginId: z.string(),
  fullName: z.string(),
  role: userRoleSchema,
  sales: z.boolean().default(false),
  mustResetPassword: z.boolean(),
  onDuty: z.boolean(),
  flatId: nullish(z.string().uuid()),
  flatNumber: nullish(z.string()),
  blockName: nullish(z.string()),
  townshipId: nullish(z.string().uuid()),
  townshipCode: nullish(z.string()),
  townshipName: nullish(z.string()),
});
export type MeResponse = Omit<
  z.infer<typeof meResponseSchema>,
  'id' | 'flatId' | 'townshipId'
> & {
  id: UserId;
  flatId: FlatId | null;
  townshipId: TownshipId | null;
};

export const visitResponseSchema = z.object({
  id: z.string().uuid(),
  gateId: z.string().uuid(),
  gateName: z.string(),
  visitorName: z.string(),
  visitorPhone: nullish(z.string()),
  visitorType: visitorTypeSchema,
  meetSalesAgent: z.boolean().default(false),
  vehicleNo: nullish(z.string()),
  photoUrl: nullish(z.string()),
  status: visitStatusSchema,
  approverKind: nullish(approverKindSchema),
  approverId: nullish(z.string().uuid()),
  approverName: nullish(z.string()),
  targetFlatId: nullish(z.string().uuid()),
  targetFlatNumber: nullish(z.string()),
  preApprovalId: nullish(z.string().uuid()),
  loggedByName: z.string(),
  /**
   * Absent on the response to `POST /visits` — the row is not flushed when it is mapped — but
   * present on every GET. Verified against a running backend.
   *
   * This is a real gap, not just a parsing nuisance: the guard's pending-TTL countdown (§9.3) is
   * computed from `createdAt`, and the walk-in flow gets its visit from exactly that POST. Until
   * the backend populates it (FRONTEND.md §15.6), the countdown has no start time until the
   * first reconciliation fetch lands.
   */
  createdAt: nullish(instant),
  decidedAt: nullish(instant),
  checkedInAt: nullish(instant),
  checkedOutAt: nullish(instant),
  purpose: nullish(z.string()),
  expectedDurationMinutes: nullish(z.number().int()),
  expectedOutAt: nullish(instant),
  overstaying: z.boolean().default(false),
  collectedAt: nullish(instant),
  /** Present only on the response to a Leave-at-Gate decision — the one moment it exists. */
  collectionCode: nullish(z.string()),
  /** Let in by one of the home's society rules, not by a resident's tap. */
  autoApproved: z.boolean().default(false),
  /** The gate they left by; `gateId` is where they came in. They differ in a multi-gate township. */
  exitGateId: nullish(z.string().uuid()),
  exitGateName: nullish(z.string()),
});

export interface VisitResponse {
  id: VisitId;
  gateId: GateId;
  gateName: string;
  visitorName: string;
  visitorPhone: string | null;
  visitorType: VisitorType;
  /** The guard ticked "Meet Sales Agent": this visitor came to see the sales team. */
  meetSalesAgent: boolean;
  vehicleNo: string | null;
  photoUrl: string | null;
  status: VisitStatus;
  approverKind: ApproverKind | null;
  approverId: UserId | null;
  approverName: string | null;
  targetFlatId: FlatId | null;
  targetFlatNumber: string | null;
  preApprovalId: PassId | null;
  loggedByName: string;
  /** Null only on the `POST /visits` response — see the schema note above and §15.6. */
  createdAt: string | null;
  decidedAt: string | null;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  purpose: string | null;
  /** How long the visitor expects to stay — set by the guard, the resident, or the pass. */
  expectedDurationMinutes: number | null;
  /** Set at check-in; the overstay alert measures against it. */
  expectedOutAt: string | null;
  /** Inside and past `expectedOutAt`. */
  overstaying: boolean;
  collectedAt: string | null;
  collectionCode: string | null;
  autoApproved: boolean;
  exitGateId: string | null;
  exitGateName: string | null;
}

export const redeemPassResponseSchema = z.object({
  passId: z.string().uuid(),
  visit: visitResponseSchema,
  /** Absent for a frequent pass: unlimited inside its window. */
  remainingUses: nullish(z.number().int()),
});
export interface RedeemPassResponse {
  passId: PassId;
  visit: VisitResponse;
  remainingUses: number | null;
}

// ── Trusted from the generated types (§4.2) ─────────────────────────────────────────────────

export interface OccupancyResponse {
  insideCount: number;
  visits: VisitResponse[];
}

export interface UserResponse {
  id: UserId;
  loginId: string;
  /** The tenant this account belongs to. Always present — only a SUPER_ADMIN has none. */
  townshipId: TownshipId;
  fullName: string;
  role: UserRole;
  /** On the sales team — a flag on an ADMIN or GUARD account, not a role. */
  sales: boolean;
  phone?: string | null;
  email?: string | null;
  active: boolean;
  mustResetPassword: boolean;
  onDuty: boolean;
  flatId?: FlatId | null;
  flatNumber?: string | null;
  blockName?: string | null;
  createdAt: string;
}

/**
 * `generatedPassword` is returned exactly once and must never leave component state (§14.3).
 *
 * `townshipId` is echoed back because `loginId` alone no longer identifies the account — the
 * credential handed over is the pair, so a sign-in card has to print the township's code too.
 * It is `null` for a super admin, who signs in without one.
 */
export interface CreatedUserResponse {
  id: UserId;
  loginId: string;
  fullName: string;
  role: UserRole;
  sales: boolean;
  townshipId: TownshipId | null;
  generatedPassword: string;
}

// ── Platform (super admin) ──────────────────────────────────────────────────────────────────

export interface TownshipResponse {
  id: TownshipId;
  code: string;
  name: string;
  status: TownshipStatus;
  contactEmail?: string | null;
  contactPhone?: string | null;
  activeUserCount: number;
  activeAdminCount: number;
  blockCount: number;
  gateCount: number;
  createdAt: string;
  archivedAt?: string | null;
}

/** `admin.generatedPassword` is the one-time credential for the township's first administrator. */
export interface CreatedTownshipResponse {
  township: TownshipResponse;
  admin: CreatedUserResponse;
}

export interface SuperAdminResponse {
  id: UserId;
  loginId: string;
  fullName: string;
  phone?: string | null;
  email?: string | null;
  active: boolean;
  mustResetPassword: boolean;
  createdAt: string;
}

export interface ResetPasswordResponse {
  id: UserId;
  loginId: string;
  generatedPassword: string;
}

export interface SalesAgentResponse {
  id: UserId;
  fullName: string;
  loginId: string;
}

/** `pin` is returned exactly once and is never retrievable again (§14.3). */
export interface CreatePassResponse {
  id: PassId;
  passType: PassType;
  pin: string;
  qrToken: QrToken;
  validFrom: string;
  validUntil: string;
  /** Absent for a frequent pass. */
  maxUses?: number | null;
}

/** What the guard sees after a scan, before anything is used up. */
export interface PassPreviewResponse {
  passId: PassId;
  passType: PassType;
  visitorName?: string | null;
  visitorPhone?: string | null;
  visitorType: VisitorType;
  purpose?: string | null;
  vehicleNo?: string | null;
  hostName: string;
  hostUnitCode?: string | null;
  meetSalesAgent: boolean;
  expectedArrivalAt?: string | null;
  validFrom: string;
  validUntil: string;
  expectedDurationMinutes?: number | null;
  maxUses?: number | null;
  useCount: number;
  redeemable: boolean;
  /** Null when usable now; otherwise NOT_YET_VALID, EXPIRED, USES_EXHAUSTED or STATUS_<x>. */
  problem?: string | null;
}

export interface PassResponse {
  id: PassId;
  passType: PassType;
  visitorName?: string | null;
  visitorPhone?: string | null;
  visitorType: VisitorType;
  purpose?: string | null;
  vehicleNo?: string | null;
  status: PassStatus;
  pinLast4?: string | null;
  qrToken: QrToken;
  expectedArrivalAt?: string | null;
  validFrom: string;
  validUntil: string;
  expectedDurationMinutes?: number | null;
  /** Absent for a frequent pass: unlimited inside its window. */
  maxUses?: number | null;
  useCount: number;
  createdAt: string;
}

export interface NotificationResponse {
  id: NotificationId;
  title: string;
  body: string;
  audienceRule: AudienceRule;
  status: NotifStatus;
  recipientCount: number;
  deliveredCount: number;
  sentAt?: string | null;
  /**
   * Absent on the response to `POST /notifications` (the row is not flushed when it is mapped)
   * but present when read back from the history list. Observed against a running backend — the
   * history screen therefore falls back to `sentAt`.
   */
  createdAt?: string | null;
}

export interface AudiencePreviewResponse {
  recipientCount: number;
  deviceCount: number;
}

export interface InboxItemResponse {
  id: InboxItemId;
  notificationId: NotificationId;
  title: string;
  body: string;
  read: boolean;
  readAt?: string | null;
  sentAt?: string | null;
}

export interface UnreadCountResponse {
  unread: number;
}

export interface PostResponse {
  id: PostId;
  title: string;
  body: string;
  imageUrl?: string | null;
  pinned: boolean;
  authorName: string;
  publishedAt: string;
}

/**
 * One level of a township's hierarchy, with the developer's own word for it.
 *
 * The admin console renders one structure tab per level from these, which is what makes the panel
 * adapt per developer: a villa community returns Cluster/Villa, a high-rise returns
 * Tower/Floor/Flat, and no component knows the difference.
 */
export interface PropertyLevelResponse {
  id: PropertyLevelId;
  depth: number;
  /** Branch on this, never on the labels. */
  kind: PropertyNodeKind;
  singular: string;
  plural: string;
  nodeCount: number;
}

export interface PropertyProfileResponse {
  propertyType: PropertyType;
  propertyTypeLabel: string;
  hasFloors: boolean;
  /** Ordered shallowest-first; exactly one has `kind === 'UNIT'`, and it is last. */
  levels: PropertyLevelResponse[];
}

/**
 * Note the optional markers on every nullable field. The API is configured
 * `default-property-inclusion: non_null`, so a null is *omitted from the payload* rather than sent
 * as `null` — a root node has no `parentId` key at all. Declaring these as `X | null` alone would
 * be a type that never matches the wire; `?:` is what the runtime actually hands back.
 */
export interface PropertyNodeResponse {
  id: PropertyNodeId;
  parentId?: PropertyNodeId | null;
  depth: number;
  kind: PropertyNodeKind;
  name: string;
  /** Units only. What a guard types; resident login IDs derive from it. */
  code?: string | null;
  /** Floors only. Signed — basements are real. */
  levelNumber?: number | null;
  /**
   * The building or grouping this node sits in — "Tower A", "Rose Cluster". Floors are walked
   * past, so a flat on storey 14 of Tower A reports "Tower A" rather than "14". Null for a root.
   *
   * Served by the API rather than derived here, so the screens that group units by building
   * (provisioning, audience builder, visit filter) all agree.
   */
  containerName?: string | null;
  /** Units only: people living here, including those with no app account. */
  declaredOccupancy: number;
  /** Units only: accounts that can actually sign in. Always ≤ declaredOccupancy. */
  residentAccounts: number;
  childCount: number;
  createdAt: string;
}

export interface BulkCreateResponse {
  floorsCreated: number;
  unitsCreated: number;
  codes: string[];
}

/**
 * One entry in the project-type catalogue the super admin picks from at onboarding.
 *
 * `defaultLevels` comes with it so the console can show the structure a choice would produce
 * *before* the township exists — which matters because the level set is the one thing that cannot
 * be reshaped once the tree holds anything.
 */
export interface PropertyTypeOption {
  value: PropertyType;
  label: string;
  category: PropertyCategory;
  categoryLabel: string;
  description: string;
  hasFloors: boolean;
  defaultLevels: { kind: PropertyNodeKind; singular: string; plural: string }[];
}

/**
 * The three questions that used to share the word "occupancy".
 *
 * `visitorsInside` is the number `/admin/inside` has always returned. The others did not exist
 * before V4 — and the first of them is the one a developer means when they ask about occupancy.
 */
export interface OccupancySummaryResponse {
  totalUnits: number;
  occupiedUnits: number;
  vacantUnits: number;
  /** 0–1. Occupied units over total units. */
  occupancyRate: number;
  /** People, from each unit's declared occupancy. */
  residentHeadcount: number;
  /** Accounts that can sign in. The gap to headcount is who cannot be notified yet. */
  registeredResidentAccounts: number;
  visitorsInside: number;
}

export interface GateResponse {
  id: GateId;
  name: string;
  createdAt: string;
}

/** The FCM token is never echoed back — the client already has it, and logs should not (§7.4). */
export interface DeviceResponse {
  id: DeviceId;
  platform: DevicePlatform;
  lastSeenAt: string;
  createdAt: string;
}

// Re-export the enum schemas used by the parse helpers above.
export { notifStatusSchema, passStatusSchema, devicePlatformSchema };
