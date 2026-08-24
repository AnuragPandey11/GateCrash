/**
 * Branded id types — FRONTEND.md §4.6.
 *
 * The API is UUID-soup: every id is a bare string, so `createVisit({ gateId: flat.id })` is a
 * perfectly well-typed 404 waiting to happen. Branding costs nothing at runtime (the brand is a
 * phantom property) and turns that whole class of mistake into a compile error.
 *
 * These live in `core` rather than `api` (where §4.6 sketches them) because `api` depends on
 * `core` for the enums; putting the brands in `api` would make the dependency circular.
 * `@gatecrash/api` re-exports them, so the import path in the spec still resolves.
 */

type Brand<K, T> = K & { readonly __brand: T };

export type UserId = Brand<string, 'UserId'>;
export type FlatId = Brand<string, 'FlatId'>;
export type BlockId = Brand<string, 'BlockId'>;
export type GateId = Brand<string, 'GateId'>;
export type VisitId = Brand<string, 'VisitId'>;
export type PassId = Brand<string, 'PassId'>;
export type NotificationId = Brand<string, 'NotificationId'>;
export type InboxItemId = Brand<string, 'InboxItemId'>;
export type PostId = Brand<string, 'PostId'>;
export type DeviceId = Brand<string, 'DeviceId'>;
export type QrToken = Brand<string, 'QrToken'>;

/**
 * The one sanctioned way to put a brand on a string that came from outside the type system
 * (a URL param, a form field). Everything the API returns is already branded by its Zod schema
 * or its generated type, so this should be rare — if you are reaching for it inside a feature,
 * the id probably wants threading through properly instead.
 */
export const asId = {
  user: (v: string) => v as UserId,
  flat: (v: string) => v as FlatId,
  block: (v: string) => v as BlockId,
  gate: (v: string) => v as GateId,
  visit: (v: string) => v as VisitId,
  pass: (v: string) => v as PassId,
  notification: (v: string) => v as NotificationId,
  inboxItem: (v: string) => v as InboxItemId,
  post: (v: string) => v as PostId,
  device: (v: string) => v as DeviceId,
  qrToken: (v: string) => v as QrToken,
} as const;
