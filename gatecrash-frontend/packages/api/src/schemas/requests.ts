import {
  AUDIENCE_LIMITS,
  PROPERTY_NODE_KINDS,
  SERVER_DEFAULTS,
  type AudienceRule,
} from '@gatecrash/core';
import { z } from 'zod';
import { audienceModeSchema, decisionSchema, devicePlatformSchema, userRoleSchema, visitorTypeSchema } from './enums';

/**
 * Client-side validation mirroring the server — FRONTEND.md §4.7.
 *
 * These are read off the Jakarta constraints on the backend DTOs. The point is to tell the user
 * before the round-trip; the server still re-checks every one of them. When a DTO's constraints
 * change, these change in the same PR — a client rule that is *looser* than the server's produces
 * a confusing 400, and one that is *tighter* silently blocks a legitimate value.
 */

/** `UserDtos.LOGIN_ID_PATTERN` */
export const LOGIN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/;
/** `UserDtos.PHONE_PATTERN`, and the same regex on `CreateVisitRequest.visitorPhone`. */
export const PHONE_PATTERN = /^\+?[0-9]{7,15}$/;
/** `RedeemPassRequest.pin` — the mint length is 6, the field accepts 4–10. */
export const PIN_PATTERN = /^[0-9]{4,10}$/;

const optionalTrimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === '' ? undefined : v));

/**
 * Make a constrained field genuinely optional in a *form*.
 *
 * `schema.optional()` alone accepts `undefined` but not `''` — and an untouched React Hook Form
 * text input holds `''`, not `undefined`. Without this, leaving an optional phone number blank
 * fails validation with "must be 7-15 digits" on an empty field, and the form silently refuses
 * to submit. The empty string is normalised away so the request body omits the key entirely,
 * which is also what the server wants (a blank `phone` would fail its own `@Pattern`).
 */
const optionalField = <T extends z.ZodTypeAny>(schema: T) =>
  z
    .union([schema, z.literal('')])
    .optional()
    .transform((v) => (v === '' || v === undefined ? undefined : (v as z.infer<T>)));

export const loginIdSchema = z
  .string()
  .trim()
  .regex(LOGIN_ID_PATTERN, 'Use 2–64 characters: letters, digits, dot, dash or underscore.');

export const phoneSchema = z
  .string()
  .trim()
  .regex(PHONE_PATTERN, 'Use 7–15 digits, optionally starting with +');

export const newPasswordSchema = z
  .string()
  .min(SERVER_DEFAULTS.passwordMinLength, `Use at least ${SERVER_DEFAULTS.passwordMinLength} characters.`)
  .max(SERVER_DEFAULTS.passwordMaxLength);

/**
 * An https URL on a host the backend's `SafeUrl` allowlist accepts.
 *
 * The client cannot know the allowlist, so it checks the half it can — the scheme and the length
 * — and lets the server reject an off-allowlist host with a `VALIDATION_FAILED` we surface on the
 * field. Blocks until §15.1 gives us an upload endpoint.
 */
export const safeUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .url('Enter a full URL.')
  .refine((v) => v.startsWith('https://'), 'The URL must start with https://');

// ── Auth ────────────────────────────────────────────────────────────────────────────────────

/**
 * Login is `(townshipCode, loginId, password)`.
 *
 * The code is part of the credential, not a convenience field: login ids are unique only within a
 * township, so `A-101-1` exists in every township with a block A. It is optional for exactly one
 * caller — a SUPER_ADMIN belongs to no township and signs in without one.
 *
 * The transform to `undefined` matters: an empty string is a *present* code that matches no
 * township, which the server correctly answers with 401. Dropping it instead resolves against the
 * platform namespace, which is what an operator leaving the field blank actually means.
 */
export const loginRequestSchema = z.object({
  townshipCode: z
    .string()
    .trim()
    .max(32)
    .optional()
    .transform((value) => (value ? value.toUpperCase() : undefined)),
  loginId: z.string().trim().min(1, 'Enter your login ID.').max(64),
  password: z.string().min(1, 'Enter your password.').max(128),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password.').max(128),
  newPassword: newPasswordSchema,
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

// ── Visits ──────────────────────────────────────────────────────────────────────────────────

export const createVisitRequestSchema = z
  .object({
    gateId: z.string().uuid(),
    visitorType: visitorTypeSchema,
    visitorName: z.string().trim().min(1, 'Enter the visitor’s name.').max(120),
    visitorPhone: optionalField(phoneSchema),
    vehicleNo: optionalTrimmed(20),
    photoUrl: optionalField(safeUrlSchema),
    targetFlatId: z.string().uuid().optional(),
    /** The "Meet Sales Agent" tick-box. When set, the visit routes to a sales agent, not a unit. */
    meetSalesAgent: z.boolean().default(false),
    salesAgentId: z.string().uuid().optional(),
    purpose: optionalTrimmed(200),
    /** Optional at the gate: the resident can set it when approving instead. */
    expectedDurationMinutes: z.number().int().min(5).max(10080).optional(),
  })
  .superRefine((value, ctx) => {
    // Mirrors the `sales_meeting_routes_to_sales` CHECK on `visitor_log`: a visitor here to meet
    // sales routes to a sales agent and everyone else to a unit. Submitting the wrong one is a
    // DB-level rejection, so catching it here is the difference between a clear message and a
    // 500-shaped surprise.
    if (value.meetSalesAgent) {
      if (!value.salesAgentId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['salesAgentId'],
          message: 'Pick the sales agent this visitor is here to meet.',
        });
      }
    } else if (!value.targetFlatId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['targetFlatId'],
        message: 'Pick the flat this visitor is going to.',
      });
    }
  });
