import type {
  ApproverKind,
  BlockId,
  DeviceId,
  DevicePlatform,
  FlatId,
  GateId,
  InboxItemId,
  NotifStatus,
  NotificationId,
  PassId,
  PassStatus,
  PostId,
  QrToken,
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
  userId: z.string().uuid(),
  fullName: z.string(),
});
export type LoginResponse = Omit<z.infer<typeof loginResponseSchema>, 'userId'> & { userId: UserId };

export const meResponseSchema = z.object({
  id: z.string().uuid(),
  loginId: z.string(),
  fullName: z.string(),
  role: userRoleSchema,
  mustResetPassword: z.boolean(),
  onDuty: z.boolean(),
  flatId: nullish(z.string().uuid()),
  flatNumber: nullish(z.string()),
  blockName: nullish(z.string()),
});
export type MeResponse = Omit<z.infer<typeof meResponseSchema>, 'id' | 'flatId'> & {
  id: UserId;
  flatId: FlatId | null;
};

export const visitResponseSchema = z.object({
  id: z.string().uuid(),
  gateId: z.string().uuid(),
  gateName: z.string(),
  visitorName: z.string(),
  visitorPhone: nullish(z.string()),
  visitorType: visitorTypeSchema,
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
});

export interface VisitResponse {
  id: VisitId;
  gateId: GateId;
  gateName: string;
  visitorName: string;
  visitorPhone: string | null;
  visitorType: VisitorType;
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
}

export const redeemPassResponseSchema = z.object({
  passId: z.string().uuid(),
  visit: visitResponseSchema,
  remainingUses: z.number().int(),
});
export interface RedeemPassResponse {
  passId: PassId;
  visit: VisitResponse;
  remainingUses: number;
}

// ── Trusted from the generated types (§4.2) ─────────────────────────────────────────────────

export interface OccupancyResponse {
  insideCount: number;
  visits: VisitResponse[];
}

export interface UserResponse {
  id: UserId;
  loginId: string;
  fullName: string;
  role: UserRole;
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

/** `generatedPassword` is returned exactly once and must never leave component state (§14.3). */
export interface CreatedUserResponse {
  id: UserId;
  loginId: string;
  fullName: string;
  role: UserRole;
  generatedPassword: string;
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
  pin: string;
  qrToken: QrToken;
  validFrom: string;
  validUntil: string;
  maxUses: number;
}

export interface PassResponse {
  id: PassId;
  visitorName?: string | null;
  visitorPhone?: string | null;
  visitorType: VisitorType;
  status: PassStatus;
  pinLast4?: string | null;
  qrToken: QrToken;
  validFrom: string;
  validUntil: string;
  maxUses: number;
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

export interface BlockResponse {
  id: BlockId;
  name: string;
  flatCount: number;
  createdAt: string;
}

export interface FlatResponse {
  id: FlatId;
  number: string;
  blockId: BlockId;
  blockName: string;
  createdAt: string;
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
