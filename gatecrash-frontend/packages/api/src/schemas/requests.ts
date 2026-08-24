import { AUDIENCE_LIMITS, SERVER_DEFAULTS, type AudienceRule } from '@gatecrash/core';
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

export const loginRequestSchema = z.object({
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
    salesAgentId: z.string().uuid().optional(),
  })
  .superRefine((value, ctx) => {
    // Mirrors the `client_routes_to_sales` CHECK on `visitor_log`: a CLIENT must route to a sales
    // agent and everything else to a flat. Submitting the wrong one is a DB-level rejection, so
    // catching it here is the difference between a clear message and a 500-shaped surprise.
    if (value.visitorType === 'CLIENT') {
      if (!value.salesAgentId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['salesAgentId'],
          message: 'A client visit must be routed to a sales agent.',
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

export const createPassRequestSchema = z.object({
  visitorName: optionalTrimmed(120),
  visitorPhone: optionalField(phoneSchema),
  visitorType: visitorTypeSchema,
  validUntil: z.string().min(1),
  maxUses: z.coerce.number().int().min(1).max(SERVER_DEFAULTS.passMaxUsesLimit),
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
  })
  .superRefine((value, ctx) => {
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
});
export type UpdateUserRequest = z.infer<typeof updateUserRequestSchema>;

// ── Notifications ───────────────────────────────────────────────────────────────────────────

export const audienceRuleSchema = z.object({
  mode: audienceModeSchema,
  roles: z.array(userRoleSchema).max(AUDIENCE_LIMITS.roles).optional(),
  flatIds: z.array(z.string().uuid()).max(AUDIENCE_LIMITS.flatIds).optional(),
  blockIds: z.array(z.string().uuid()).max(AUDIENCE_LIMITS.blockIds).optional(),
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

export const createPostRequestSchema = z.object({
  title: z.string().trim().min(1, 'Enter a title.').max(200),
  body: z.string().trim().min(1, 'Enter a body.').max(10_000),
  imageUrl: optionalField(safeUrlSchema),
  pinned: z.boolean(),
});
export type CreatePostRequest = z.infer<typeof createPostRequestSchema>;

// ── Township ────────────────────────────────────────────────────────────────────────────────

export const createBlockRequestSchema = z.object({
  name: z.string().trim().min(1, 'Enter a block name.').max(80),
});
export const createFlatRequestSchema = z.object({
  blockId: z.string().uuid(),
  number: z.string().trim().min(1, 'Enter a flat number.').max(40),
});
export const createGateRequestSchema = z.object({
  name: z.string().trim().min(1, 'Enter a gate name.').max(80),
});

// ── Devices ─────────────────────────────────────────────────────────────────────────────────

export const registerDeviceRequestSchema = z.object({
  fcmToken: z.string().min(1).max(4096),
  platform: devicePlatformSchema,
});
