import {
  APPROVER_KINDS,
  AUDIENCE_MODES,
  DECISIONS,
  DEVICE_PLATFORMS,
  NOTIF_STATUSES,
  PASS_STATUSES,
  TOWNSHIP_STATUSES,
  USER_ROLES,
  VISIT_STATUSES,
  VISITOR_TYPES,
} from '@gatecrash/core';
import { z } from 'zod';

/** Zod mirrors of the Postgres enums. Built from `@gatecrash/core`'s arrays so they cannot drift. */
export const userRoleSchema = z.enum(USER_ROLES);
export const visitorTypeSchema = z.enum(VISITOR_TYPES);
export const visitStatusSchema = z.enum(VISIT_STATUSES);
export const approverKindSchema = z.enum(APPROVER_KINDS);
export const passStatusSchema = z.enum(PASS_STATUSES);
export const notifStatusSchema = z.enum(NOTIF_STATUSES);
export const devicePlatformSchema = z.enum(DEVICE_PLATFORMS);
export const audienceModeSchema = z.enum(AUDIENCE_MODES);
export const decisionSchema = z.enum(DECISIONS);
export const townshipStatusSchema = z.enum(TOWNSHIP_STATUSES);

/** UUID, branded on the way out so ids stay distinguishable downstream (§4.6). */
export const uuid = <B extends string>() => z.string().uuid() as unknown as z.ZodType<B>;

/** Java `OffsetDateTime` — ISO-8601 with an offset. Kept as a string; parsed at render time. */
export const instant = z.string().min(1);

/**
 * A field the server may omit entirely.
 *
 * The backend runs with `spring.jackson.default-property-inclusion: non_null`, so a null field
 * is **absent from the JSON**, not present as `null`. A plain `.nullable()` would reject that —
 * `undefined` is not `null` — and every response carrying an optional field would fail to parse.
 *
 * Accepting both and normalising to `null` is what lets the rest of the app write
 * `visit.visitorPhone ?? '—'` against one shape instead of two.
 */
export const nullish = <T extends z.ZodTypeAny>(schema: T) =>
  schema
    .nullish()
    .transform((v): z.infer<T> | null => (v === undefined ? null : (v as z.infer<T> | null)));
