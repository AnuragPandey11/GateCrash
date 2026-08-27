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

/**
 * What a level in the property tree *is*, structurally — deliberately separate from what it is
 * *called*. The server branches on this and never on a label, and so must we: the moment a
 * component keys off `level.singular === 'Flat'`, renaming that level in the console changes
 * behaviour rather than wording.
 *
 * - `GROUP`    a non-physical grouping: phase, cluster, sector
 * - `BUILDING` a physical structure: tower, wing, block
 * - `FLOOR`    a storey; the only kind carrying `levelNumber`
 * - `UNIT`     the addressable leaf a resident lives in; exactly one level per township
 */
export const PROPERTY_NODE_KINDS = ['GROUP', 'BUILDING', 'FLOOR', 'UNIT'] as const;
export type PropertyNodeKind = (typeof PROPERTY_NODE_KINDS)[number];

/**
 * The kind of project a developer builds. Seeds a township's level set at onboarding; every label
 * stays editable afterwards, and a super admin can supply a custom level set instead.
 *
 * Mirrors the `property_type` Postgres enum. Adding one here without the matching Flyway migration
 * ships a 400 to an onboarding screen.
 */
export const PROPERTY_TYPES = [
  // Residential
  'APARTMENT',
  'VILLA',
  'ROW_HOUSE',
  'PLOTTED',
  'GATED_TOWNSHIP',
  'CO_LIVING',
  'STUDENT_HOUSING',
  'SENIOR_LIVING',
  'SERVICED_APARTMENT',
  'FARMHOUSE',
  // Commercial
  'COMMERCIAL',
  'IT_PARK',
  'RETAIL',
  'INDUSTRIAL',
  // Mixed
  'MIXED_USE',
] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

/** Groups the project-type picker, which is otherwise fifteen undifferentiated dropdown rows. */
export const PROPERTY_CATEGORIES = ['RESIDENTIAL', 'COMMERCIAL', 'MIXED'] as const;
export type PropertyCategory = (typeof PROPERTY_CATEGORIES)[number];

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
