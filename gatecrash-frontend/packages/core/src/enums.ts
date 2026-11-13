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
export const USER_ROLES = ['SUPER_ADMIN', 'ADMIN', 'GUARD', 'RESIDENT'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/**
 * There is no SALES role (V6). Sales is a flag — `sales: true` — on an ADMIN or GUARD account,
 * which the server turns into the SALES authority. These are the roles allowed to carry it.
 */
export const SALES_CAPABLE_ROLES = ['ADMIN', 'GUARD'] as const satisfies readonly UserRole[];

export function canBeSales(role: UserRole): boolean {
  return (SALES_CAPABLE_ROLES as readonly UserRole[]).includes(role);
}

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
  'HOUSING_SOCIETY',
  'RESIDENTIAL_COLONY',
  'BUILDER_FLOOR',
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
  'MARKET',
  // Mixed & institutional
  'INSTITUTIONAL_CAMPUS',
  'MIXED_USE',
] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

/** Groups the project-type picker, which is otherwise fifteen undifferentiated dropdown rows. */
export const PROPERTY_CATEGORIES = ['RESIDENTIAL', 'COMMERCIAL', 'MIXED'] as const;
export type PropertyCategory = (typeof PROPERTY_CATEGORIES)[number];

/**
 * There is no CLIENT type (V6): whether a visitor came to meet the sales team is the separate
 * `meetSalesAgent` tick-box on the visit.
 */
export const VISITOR_TYPES = ['GUEST', 'DELIVERY', 'MAINTENANCE'] as const;
export type VisitorType = (typeof VISITOR_TYPES)[number];

export const VISIT_STATUSES = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
  'CHECKED_IN',
  'CHECKED_OUT',
  // V7: "Leave at Gate" — the courier stays out, security holds the parcel until collected.
  'LEFT_AT_GATE',
  'COLLECTED',
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

/**
 * Every mode the server understands. FLATS and BLOCKS are kept so stored history still parses;
 * the composer sends NODES — any mix of buildings, floors and units — instead.
 */
export const AUDIENCE_MODES = [
  'ALL',
  'ALL_EXCEPT',
  'ROLES',
  'FLATS',
  'BLOCKS',
  'NODES',
  'SALES_TEAM',
] as const;
export type AudienceMode = (typeof AUDIENCE_MODES)[number];

export const DECISIONS = ['APPROVED', 'REJECTED', 'LEAVE_AT_GATE'] as const;
export type Decision = (typeof DECISIONS)[number];

/** V8. A one-time pass covers one visit; a frequent pass any number inside its date range. */
export const PASS_TYPES = ['ONE_TIME', 'FREQUENT'] as const;
export type PassType = (typeof PASS_TYPES)[number];

export const TICKET_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_CATEGORIES = [
  'MAINTENANCE',
  'PLUMBING',
  'ELECTRICAL',
  'HOUSEKEEPING',
  'SECURITY',
  'PARKING',
  'BILLING',
  'OTHER',
] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

export const BOOKING_STATUSES = ['CONFIRMED', 'CANCELLED'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const MOVE_TYPES = ['MOVE_IN', 'MOVE_OUT'] as const;
export type MoveType = (typeof MOVE_TYPES)[number];

export const MOVE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'COMPLETED'] as const;
export type MoveStatus = (typeof MOVE_STATUSES)[number];

export const INVOICE_STATUSES = ['UNPAID', 'PAID'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const INVOICE_CATEGORIES = [
  'MAINTENANCE',
  'ELECTRICITY',
  'WATER',
  'PARKING',
  'AMENITY',
  'PENALTY',
  'OTHER',
] as const;
export type InvoiceCategory = (typeof INVOICE_CATEGORIES)[number];

/** Society rules (V10): request -> office decision; either side can end an approved rule. */
export const ENTRY_RULE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'REVOKED'] as const;
export type EntryRuleStatus = (typeof ENTRY_RULE_STATUSES)[number];

/** Daily help works for households; society staff work for the society (V11). */
export const STAFF_SCOPES = ['DAILY_HELP', 'SOCIETY_STAFF'] as const;
export type StaffScope = (typeof STAFF_SCOPES)[number];

export const STAFF_CATEGORIES = [
  'MAID',
  'COOK',
  'DRIVER',
  'NANNY',
  'CAR_CLEANER',
  'GARDENER',
  'ELDER_CARE',
  'LAUNDRY',
  'HOUSEKEEPING',
  'SECURITY',
  'ELECTRICIAN',
  'PLUMBER',
  'MAINTENANCE',
  'OFFICE',
  'OTHER',
] as const;
export type StaffCategory = (typeof STAFF_CATEGORIES)[number];

/** The categories offered for each scope. The backend accepts any; this keeps the pickers sensible. */
export const HELP_CATEGORIES = [
  'MAID',
  'COOK',
  'DRIVER',
  'NANNY',
  'CAR_CLEANER',
  'GARDENER',
  'ELDER_CARE',
  'LAUNDRY',
  'OTHER',
] as const satisfies readonly StaffCategory[];
export const SOCIETY_STAFF_CATEGORIES = [
  'HOUSEKEEPING',
  'SECURITY',
  'ELECTRICIAN',
  'PLUMBER',
  'MAINTENANCE',
  'GARDENER',
  'OFFICE',
  'OTHER',
] as const satisfies readonly StaffCategory[];
