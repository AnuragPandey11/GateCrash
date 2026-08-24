/**
 * Server constants the client has to know but cannot ask for — FRONTEND.md §15.5.
 *
 * Every value here also exists in the backend's `AppProperties`, and several are env-tunable
 * (`VISIT_PENDING_TTL_MIN`). Duplicating them is a known, documented divergence risk, not a
 * design: the moment ops changes an env var, the countdown on the guard's screen is wrong and
 * nothing tells anyone.
 *
 * The fix is `GET /api/v1/config` (§15.5). When it lands, `SERVER_DEFAULTS` becomes the fallback
 * used only until that request resolves, and `useServerConfig()` becomes the read path — which
 * is why callers should go through the exported helper rather than reading the object directly.
 */
export const SERVER_DEFAULTS = {
  /** `app.visit.pending-ttl-minutes` — how long a PENDING visit lives before the sweeper expires it. */
  visitPendingTtlMinutes: 10,
  /** `app.visit.gate-feed-max-size` — server clamps `GET /visits/gate/{id}?limit=` to this. */
  gateFeedMaxSize: 200,
  /** `app.pass.pin-length` — mint length. The redeem endpoint accepts 4–10 regardless. */
  passPinLength: 6,
  /** `app.pass.max-validity-days` */
  passMaxValidityDays: 30,
  /** `@Max(50)` on `CreatePassRequest.maxUses`. */
  passMaxUsesLimit: 50,
  /** `@Size(min = 10)` on `ChangePasswordRequest.newPassword`. */
  passwordMinLength: 10,
  passwordMaxLength: 128,
} as const;

export type ServerConfig = typeof SERVER_DEFAULTS;

/** Client-side limits that are ours, not the server's. */
export const CLIENT_LIMITS = {
  /** §8.4 — the honest cap on a client-side CSV export, until §15.4 gives us a streaming endpoint. */
  csvExportMaxRows: 10_000,
  /** §8.4 — rows fetched per page while paging through an export. */
  csvExportPageSize: 200,
  /** §8.5 — debounce before firing an audience preview. */
  audiencePreviewDebounceMs: 400,
  /** §5.6 — the client half of the redeem throttle. */
  redeemMinIntervalMs: 2_000,
  /** §5.6 — `LoginAttemptService`: 5 failures, then a 15-minute lockout. */
  loginLockoutMinutes: 15,
  /** §8.3 — occupancy "inside for" recompute tick. */
  elapsedTickMs: 60_000,
} as const;

let overrides: Partial<ServerConfig> = {};

/**
 * Seed values fetched from the server (once `GET /config` exists). Until then this is only
 * called by tests, and `serverConfig()` returns the compiled-in defaults.
 */
export function setServerConfig(values: Partial<ServerConfig>): void {
  overrides = values;
}

export function serverConfig(): ServerConfig {
  return { ...SERVER_DEFAULTS, ...overrides };
}
