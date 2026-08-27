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

export type TownshipId = Brand<string, 'TownshipId'>;
export type UserId = Brand<string, 'UserId'>;
/**
 * Any node in the property tree — a phase, a tower, a floor or a flat. One brand for all of them,
 * because after V4 they are literally one table and a "block id" is just a node id that happens to
 * sit at depth 0.
 */
export type PropertyNodeId = Brand<string, 'PropertyNodeId'>;
export type PropertyLevelId = Brand<string, 'PropertyLevelId'>;

/**
 * A node at the addressable level. Aliased to {@link PropertyNodeId} rather than branded
 * separately: the API still calls this field `flatId` (the column kept its name in V4), and giving
 * it a distinct brand would force a cast at every boundary while proving nothing — the server is
 * what enforces that the node is actually a unit, via `requireUnit` and the `is_unit` foreign key.
 */
export type FlatId = PropertyNodeId;
/** @deprecated A block is a property node. Use {@link PropertyNodeId}. */
export type BlockId = PropertyNodeId;
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
  township: (v: string) => v as TownshipId,
  user: (v: string) => v as UserId,
  flat: (v: string) => v as FlatId,
  propertyNode: (v: string) => v as PropertyNodeId,
  propertyLevel: (v: string) => v as PropertyLevelId,
  gate: (v: string) => v as GateId,
  visit: (v: string) => v as VisitId,
  pass: (v: string) => v as PassId,
  notification: (v: string) => v as NotificationId,
  inboxItem: (v: string) => v as InboxItemId,
  post: (v: string) => v as PostId,
  device: (v: string) => v as DeviceId,
  qrToken: (v: string) => v as QrToken,
} as const;