export type CreateVisitRequest = z.infer<typeof createVisitRequestSchema>;

export const visitDecisionRequestSchema = z.object({ decision: decisionSchema });

// ── Passes ──────────────────────────────────────────────────────────────────────────────────

/**
 * A resident's pre-approval. It asks for the same details as the guard's walk-in form, and is
 * stricter about two: the visitor's phone (the guard may need to call them) and when they leave —
 * the out time for a one-time pass, the per-visit duration for a frequent one.
 *
 *  - ONE_TIME: `validFrom` = expected arrival, `validUntil` = out time (≤ 24 h apart). The QR works
 *    from an hour before the arrival until the out time.
 *  - FREQUENT: `validFrom`/`validUntil` = first/last day; works any time in between, unlimited
 *    entries; `expectedDurationMinutes` is required.
 */
export const createPassRequestSchema = z
  .object({
    passType: z.enum(['ONE_TIME', 'FREQUENT']),
    visitorName: z.string().trim().min(1, 'Enter the visitor’s name.').max(120),
    visitorPhone: phoneSchema,
    visitorType: visitorTypeSchema,
    purpose: optionalTrimmed(200),
    vehicleNo: optionalTrimmed(20),
    validFrom: z.string().min(1, 'Pick a start.'),
    validUntil: z.string().min(1, 'Pick an end.'),
    expectedDurationMinutes: z.number().int().min(5).max(1440).optional(),
    maxUses: z.number().int().min(1).max(SERVER_DEFAULTS.passMaxUsesLimit).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.passType === 'FREQUENT' && !value.expectedDurationMinutes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expectedDurationMinutes'],
        message: 'Say how long each visit lasts.',
      });
    }
    if (value.validFrom && value.validUntil && new Date(value.validUntil) <= new Date(value.validFrom)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['validUntil'],
        message: value.passType === 'FREQUENT' ? 'The end date must be after the start.' : 'The out time must be after arrival.',
      });
    }
  });
export type CreatePassRequest = z.infer<typeof createPassRequestSchema>;

export const redeemPassRequestSchema = z
  .object({
    pin: z.string().regex(PIN_PATTERN, 'Enter the digits from the pass.').optional(),
    qrToken: z.string().uuid().optional(),
    gateId: z.string().uuid(),
  })
  .refine((v) => Boolean(v.pin) !== Boolean(v.qrToken), {
    message: 'Supply exactly one of a PIN or a scanned code.',
  });

// ── Users ───────────────────────────────────────────────────────────────────────────────────

export const createUserRequestSchema = z
  .object({
    role: userRoleSchema,
    flatId: z.string().uuid().optional(),
    loginId: optionalField(loginIdSchema),
    fullName: z.string().trim().min(1, 'Enter a full name.').max(120),
    phone: optionalField(phoneSchema),
    email: optionalField(z.string().trim().email('Enter a valid email address.').max(200)),
    /** The "Is Sales" tick-box. ADMIN and GUARD only — the server refuses it on a resident. */
    sales: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.sales && value.role !== 'ADMIN' && value.role !== 'GUARD') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sales'],
        message: 'Only admin and guard accounts can be on the sales team.',
      });
    }
    // The server derives a resident's login id from the flat (`A-101-1`), so the form hides the
    // field entirely for RESIDENT and requires the flat instead (§8.7).
    if (value.role === 'RESIDENT') {
      if (!value.flatId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['flatId'], message: 'Pick a flat.' });
      }
    } else if (!value.loginId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['loginId'], message: 'Enter a login ID.' });
    }
  });
export type CreateUserRequest = z.infer<typeof createUserRequestSchema>;

export const updateUserRequestSchema = z.object({
  fullName: z.string().trim().min(1).max(120).optional(),
  phone: optionalField(phoneSchema),
  email: optionalField(z.string().trim().email('Enter a valid email address.').max(200)),
  /** Move the account on to or off the sales team. ADMIN/GUARD only. */
  sales: z.boolean().optional(),
});
export type UpdateUserRequest = z.infer<typeof updateUserRequestSchema>;

// ── Notifications ───────────────────────────────────────────────────────────────────────────

