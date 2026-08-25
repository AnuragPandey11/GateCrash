/**
 * Postgres enum types, mirrored exactly — FRONTEND.md Appendix A.
 *
 * The server rejects anything that is not one of these values, so the arrays double as the
 * single source for dropdown options and for the Zod enums in `@gatecrash/api`. Adding a value
 * here without the matching Flyway migration is how you ship a 400 to a gate.
 */

/**
 * `SUPER_ADMIN` is first because it is the only role that lives outside a township — its
 * `townshipId` is `null`, it signs in without a township code, and it carries ADMIN authority into
 * whichever township it names on a request. Everything else is scoped to exactly one township.
 */
export const USER_ROLES = ['SUPER_ADMIN', 'ADMIN', 'GUARD', 'RESIDENT', 'SALES'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const TOWNSHIP_STATUSES = ['ACTIVE', 'SUSPENDED', 'ARCHIVED'] as const;
export type TownshipStatus = (typeof TOWNSHIP_STATUSES)[number];

export const VISITOR_TYPES = ['GUEST', 'DELIVERY', 'MAINTENANCE', 'CLIENT'] as const;
export type VisitorType = (typeof VISITOR_TYPES)[number];

export const VISIT_STATUSES = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
  'CHECKED_IN',
  'CHECKED_OUT',
] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];

export const APPROVER_KINDS = ['RESIDENT', 'SALES'] as const;
export type ApproverKind = (typeof APPROVER_KINDS)[number];

export const PASS_STATUSES = ['ACTIVE', 'REDEEMED', 'EXPIRED', 'REVOKED'] as const;
export type PassStatus = (typeof PASS_STATUSES)[number];

export const NOTIF_STATUSES = ['QUEUED', 'SENT', 'FAILED'] as const;
export type NotifStatus = (typeof NOTIF_STATUSES)[number];

export const DEVICE_PLATFORMS = ['ANDROID', 'IOS', 'WEB'] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

export const AUDIENCE_MODES = ['ALL', 'ALL_EXCEPT', 'ROLES', 'FLATS', 'BLOCKS'] as const;
export type AudienceMode = (typeof AUDIENCE_MODES)[number];

export const DECISIONS = ['APPROVED', 'REJECTED'] as const;
export type Decision = (typeof DECISIONS)[number];