export const audienceRuleSchema = z.object({
  mode: audienceModeSchema,
  roles: z.array(userRoleSchema).max(AUDIENCE_LIMITS.roles).optional(),
  flatIds: z.array(z.string().uuid()).max(AUDIENCE_LIMITS.flatIds).optional(),
  blockIds: z.array(z.string().uuid()).max(AUDIENCE_LIMITS.blockIds).optional(),
  nodeIds: z.array(z.string().uuid()).max(AUDIENCE_LIMITS.nodeIds).optional(),
  userIds: z.array(z.string().uuid()).max(AUDIENCE_LIMITS.userIds).optional(),
});

export const createNotificationRequestSchema = z.object({
  title: z.string().trim().min(1, 'Enter a title.').max(200),
  body: z.string().trim().min(1, 'Enter a message.').max(2000),
  audienceRule: audienceRuleSchema,
});

/**
 * The rule is typed as `@gatecrash/core`'s `AudienceRule` rather than the Zod inference: the
 * builder's lists are nullable (a mode that carries no roles yet), and the endpoint normalises
 * through `buildAudienceRule` before anything is sent.
 */
export type CreateNotificationRequest = Omit<
  z.infer<typeof createNotificationRequestSchema>,
  'audienceRule'
> & { audienceRule: AudienceRule };

// ── Community ───────────────────────────────────────────────────────────────────────────────

/**
 * `body` is rich-text HTML from the editor. The server sanitises it against an allowlist before
 * storing it (`RichTextSanitizer`); the bound is generous because a picked image travels inline as
 * a data URI until there is an upload endpoint (§15.1).
 */
export const POST_BODY_MAX = 3_000_000;

export const createPostRequestSchema = z.object({
  title: z.string().trim().min(1, 'Enter a title.').max(200),
  body: z.string().trim().min(1, 'Enter a body.').max(POST_BODY_MAX),
  imageUrl: optionalField(safeUrlSchema),
  pinned: z.boolean(),
});
export type CreatePostRequest = z.infer<typeof createPostRequestSchema>;

// ── Township ────────────────────────────────────────────────────────────────────────────────

export const createGateRequestSchema = z.object({
  name: z.string().trim().min(1, 'Enter a gate name.').max(80),
});

// ── Property tree ───────────────────────────────────────────────────────────────────────────

/**
 * `kind` is absent on purpose: the server derives it from the level the node lands at, so a client
 * cannot file a floor where the project defines a unit. Send the parent and the name; the shape of
 * the tree decides the rest.
 */
export const createNodeRequestSchema = z.object({
  parentId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1, 'Enter a name.').max(80),
  /** Required at the unit level; the server defaults it to the name when omitted. */
  code: z.string().trim().max(40).optional(),
  /** Required at a floor level, rejected elsewhere. */
  levelNumber: z.number().int().min(-10).max(200).nullable().optional(),
  declaredOccupancy: z.number().int().min(0).max(64).optional(),
});
export type CreateNodeRequest = z.infer<typeof createNodeRequestSchema>;

export const updateNodeRequestSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name.').max(80),
  code: z.string().trim().max(40).optional(),
  levelNumber: z.number().int().min(-10).max(200).nullable().optional(),
});
export type UpdateNodeRequest = z.infer<typeof updateNodeRequestSchema>;

const levelSpecSchema = z.object({
  kind: z.enum(PROPERTY_NODE_KINDS),
  singular: z.string().trim().min(1).max(40),
  plural: z.string().trim().min(1).max(40),
});

/**
 * Whole-set, matching the endpoint: the levels are ordered and contiguous, so expressing a reshape
 * as independent per-level edits would let a caller stop halfway and leave the tree describing a
 * shape it no longer has.
 */
export const defineLevelsRequestSchema = z.object({
  levels: z.array(levelSpecSchema).min(1).max(6),
});
export type DefineLevelsRequest = z.infer<typeof defineLevelsRequestSchema>;

export const renameLevelRequestSchema = z.object({
  singular: z.string().trim().min(1, 'Enter a name.').max(40),
  plural: z.string().trim().min(1, 'Enter a plural.').max(40),
});
export type RenameLevelRequest = z.infer<typeof renameLevelRequestSchema>;

export const setOccupancyRequestSchema = z.object({
  declaredOccupancy: z.number().int().min(0).max(64),
});
export type SetOccupancyRequest = z.infer<typeof setOccupancyRequestSchema>;

export const bulkCreateRequestSchema = z.object({
  buildingId: z.string().uuid(),
  fromFloor: z.number().int().min(-10).max(200).nullable().optional(),
  toFloor: z.number().int().min(-10).max(200).nullable().optional(),
  unitsPerFloor: z.number().int().min(1).max(50),
  codePattern: z.string().trim().min(1).max(60),
  unitDigits: z.number().int().min(1).max(4).optional(),
});
export type BulkCreateRequest = z.infer<typeof bulkCreateRequestSchema>;

// ── Devices ─────────────────────────────────────────────────────────────────────────────────

export const registerDeviceRequestSchema = z.object({
  fcmToken: z.string().min(1).max(4096),
  platform: devicePlatformSchema,
});
