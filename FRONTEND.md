# GateCrash — Frontend Build Spec

Implementation-ready spec for the two client surfaces of the Township ERP:

- **Admin Web** — React SPA, desktop-first, for `ADMIN`.
- **Mobile** — React Native (Android + iOS), one binary, three role shells: `GUARD`, `RESIDENT`, `SALES`.

This document is to the frontend what [BACKEND.md](BACKEND.md) is to the backend. Where it describes an
API, that API is **the one that exists today** in `gatecrash-backend/` — every endpoint, field name, enum
value and error code below was read off the implemented controllers and DTOs, not off
[ARCHITECTURE.md](ARCHITECTURE.md). Where the two disagree, the code wins and this document says so.
§15 lists the places where the backend does **not** yet give the frontend what it needs; those are
blocking work items, not client-side workarounds.

**Read first:** §4 (the contract), §5 (session lifecycle), §6 (real-time). Everything else is screens.

---

## 0. Scope

| Surface | Roles | Platform | Ships in |
|---|---|---|---|
| Admin Web | `ADMIN`, `SUPER_ADMIN` | Browser (Chrome/Edge/Safari, desktop ≥1280px, tablet-tolerant) | Phase 7 (console: F5b) |
| Mobile | `GUARD`, `RESIDENT`, `SALES` | Android 8+ / iOS 15+ | Phase 8 |

Out of scope for Phase 1: payments, self-signup, OTP, in-app chat, visitor photo capture *until* the
upload gap in §15.1 closes, offline write queues (§9.7 explains why deliberately).

Non-negotiable product facts that shape every screen:

1. **There is no self-service anything.** No signup, no password reset by email, no "forgot password".
   An admin provisions the account and hands over a generated password. The login screen has exactly
   three fields and no link.
2. **The backend is multi-tenant, and the township is part of the credential.** Login is
   `(townshipCode, loginId, password)` — login ids are unique only within a township, so `A-101-1`
   exists in every township with a block A. The code is a *field*, not a filter, and a `SUPER_ADMIN`
   signs in with it blank because it belongs to no township. A blank field must be submitted as
   **absent**, never as an empty string, which would be a present code matching no township.
3. **Guard is a single-purpose appliance.** The gate tablet does one job under time pressure, often
   one-handed, often in direct sunlight. It gets its own visual language (§10.3).
4. **Postgres is the source of truth.** Push and WebSocket are accelerants. Every screen that consumes
   a live event must be able to render correctly from a plain REST fetch alone (§6.5).
5. **The client never decides which township a request acts in.** For every role but `SUPER_ADMIN` the
   server takes it from the account row and refuses a header that disagrees (`403 TOWNSHIP_MISMATCH`).
   A super admin's selected township is sent as `X-Township-Id` by `ApiClient` — read fresh per
   request from the session store, so switching township takes effect on the next call, not a reload.

---

## 1. Role → surface → screen matrix

| Role | Home | Screens |
|---|---|---|
| `SUPER_ADMIN` (web) | Township list | Township list · Onboarding wizard (township + first admin) · Township detail (admins, suspend/archive/restore) · Platform operators · **plus every `ADMIN` screen below**, scoped to the township selected in the shell switcher |
| `ADMIN` (web) | Live occupancy | Occupancy board · Visitor log (filter/export) · Notification composer + history · Community posts · Users · Township (blocks/flats/gates) |
| `GUARD` (mobile) | Gate console | Gate picker · Log walk-in · Awaiting-decision · Scan/keypad redeem · Gate activity feed (check-in/out) |
| `RESIDENT` (mobile) | Approvals | Pending approvals · Visit history · My passes + create pass · Community feed · Inbox |
| `SALES` (mobile) | Approvals | Duty toggle · Pending client approvals · My passes + create pass · Community feed · Inbox |

`GUARD` deliberately has **no** community feed and **no** inbox — the backend forbids it
(`CommunityService` is `ADMIN, RESIDENT, SALES`), and a gate appliance should not have a reading surface.
Guards *do* receive `VISIT_DECIDED` and `VISIT_EXPIRED` pushes.

`SUPER_ADMIN` reaches the `ADMIN` screens because the backend grants it `ROLE_ADMIN` alongside
`ROLE_SUPER_ADMIN` — but only inside the township it has selected, and **only once it has selected
one**: a township-scoped call with no `X-Township-Id` is `422 TOWNSHIP_CONTEXT_REQUIRED`, so the shell
must make the operator pick before rendering any of them. It is deliberately not granted `GUARD`,
`RESIDENT` or `SALES`, so it never gets a mobile surface — those roles are the physical parties to a
visit, and standing in for them would make the audit trail a fiction.

---

## 2. Stack decisions

Pin exact versions at kickoff and commit the lockfile; the choices below are by role, not by version.

### 2.1 Shared

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript, `strict: true`, `noUncheckedIndexedAccess` | The API is UUID-soup; branded id types (§4.6) catch the whole class of "passed a flatId where a gateId went". |
| Package manager / repo | pnpm workspaces, single repo | Web and mobile must never drift on the API contract. One `packages/api` consumed by both is the enforcement. |
| Server state | **TanStack Query v5** | Cache keys, dedup, and — critically — `queryClient.setQueryData` from a WebSocket frame, which is exactly the "socket updates the same cache REST filled" shape §6.5 needs. |
| Client state | Zustand (small stores: session, gate selection, connection status) | Redux is overkill when server state lives in Query. |
| Forms | React Hook Form + Zod | Zod schemas double as the runtime validators for API responses (§4.5) and mirror the backend's Jakarta constraints (§4.7). |
| Dates | `date-fns` + `date-fns-tz` | Everything on the wire is `OffsetDateTime` (ISO-8601 with offset). Never `new Date(string)` arithmetic. |
| HTTP | `ky` (web) / `ky` (RN, fetch-based) | Small, retry/hook-friendly, no XHR baggage. One transport for both platforms. |
| STOMP | `@stomp/stompjs` | Same library both platforms; SockJS transport on web, raw WS on RN (§6.2). |
| i18n | `i18next` + `react-i18next` | English at launch; Hindi/Marathi are a near-certain ask for a township. Externalise strings from day one — retrofitting is three days of nothing. |
| Testing | Vitest + Testing Library + MSW; Playwright (web e2e); Maestro (mobile e2e) | §12. |

### 2.2 Admin Web

| Concern | Choice | Why |
|---|---|---|
| Build | **Vite** + React | No SSR requirement — this is an authenticated internal dashboard behind a login. Next.js buys nothing and costs a server. |
| Routing | React Router (data router, `createBrowserRouter`) | Loaders let route-level auth + role gating live in one place (§8.2). |
| UI | **shadcn/ui** (Radix + Tailwind), copied into `apps/admin/src/components/ui` | Owned source, accessible primitives, no runtime theme lock-in. The one dashboard-shaped decision that ages well. |
| Tables | TanStack Table (headless) over shadcn `<Table>` | The visitor log is server-paginated, server-sorted, multi-filter. Headless is the only sane fit. |
| Charts | Recharts, only if a dashboard chart is actually requested | Not in Phase 1 scope. |

### 2.3 Mobile

**Expo (managed workflow with `expo-dev-client` + prebuild), not bare React Native.**

Rationale, since this is the decision most likely to be second-guessed: the app needs FCM data-only
messages, an actionable heads-up notification, a camera QR scanner, and secure keystore storage. All four
have first-class Expo config plugins (`@react-native-firebase/*`, `notifee`, `expo-camera`,
`expo-secure-store`). Expo gives us OTA updates for the JS layer — which matters enormously when the
"deployment target" is a tablet zip-tied to a guard booth that nobody will hand back for a store update.
Prebuild means we still have `android/` and `ios/` when we need them, so the usual "Expo can't do native"
objection doesn't apply. If the client's MDM forbids Expo's update service, drop `expo-updates` and keep
everything else.

| Concern | Choice | Notes |
|---|---|---|
| Navigation | React Navigation (native stack + bottom tabs) | Role decides the navigator tree at the root (§9.2). |
| Push | `@react-native-firebase/messaging` + **`notifee`** | RNFirebase receives the data-only message; notifee renders the heads-up **with Approve/Reject actions**. This pairing is the whole point of the backend sending data messages (§7). |
| Secure storage | `expo-secure-store` (Keychain / Keystore) | Refresh token only. Access token stays in memory. |
| QR | `expo-camera` (`onBarcodeScanned`, `qr` only) | Guard scan path. Torch toggle is mandatory — night shift. |
| Styling | `nativewind` (Tailwind for RN) | Same token names as web (§10.1), so the design system is genuinely shared. |
| Haptics/sound | `expo-haptics` + a short bundled tone | The guard must be able to feel/hear an approval without looking. |

---

## 3. Repository layout

```
GateCrash/
├── gatecrash-backend/                 # exists
├── ARCHITECTURE.md  BACKEND.md  FRONTEND.md
└── gatecrash-frontend/                # new pnpm workspace root
    ├── pnpm-workspace.yaml
    ├── package.json                   # scripts: dev:admin, dev:mobile, gen:api, lint, test
    ├── packages/
    │   ├── api/                       # THE contract layer — see §4
    │   │   ├── src/
    │   │   │   ├── generated/         # openapi-typescript output (committed)
    │   │   │   ├── schemas/           # Zod: enums, request bodies, response guards
    │   │   │   ├── client.ts          # ky instance, auth hooks, correlation id
    │   │   │   ├── session.ts         # token store interface + refresh single-flight
    │   │   │   ├── errors.ts          # ApiError envelope → typed ApiException
    │   │   │   ├── endpoints/         # auth, visits, passes, notifications, admin, ...
    │   │   │   └── queries/           # TanStack Query key factory + hooks
    │   │   └── package.json
    │   ├── realtime/                  # STOMP client, subscription registry, reconnect — §6
    │   ├── core/                      # role logic, FSM helpers, formatters, i18n resources
    │   └── config/                    # eslint, tsconfig, tailwind preset (shared tokens)
    ├── apps/
    │   ├── admin/                     # Vite + React
    │   │   └── src/{routes,features,components,lib}
    │   └── mobile/                    # Expo
    │       └── src/{navigation,features/{guard,resident,sales,shared},push,lib}
    └── tools/
        └── openapi/                   # fetch spec from running backend, codegen script
```

`packages/api` and `packages/realtime` **must not** import from `apps/*`. Nothing in `apps/*` may
construct a `fetch` to the backend directly — lint rule `no-restricted-globals: fetch` outside
`packages/api` enforces it.

---

## 4. The contract layer (`packages/api`)

This is the load-bearing package. Everything in §8 and §9 is UI on top of it.

### 4.1 Base URL & versioning

All endpoints are under `/api/v1`. One env var, `GATECRASH_API_URL` (e.g. `https://api.gatecrash.example`),
never a hardcoded host. WebSocket URL is derived: `new URL('/ws', apiUrl)` with `http→ws` scheme swap.

### 4.2 Type generation, then hand-written schemas

The backend serves OpenAPI at `/v3/api-docs` (springdoc). Generate types, don't hand-copy them:

```bash
# tools/openapi/gen.sh — run against a locally running backend, commit the diff
curl -s "$GATECRASH_API_URL/v3/api-docs" > packages/api/openapi.json
pnpm openapi-typescript packages/api/openapi.json -o packages/api/src/generated/schema.d.ts
```

Generated types are **compile-time only**. For the handful of payloads where a wrong shape would be
silently destructive — `LoginResponse`, `MeResponse`, `VisitResponse`, `RedeemPassResponse` — add a Zod
schema in `schemas/` and parse at the boundary. Everywhere else, trust the generated type. Parsing
everything is a tax with no payer.

> A CI job runs `gen.sh` against the backend on `main` and fails if the committed spec drifts. That is the
> only thing standing between a backend rename and a runtime `undefined` in the guard's face.

### 4.3 Request rules the backend enforces

Three of these will bite on day one if not handled centrally:

1. **`fail-on-unknown-properties: true`.** Jackson rejects request bodies with fields it doesn't know,
   with `400 MALFORMED_BODY`. So a client must never `PATCH` a spread of a response object back. Every
   mutation builds an explicit request body from a Zod-validated form value. No `{...visit, status}`.
2. **`Content-Type: application/json`** on every body-bearing request, or `415 UNSUPPORTED_MEDIA_TYPE`.
3. **`X-Township-Id`** names the township a `SUPER_ADMIN` is acting inside. `ApiClient` attaches it
   automatically, and only when the session has no township of its own — sending it for any other role
   is `403 TOWNSHIP_MISMATCH` by design, so no feature code should ever set it by hand. Omitting it on
   a township-scoped endpoint is `422 TOWNSHIP_CONTEXT_REQUIRED`, which is the shell's cue to make the
   operator pick a township rather than a bug to paper over with a default.
4. **`X-Correlation-Id`** is allowed on request and exposed on response by the CORS config. Generate a
   UUID per request, send it, and surface it in error toasts (§11.3). It is how a support ticket becomes
   a log line.

### 4.4 Pagination envelope

Spring `Pageable` in, `PageResponse<T>` out. Query params: `page` (0-based), `size`, `sort=field,dir`.

```ts
export type PageResponse<T> = {
  content: T[]; page: number; size: number;
  totalElements: number; totalPages: number; first: boolean; last: boolean;
};
```

Note `page` is **zero-based** while every table UI wants 1-based. Convert in exactly one place:
`packages/api/src/pagination.ts`. Defaults differ per endpoint (users 25, visits 50, community 20,
notifications 25) — pass `size` explicitly rather than relying on them.

Endpoints returning a **plain array**, not a page: `GET /visits/pending`, `GET /visits/gate/{gateId}`,
`GET /sales/on-duty`, `GET /devices`, `GET /admin/blocks|flats|gates`. Don't build a paginator for those.

### 4.5 Error envelope

Every failure returns:

```ts
export type ApiError = {
  timestamp: string; status: number; error: string;
  code: string;              // the machine-readable one — switch on this, never on `message`
  message: string;           // human text, safe to show but not localised
  path: string;
  correlationId: string | null;
  fieldErrors?: { field: string; message: string }[] | null;
};
```

Codes emitted by `GlobalExceptionHandler` and the security filters:

| Code | HTTP | Frontend handling |
|---|---|---|
| `VALIDATION_FAILED` | 400 | Map `fieldErrors[].field` onto RHF field errors. Never a toast alone. |
| `MALFORMED_BODY` | 400 | Bug in our request builder. Log loudly, generic toast. |
| `MISSING_PARAMETER` / `TYPE_MISMATCH` | 400 | Same — ours to fix. |
| `UNAUTHORIZED` | 401 | Refresh once (§5.3), then hard logout. |
| `FORBIDDEN` | 403 | Role/ownership. Show "not permitted"; do **not** retry. |
| `PASSWORD_RESET_REQUIRED` | 403 | **Special.** Force-navigate to the change-password screen (§5.4). |
| `NOT_FOUND` | 404 | Entity gone — invalidate the query and show an empty state. |
| `CONFLICT` | 409 | Illegal FSM transition or duplicate. Refetch the entity and re-render truth (§11.2). |
| `CONCURRENT_MODIFICATION` | 409 | Someone else won. Refetch, tell the user what happened. |
| `GONE` | 410 | Expired pass. Terminal — offer "log as walk-in" instead (§9.4). |
| `TOO_MANY_REQUESTS` | 429 | Login lockout / redeem throttle. Show remaining-time copy (§5.6). |
| `INTERNAL_ERROR` | 500 | Generic toast **with the correlation id**. |

`errors.ts` normalises all of this into one `ApiException` class carrying `code`, `status`,
`fieldErrors`, `correlationId`. Nothing above `packages/api` ever inspects a raw `Response`.

### 4.6 Branded ids

```ts
type Brand<K, T> = K & { readonly __brand: T };
export type UserId  = Brand<string, 'UserId'>;
export type FlatId  = Brand<string, 'FlatId'>;
export type GateId  = Brand<string, 'GateId'>;
export type VisitId = Brand<string, 'VisitId'>;
export type PassId  = Brand<string, 'PassId'>;
```

Cheap, and it makes `createVisit({ gateId: flat.id })` a compile error instead of a 404 at the gate.

### 4.7 Client-side validation must mirror the server

Duplicate the backend's constraints in Zod so the user is told before the round-trip. These are read off
the DTOs — keep them in sync when the DTOs change:

| Field | Rule |
|---|---|
| `loginId` (create user) | `^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$` |
| `password` (new) | 10–128 chars |
| any `phone` | `^\+?[0-9]{7,15}$` |
| `visitorName` | non-blank, ≤120 |
| `vehicleNo` | ≤20 |
| `photoUrl` / `imageUrl` | ≤2048, **https only, allowlisted host** (§15.1) |
| `pin` (redeem) | `^[0-9]{4,10}$` — the mint length is 6, the field accepts 4–10 |
| `maxUses` | 1–50 |
| `validUntil` | future, and ≤30 days out (`app.pass.max-validity-days`) |
| notification `title` / `body` | ≤200 / ≤2000 |
| audience `flatIds` / `blockIds` / `roles` | ≤2000 / ≤200 / ≤4 |
| community `title` / `body` | ≤200 / ≤10000 |

### 4.8 Endpoint inventory

Everything the clients may call. `A`=ADMIN, `G`=GUARD, `R`=RESIDENT, `S`=SALES.

**Auth** — `POST /auth/login` (public) · `POST /auth/refresh` (public) · `POST /auth/password` ·
`POST /auth/logout` · `GET /auth/me`

**Devices** — `POST /devices` · `GET /devices` · `DELETE /devices/{id}` — all roles

**Sales** — `PATCH /sales/me/duty` (S) · `GET /sales/on-duty` (G)

**Visits** — `POST /visits` (G) · `PATCH /visits/{id}/decision` (R,S) · `PATCH /visits/{id}/check-in` (G) ·
`PATCH /visits/{id}/check-out` (G) · `GET /visits/pending` (R,S) · `GET /visits/gate/{gateId}?limit=` (G) ·
`GET /visits/{id}` (G + approver)

**Passes** — `POST /passes` (R,S) · `GET /passes/mine` (R,S, paged) · `POST /passes/redeem` (G) ·
`DELETE /passes/{id}` (owner)

**Community** — `POST /community/posts` (A) · `GET /community/posts` (A,R,S — paged) ·
`DELETE /community/posts/{id}` (A)

**Notifications** — `POST /notifications` (A) · `POST /notifications/preview` (A) ·
`GET /notifications` (A, paged) · `GET /notifications/mine` (paged) · `GET /notifications/mine/unread-count` ·
`PATCH /notifications/mine/{id}/read`

**Admin ops** — `GET /admin/inside` (A) · `GET /admin/visits?status&visitorType&gateId&flatId&from&to` (A, paged) ·
`POST /admin/users` · `GET /admin/users?role&active&flatId&search` · `GET /admin/users/{id}` ·
`PATCH /admin/users/{id}` · `DELETE /admin/users/{id}` (deactivate) · `POST /admin/users/{id}/activate` ·
`POST /admin/users/{id}/reset-password` — all A

> `POST /admin/users` refuses `role: 'ADMIN'` from a township admin (`403 ADMIN_REQUIRES_SUPER_ADMIN`)
> and `role: 'SUPER_ADMIN'` outright (`422 ROLE_NOT_PROVISIONABLE`). The role picker is built from
> `PROVISIONABLE_ROLES`, not `USER_ROLES` — a dropdown offering two options that can only fail is a
> worse experience than one that never offered them.

**Platform** (`SUPER_ADMIN` only; no `X-Township-Id` needed, these act *on* townships) —
`POST /super/townships` (township + first admin, password once) · `GET /super/townships?includeArchived` ·
`GET|PATCH /super/townships/{id}` · `POST /super/townships/{id}/suspend` ·
`DELETE /super/townships/{id}` (**archive**; body `{ confirmCode }` must equal the township's code) ·
`POST /super/townships/{id}/restore` · `GET|POST /super/townships/{id}/admins` ·
`DELETE /super/townships/{id}/admins/{userId}` · `POST /super/townships/{id}/admins/{userId}/reset-password` ·
`GET|POST /super/admins` · `DELETE /super/admins/{userId}` · `POST /super/admins/{userId}/activate` ·
`POST /super/admins/{userId}/reset-password`

> Typed in `packages/api/src/endpoints/platform.ts`, with hooks in `queries/hooks.ts`. The console
> that drives them is `/townships` — see §8.9. The `/super/admins` group has no screen yet.

**Township** — `POST/DELETE /admin/blocks|flats|gates` (A) · `GET /admin/blocks` · `GET /admin/flats?blockId` ·
`GET /admin/gates` — **`A` and `G`**

> ⚠️ That last row is the non-obvious one: `TownshipService` authorises the three *list* methods for
> `ADMIN, GUARD`. The guard app reads `/api/v1/admin/gates` and `/api/v1/admin/flats` despite the
> `/admin` path prefix. Don't let a well-meaning route guard block it because the URL says "admin".

### 4.9 Query key factory

One place, or cache invalidation becomes folklore:

```ts
export const qk = {
  me:              ['me'] as const,
  visits: {
    pending:       ['visits', 'pending'] as const,
    byGate:  (g: GateId) => ['visits', 'gate', g] as const,
    one:     (v: VisitId) => ['visits', v] as const,
  },
  passes:  { mine: (p: PageArgs) => ['passes', 'mine', p] as const },
  inbox:   { list: (p: PageArgs) => ['inbox', p] as const, unread: ['inbox', 'unread'] as const },
  community: (p: PageArgs) => ['community', p] as const,
  admin: {
    inside:        ['admin', 'inside'] as const,
    visits:  (f: VisitFilters) => ['admin', 'visits', f] as const,
    users:   (f: UserFilters)  => ['admin', 'users', f] as const,
    blocks:        ['admin', 'blocks'] as const,
    flats:   (b?: BlockId) => ['admin', 'flats', b ?? 'all'] as const,
    gates:         ['admin', 'gates'] as const,
    notifications: (p: PageArgs) => ['admin', 'notifications', p] as const,
  },
  salesOnDuty:     ['sales', 'on-duty'] as const,
};
```

---

## 5. Session lifecycle

The single most under-specified part of most client apps, and here it has four states the backend can
force on us. Model it explicitly.

### 5.1 Session state machine

```
                 ┌──────────────┐
                 │ UNAUTHENTICATED │◄──────────────┐
                 └───────┬──────┘                  │
             login 200   │                         │ logout · refresh reuse (401)
                         ▼                         │ · account deactivated (401)
              ┌──────────────────────┐             │
      must    │  MUST_RESET_PASSWORD │─────────────┤
      Reset ─►│  (only /auth/password,│            │
      true    │   /me, /refresh, /logout)          │
              └──────────┬───────────┘             │
        POST /auth/password (returns NEW tokens)   │
                         ▼                         │
                 ┌──────────────┐                  │
                 │ AUTHENTICATED│──────────────────┘
                 └──────────────┘
```

`MUST_RESET_PASSWORD` is not advisory. `PasswordResetEnforcementFilter` returns
`403 PASSWORD_RESET_REQUIRED` for **every** path except `/auth/password`, `/auth/logout`,
`/auth/refresh`, `/auth/me`. STOMP `CONNECT` is refused too. So: while in this state the app renders
exactly one screen, and the realtime client does not connect.

### 5.2 Token storage

`allowCredentials` is **false** on the backend CORS config, and the token travels in an `Authorization`
header — so cookie-based auth is not on the table. Given that:

| | Access token | Refresh token |
|---|---|---|
| Web | In-memory only (Zustand, never persisted) | `localStorage`, single key `gc.rt` |
| Mobile | In-memory only | `expo-secure-store` (Keychain/Keystore) |

Access TTL is 30 minutes, refresh 30 days. Keeping the access token out of storage means an XSS has to
stay resident to keep stealing; it doesn't get a 30-minute bearer for free from `localStorage`. The
refresh token in web storage is the accepted residual risk of a no-cookie design — mitigated by one-time
use with family-wide revocation on reuse, server-side. **Do not** "improve" this by persisting the access
token so reloads feel faster; a reload should silently refresh instead (§5.3).

### 5.3 Refresh: single-flight, with the rotation trap

Refresh tokens are **one-time use** and reuse revokes the entire family. Two concurrent 401s that each
fire a refresh will log the user out. The client must therefore serialise:

```ts
// packages/api/src/session.ts  (sketch — the real one also handles queue rejection)
let inFlight: Promise<Tokens> | null = null;

async function refreshOnce(store: TokenStore): Promise<Tokens> {
  if (inFlight) return inFlight;                  // every concurrent caller awaits the same promise
  inFlight = (async () => {
    const rt = await store.getRefreshToken();
    if (!rt) throw new SessionExpired();
    const res = await rawPost('/auth/refresh', { refreshToken: rt });   // public endpoint, no bearer
    await store.set(res);                          // persist the NEW refresh token before resolving
    return res;
  })().finally(() => { inFlight = null; });
  return inFlight;
}
```

Rules:
- Retry a failed request **once** after a successful refresh. A second 401 → hard logout.
- Never refresh in response to a **403** — that is authorisation, not authentication.
- Never attach a bearer to `/auth/login` or `/auth/refresh`.
- `POST /auth/password` **revokes all refresh tokens and returns a fresh `LoginResponse`** — treat its
  response exactly like a login response and replace both tokens. Forgetting this logs the user out
  immediately after they change their password, which reads as a broken app.
- On mobile, refresh proactively on `AppState` → `active` if the access token is within 2 minutes of
  expiry (`expiresInSeconds` from the login/refresh response). Avoids the first tap after unlock eating
  a round-trip.

### 5.4 Bootstrapping a session

On app start with a refresh token present: `refresh()` → `GET /auth/me` → route by `role` and
`mustResetPassword`. `MeResponse` carries `{ id, loginId, fullName, role, mustResetPassword, onDuty,
flatId, flatNumber, blockName }` — everything the shell needs, so **never decode the JWT client-side**.
It is a server-signed artefact; parsing it in the client invites treating its claims as authority.

### 5.5 Logout

`POST /auth/logout { refreshToken }` → clear token store → `queryClient.clear()` → disconnect STOMP →
**`DELETE /devices/{id}`** for this device *before* clearing tokens (§7.4), or the next person to hold
the phone keeps getting the previous user's visitor pushes. This ordering is a real defect if reversed.

### 5.6 Rate limits

`LoginAttemptService`: 5 failed attempts → 15-minute lockout, `429`. `Redeem`: 10 attempts/minute.

The login budget is keyed on `(townshipCode, loginId)`, so one township's failures cannot lock out
another township's account of the same name.

The login form must distinguish three outcomes:

- **401** — wrong township code, login id or password. All three are deliberately indistinguishable
  server-side, so the message must be too; a specific one would let anyone enumerate the platform's
  customer list from the login form.
- **429** — locked out. Show the lockout duration and disable submit; a guard mashing a locked login
  is how a shift starts badly.
- **403 `TOWNSHIP_INACTIVE`** — the credentials were right and the township is suspended or archived.
  Say so plainly. It is only reachable with valid credentials, so it discloses nothing, and "wrong
  password" would send an entire township chasing a problem they do not have.

For redeem, throttle the keypad's submit client-side at 1 req/2s so the user's own impatience doesn't
burn the server budget.

---

## 6. Real-time (`packages/realtime`)

### 6.1 What the backend actually publishes

Destinations and their authorised subscribers, from `StompAuthChannelInterceptor`:

| Destination | Who may subscribe | Frames |
|---|---|---|
| `/user/queue/visits` | any authenticated user (rewritten to self) | `VISIT_REQUESTED` |
| `/user/queue/notifications` | any authenticated user | `ANNOUNCEMENT` |
| `/topic/gate/{gateId}` | `GUARD`, `ADMIN`, `SUPER_ADMIN` — and only for a gate **in the subscriber's own township** | `VISIT_DECIDED`, `VISIT_EXPIRED` |
| `/topic/admin/inside/{townshipId}` | `ADMIN` of that township, or `SUPER_ADMIN` | `OCCUPANCY_CHANGED` |

**The occupancy destination carries the township id.** A single shared `/topic/admin/inside` would push
every township's movements to every township's dashboard, and no client-side filtering fixes that once
the frame has left the server. Subscribing to the bare path now fails the interceptor — and a failed
SUBSCRIBE kills the whole session, not just that subscription, so there is no soft-migration path: the
id is required. An admin with no township in context subscribes to occupancy not at all.

**Client→server `SEND` is rejected outright.** There are no `@MessageMapping` endpoints. The socket is
read-only; every write is REST. Do not design a feature that needs to publish over the socket.

Frame shapes (each carries a `type` discriminator — switch on it):

```ts
type VisitRequested = { type:'VISIT_REQUESTED'; visitId; gateId; gateName; visitorName;
                        visitorType: VisitorType; flatNumber: string|null; createdAt: string };
type VisitDecided   = { type:'VISIT_DECIDED'; visitId; gateId; status: VisitStatus;
                        visitorName; decidedByName; decidedAt: string };
type VisitExpired   = { type:'VISIT_EXPIRED'; visitId; gateId; visitorName };
type Occupancy      = { type:'OCCUPANCY_CHANGED'; visitId; status: VisitStatus; visitorName;
                        gateName; insideCount: number; at: string };
type Announcement   = { type:'ANNOUNCEMENT'; notificationId; title; body };  // string map, not typed record
```

Note the frames carry **display text and ids only** — no phone numbers, no photo URLs. A card rendered
purely from a frame is therefore incomplete by design; fetch `GET /visits/{id}` when the user opens it.

### 6.2 Transport: the SockJS asymmetry

`WebSocketConfig` registers `/ws` **with `.withSockJS()` only**. Consequences:

- **Web:** connect via SockJS — `new SockJS(`${apiUrl}/ws`)` as the `webSocketFactory` for
  `@stomp/stompjs`. Works as-is.
- **Mobile:** React Native has no SockJS-friendly environment (no `document`, XHR-streaming transports
  are a liability). Connect the STOMP client to the SockJS **raw-websocket transport URL**:
  `wss://host/ws/websocket`. This works today and needs no backend change, but it is an
  implementation detail of SockJS, not a contract. **§15.2 asks the backend to register a plain
  `/ws-native` endpoint** so mobile stops depending on it. Build against `/ws/websocket`, switch when
  §15.2 lands.

### 6.3 Connection manager

One `RealtimeClient` per app, owned by a provider, with:

- **Auth:** `connectHeaders: { Authorization: 'Bearer ' + accessToken }` on CONNECT. The token is read
  at connect time, not captured at construction.
- **Reconnect:** exponential backoff 1s → 30s with jitter; `reconnectDelay: 0` on the stomp client and
  drive reconnection ourselves so backoff is honest.
- **Token expiry:** a CONNECT with a stale token is refused. On connect error, refresh the access token
  (§5.3) once, then retry. Never loop-retry a refused CONNECT — that is a credential problem, not a
  network one.
- **Heartbeats:** `heartbeatIncoming: 10000, heartbeatOutgoing: 10000`.
- **Lifecycle:** disconnect on `MUST_RESET_PASSWORD`, on logout, and — mobile — on `AppState`
  `background` after a 30s grace period; reconnect + **reconcile** (§6.5) on `active`.
- **Subscription registry:** subscriptions are declared by role so an unauthorised SUBSCRIBE can never
  be attempted (it would kill the session, not just the subscription):

```ts
const SUBSCRIPTIONS: Record<UserRole, (ctx: Ctx) => string[]> = {
  // A super admin has no township of its own, so it watches whichever one the console has selected
  // — and nothing at all before it has selected one.
  SUPER_ADMIN: (c) => [...(c.townshipId ? [`/topic/admin/inside/${c.townshipId}`] : []),
                    ...c.watchedGateIds.map(g => `/topic/gate/${g}`)],
  ADMIN:    (c) => [...(c.townshipId ? [`/topic/admin/inside/${c.townshipId}`] : []),
                    ...c.watchedGateIds.map(g => `/topic/gate/${g}`),
                    '/user/queue/notifications'],
  GUARD:    (c) => c.selectedGateId ? [`/topic/gate/${c.selectedGateId}`] : [],
  RESIDENT: () => ['/user/queue/visits', '/user/queue/notifications'],
  SALES:    () => ['/user/queue/visits', '/user/queue/notifications'],
};
```

- **Connection status** is surfaced in a store and rendered (§10.4). A guard must be able to see that
  the gate console is live, because a silent dead socket looks exactly like a quiet gate.

### 6.4 Frames → cache

Frames mutate the TanStack Query cache; components never subscribe to STOMP directly.

```ts
onFrame(evt) {
  switch (evt.type) {
    case 'VISIT_REQUESTED':          // resident/sales
      qc.invalidateQueries({ queryKey: qk.visits.pending });
      break;
    case 'VISIT_DECIDED':
    case 'VISIT_EXPIRED':            // guard/admin — flip the waiting card
      qc.setQueryData(qk.visits.one(evt.visitId), (old) =>
        old ? { ...old, status: evt.status ?? 'EXPIRED' } : old);
      qc.invalidateQueries({ queryKey: qk.visits.byGate(evt.gateId) });
      break;
    case 'OCCUPANCY_CHANGED':        // admin
      qc.setQueryData(qk.admin.inside, (old) =>
        old ? { ...old, insideCount: evt.insideCount } : old);
      qc.invalidateQueries({ queryKey: qk.admin.inside });
      break;
    case 'ANNOUNCEMENT':
      qc.invalidateQueries({ queryKey: qk.inbox.unread });
      qc.invalidateQueries({ queryKey: ['inbox'] });
      break;
  }
}
```

`setQueryData` for the instant optic, `invalidateQueries` for the truth. Both, in that order — the user
sees the flip in milliseconds and the authoritative record lands a beat later.

### 6.5 Reconciliation is mandatory

Every screen with a live feed refetches on: socket (re)connect, app foreground, and window focus. The
reconciliation endpoints exist for exactly this: `GET /visits/pending`, `GET /visits/gate/{gateId}`,
`GET /admin/inside`, `GET /notifications/mine`.

**Test for it explicitly** (§12.4): a screen that only works when the socket is healthy is a screen that
will be wrong at a gate at 2am, and nobody will know why.

---

## 7. Push notifications (FCM)

### 7.1 The backend sends data-only messages

`PushPayload.asDataMap()` flattens to a string map with reserved keys `type`, `title`, `body`, plus
per-type extras. There is **no** `notification` block — nothing renders unless the app renders it. This is
deliberate: it's what lets the resident get a heads-up with **Approve / Reject buttons** on the lock
screen. The client half of that bargain is non-optional.

| `type` | Extra data keys | Target |
|---|---|---|
| `VISIT_REQUESTED` | `visitId`, `gateId`, `gateName`, `visitorName`, `visitorType`, `flatNumber?` | resident/sales |
| `VISIT_DECIDED` | `visitId`, `gateId`, `status` | guard |
| `VISIT_EXPIRED` | `visitId` … | guard |
| `PASS_REDEEMED` | `visitId` | pass owner |
| `ANNOUNCEMENT` | `notificationId` | audience |

All values are strings — `insideCount`-style numbers arrive as `"3"`. Parse, don't assume.

### 7.2 Mobile rendering

`@react-native-firebase/messaging` handles receipt in all three states; **notifee** renders:

- **Foreground** (`onMessage`): no OS notification — render an in-app card/banner instead, plus haptic.
- **Background/quit** (`setBackgroundMessageHandler`, an `index.js`-level registration, not inside a
  component): notifee `displayNotification` on a **high-importance channel** with `pressAction` and two
  actions, `approve` / `reject`, carrying `visitId`.
- **Action taps** (`onBackgroundEvent` / `onForegroundEvent`): call
  `PATCH /visits/{id}/decision { decision }` directly, then cancel the notification. If the call fails
  because the app has no valid token in a background context, fall back to deep-linking into the app at
  the pending-approvals screen — **never** silently swallow the tap.
- **Channels** (Android): `visits` (importance HIGH, custom sound, bypass DND is a per-deployment call),
  `announcements` (DEFAULT). iOS: request provisional authorisation for announcements, explicit for
  visits; visits should use a **time-sensitive** interruption level.
- **Deep links:** `gatecrash://visit/{id}`, `gatecrash://inbox/{notificationId}`, `gatecrash://gate`.

### 7.3 Web push

The Admin Web app registers a `WEB` device only if the admin opts in — occupancy already streams over
WebSocket while the tab is open, and an announcement blast is the admin's own action. Ship the
`platform: 'WEB'` registration path (the backend accepts it) but gate it behind a settings toggle,
defaulted off. Do not prompt for notification permission on first load; that is how permission gets
permanently denied.

### 7.4 Token lifecycle

- Register after login *and* after any `onTokenRefresh`: `POST /devices { fcmToken, platform }`.
  The endpoint is idempotent on the token (unique column), so re-registering is safe and also refreshes
  `last_seen_at`.
- **De-register before logout**: `GET /devices` → find this device → `DELETE /devices/{id}` → then clear
  tokens. Losing this ordering leaks pushes to the next user of a shared gate tablet.
- The backend prunes `UNREGISTERED` tokens on send failure; the client doesn't need to.
- Never log the FCM token. Never display it. It is a delivery credential.

---

## 8. Admin Web

### 8.1 Shell

Left sidebar (Occupancy · Visitor Log · Notifications · Community · Users · Township), top bar with
township name, connection pill (§10.4), admin name, sign-out. Content max-width 1600px. Dark mode via
`prefers-color-scheme` + a manual toggle persisted to `localStorage`.

### 8.2 Routing & guards

```
/login                       public
/change-password             session in MUST_RESET_PASSWORD (and only then)
/                            → redirect /occupancy
/occupancy                   live board
/visits                      filterable log
/visits/:id                  detail drawer (deep-linkable)
/notifications               composer + history tabs
/community                   list + composer
/users                       list, create dialog, detail drawer
/township                    blocks / flats / gates
*                            404
```

A root data-router `loader` resolves the session once and redirects: no session → `/login`;
`mustResetPassword` → `/change-password`; `role !== 'ADMIN'` → a dead-end "this account uses the mobile
app" screen. That last case is real — a resident will try the web URL.

Route guards are **UX, not security**. Every one of these calls a server endpoint that re-checks the
role. Never gate a *capability* on client state alone.

### 8.3 Occupancy board (`/occupancy`)

The hero screen. `GET /admin/inside` → `OccupancyResponse { insideCount, visits: VisitResponse[] }`,
plus a live `/topic/admin/inside` subscription.

- Big count card ("**37** people inside"), animated on change but never spinner-flashing — occupancy
  updates are frequent and a re-mount flash makes the board feel broken.
- Grid of visitor cards: name, type badge, gate, destination flat, "inside for 1h 12m" (recomputed on a
  60s tick, from `checkedInAt`, not from a client stopwatch).
- Filter chips by `visitorType`, search by name/flat.
- **Toast on `OCCUPANCY_CHANGED`** with entry/exit direction — subtle, auto-dismissing, stacking capped at 3.
- Empty state matters here: "Nobody is currently inside" is a legitimate and common state, not an error.

### 8.4 Visitor log (`/visits`)

`GET /admin/visits` with `status`, `visitorType`, `gateId`, `flatId`, `from`, `to`, `page`, `size`,
`sort` (default `createdAt,desc`, size 50).

- Filters serialise to the **URL query string** — an admin will want to send a colleague a link to
  "all rejected visits at the service gate last Tuesday". `useSearchParams` is the source of truth;
  the query key derives from it.
- Columns: created · visitor (name/phone) · type · gate · destination (flat or approver) · status chip ·
  decided · in/out · logged by.
- Row → detail drawer at `/visits/:id`, with the full timeline (created → decided → checked in → out)
  built from the timestamp fields, and the photo if present.
- **Export CSV**: client-side over the *current filter*, paging through the API up to a hard cap of
  10,000 rows with a progress indicator, refusing beyond that with "narrow the date range". There is no
  server export endpoint (§15.4) — this is the honest interim, and the cap is what stops an admin
  DoSing the box with a 12-month unfiltered export.
- Date pickers must emit ISO-8601 **with offset** (`OffsetDateTime`). A bare `2026-07-23` will be
  rejected as `TYPE_MISMATCH`.

### 8.5 Notification composer (`/notifications`)

The screen with the most damage potential — it makes thousands of phones buzz. Design accordingly.

Two-pane: compose left, **live audience preview right**.

1. **Title** (≤200) / **Body** (≤2000), with character counters and a phone-shaped preview of how the
   heads-up will actually read. Admins write differently when they can see the truncation.
2. **Audience builder** — a mode selector driving different controls:
   - `ALL` — no controls.
   - `ALL_EXCEPT` — role checkboxes (≤4).
   - `ROLES` — role checkboxes (≤4).
   - `FLATS` — flat multi-select grouped by block, with "select all in block" (≤2000).
   - `BLOCKS` — block checkboxes (≤2000 flats' worth; ≤200 blocks).
   Flats/blocks come from `GET /admin/flats` / `GET /admin/blocks`.
3. **Preview count** — `POST /notifications/preview` with the rule, **debounced 400ms**, rendering
   `AudiencePreviewResponse { recipientCount, deviceCount }` as
   "**312 people** · 487 devices". Show `recipientCount - (people with 0 devices)` implicitly by
   surfacing both numbers; an admin should see when a blast reaches accounts that can't receive it.
4. **Send** — disabled until preview has resolved for the *current* rule (guard against sending a rule
   whose blast radius was never shown). A confirmation dialog restates the count and requires typing
   nothing — just an explicit second click, with the count in the button: "Send to 312 people".
5. **History tab** — `GET /notifications` paged: title, audience summary rendered back from the stored
   `audienceRule`, `status` (`QUEUED`/`SENT`/`FAILED`), `recipientCount`, `deliveredCount`, `sentAt`.
   Deliveries are best-effort, so `deliveredCount < recipientCount` is normal, not an error — label it
   "reached 441 of 487 devices" and explain in a tooltip rather than colouring it red.

There is no "unsend". Say so in the confirm dialog.

### 8.6 Community (`/community`)

`GET /community/posts` (paged, 20) · `POST` · `DELETE`. Title, body (plain textarea with a character
count — **not** a rich-text editor; the mobile feed renders plain text), optional `imageUrl`, `pinned`
toggle. Pinned posts sort first in the UI. Deletion is permanent → confirm dialog naming the post title.

Until §15.1 lands, `imageUrl` is a paste-a-URL field with https + allowlist validation and a live preview,
clearly labelled. Don't build an uploader against an endpoint that doesn't exist.

### 8.7 Users (`/users`)

`GET /admin/users?role&active&flatId&search` (paged, 25).

**The create flow is the important one.** `POST /admin/users` returns `generatedPassword` **exactly once**:

- Role selector drives the form: `RESIDENT` → flat picker (grouped by block), and the `loginId` field is
  *hidden* because the server derives it (`A-101-1`, `A-101-2`). `SALES`/`GUARD`/`ADMIN` → `loginId`
  required, pattern-validated.
- On success, a **credential hand-off dialog**: large monospace `loginId` and `generatedPassword`,
  copy-to-clipboard, a "Print / Save PDF" action, and an explicit "I have saved this" button that is the
  only way to dismiss it. No backdrop-click dismissal, no Esc.
- The password must never be written to any store, any log, any analytics event, or any URL. It exists
  in one component's local state and dies with it. Same rules for
  `POST /admin/users/{id}/reset-password` → `ResetPasswordResponse`.
- Deactivate (`DELETE`) / reactivate (`POST /{id}/activate`) — confirm dialogs; deactivation invalidates
  the user's tokens server-side, so the copy should say "they will be signed out immediately".
- `PATCH /admin/users/{id}` edits `fullName`, `phone`, `email` **only**. Build the body from those three
  fields explicitly (§4.3).

### 8.8 Township (`/township`)

Three tabs. Blocks (`name`, shows `flatCount`), Flats (`blockId` + `number`, filterable by block), Gates
(`name`). Create + delete only — the backend has no update endpoints. Delete will `409` if referenced;
surface that as "This flat has residents or visit history and can't be removed."

Bulk flat creation is the one quality-of-life feature worth building client-side: a "add A-101 … A-110"
range helper that fires N sequential `POST /admin/flats` with a progress bar and a per-row result list.
Sequential, not parallel — don't hammer the box, and partial failure must be legible.

### 8.9 Platform console (`/townships`, `SUPER_ADMIN` only)

Note the two similar names: **§8.8 `/township`** is the *inside* of one township — its blocks, flats
and gates. **This** screen is the platform: the townships themselves.

A table of townships (code, name, status, admin and user counts) with an archived filter that is off
by default. The admin count doubles as a disclosure toggle, expanding the row into that township's
administrators with appoint and remove.

Three behaviours carry the weight:

**1. Selecting a township is what makes the rest of the app work.** A `SUPER_ADMIN` belongs to none,
so every township-scoped endpoint answers `422 TOWNSHIP_CONTEXT_REQUIRED` until one is chosen.
Choosing one writes `actingTownshipId`; `ApiClient` reads it per request and sends `X-Township-Id`.
Until then the shell renders **no township-scoped nav at all** and the router does not define those
routes — a `path="*"` guard would not do it, because React Router ranks by specificity and
`/occupancy` would still out-rank the catch-all and load a screen whose every request is refused.

**2. Archive is the one typed-confirmation dialog in the app.** The standing rule (§8.5.4) is that
typing trains people to type without reading, so destructive actions get a deliberate second click
instead. This is the exception, and it earns it twice over: the server itself requires the township's
code back in the body, and a mis-clicked row takes every resident and guard in a community offline in
one request. The copy says in plain words that the visitor log and audit trail are kept and that
Restore reverses it, because the word "Archive" beside a red button reads as "Delete" to everyone.

**3. An archived township is not offered as somewhere to work.** The server answers
`409 TOWNSHIP_ARCHIVED` for that, so the row shows Restore and nothing else — offering the control
and letting it fail would be a lie the UI told first.

The one-time credential dialog (§8.7) is reused for the first admin and for later appointments, and
now carries the **township code** alongside the login id. That is not decoration: the credential is
the pair, and a hand-off card without the code is one nobody can sign in with.

Not built yet: a township detail page, a screen for `/super/admins` (peer platform operators), and an
audit-log viewer.

---

## 9. Mobile

### 9.1 One app, three shells

A single binary. `MeResponse.role` picks the navigator at the root. Rationale: three store listings for
one township is an operational tax, and a guard tablet and a resident phone can be provisioned from the
same APK. If the client later wants a separate hardened guard build, the feature folders already split
cleanly.

### 9.2 Navigation

```
RootNavigator
├── AuthStack            (no session)          Login
├── ResetStack           (mustResetPassword)   ChangePassword          ← no tabs, no back
└── AppStack (by role)
    ├── GUARD     GateConsole (stack, no tabs) → LogWalkIn → Awaiting → Redeem → GateActivity
    ├── RESIDENT  Tabs: Approvals · Passes · Community · Inbox · Profile
    └── SALES     Tabs: Approvals · Passes · Community · Inbox · Profile(+duty)
```

Deep links (§7.2) resolve into the role's stack; a link arriving for the wrong role lands on the home
screen rather than erroring.

### 9.3 Guard — the gate console

This is the screen the product lives or dies on. Design constraints: sunlight, gloves, one hand, noise,
a queue of people watching.

**Gate selection.** There is no guard→gate assignment in the schema (§15.3). On first launch after login,
the guard picks a gate from `GET /admin/gates`; it persists to secure storage and is shown in the header
with a long-press to change. The STOMP subscription to `/topic/gate/{gateId}` follows this selection.

**Home: two enormous actions.**

```
┌──────────────────────────────────────┐
│  Main Gate            ● Live         │   ← connection pill, tap for detail
├──────────────────────────────────────┤
│                                      │
│   ┌────────────────────────────────┐ │
│   │      SCAN / ENTER PASS         │ │   ← 96dp min height
│   └────────────────────────────────┘ │
│   ┌────────────────────────────────┐ │
│   │      LOG A WALK-IN             │ │
│   └────────────────────────────────┘ │
│                                      │
│  Recent at this gate            ▾    │
│  • Ravi Kumar   A-101   IN  2m ago   │   ← check-out swipe target
└──────────────────────────────────────┘
```

**Log a walk-in** — a 3-step wizard, one decision per screen, never a long scrolling form:

1. **Visitor type** — four big tiles: Guest · Delivery · Maintenance · Client.
2. **Destination** — branches on type:
   - `CLIENT` → **must** route to a sales agent: `GET /sales/on-duty` list. If it's empty, say so plainly
     ("No sales agent is on duty") and offer only "log as Guest to a flat" — do not let the guard submit
     a client visit that the DB `CHECK` will reject.
   - everything else → flat picker over `GET /admin/flats`, with a **numeric-first search** (typing "101"
     matches A-101, B-101) and recents. This is the single highest-friction interaction in the product;
     invest in it.
3. **Details** — `visitorName` (required), `visitorPhone`, `vehicleNo`. Phone keypad for phone, `characters`
   autocapitalise for vehicle. Submit → `POST /visits`.

**Awaiting decision** — full-screen, unmistakable:

- Visitor name, destination, elapsed timer, and a **countdown against the 10-minute TTL**
  (`app.visit.pending-ttl-minutes`; treat 10 as a default and read it as a constant in `core`, §15.5).
- Driven by `/topic/gate/{gateId}`:
  - `VISIT_DECIDED` + `APPROVED` → screen floods green, success haptic + tone, single button **CHECK IN**
    → `PATCH /visits/{id}/check-in`.
  - `VISIT_DECIDED` + `REJECTED` → red, "Entry denied", button **Back to gate**. No check-in path.
  - `VISIT_EXPIRED` → amber, "No response — the resident didn't answer", offering **Try again** (a new
    `POST /visits`) or Back.
- **Never trust the socket alone:** poll `GET /visits/{id}` every 10s while this screen is mounted. The
  cost is trivial; a hung spinner in front of a queue is not.
- The guard may leave this screen — the visit stays in the gate activity feed with its live status. A
  modal that traps the guard while a second visitor waits is a design failure.

**Redeem a pass** — one screen, two inputs sharing the same throttle bucket:

- **Scan** (`expo-camera`, QR only, torch toggle, autofocus). The QR encodes the `qrToken` UUID.
- **Keypad** — 6-digit PIN, huge digits, no keyboard chrome.
- Both → `POST /passes/redeem { pin | qrToken, gateId }`. Exactly one of `pin`/`qrToken`; sending both is
  rejected.
- Success → `RedeemPassResponse { passId, visit, remainingUses }` and the visit is **already
  `CHECKED_IN`**. Show green, the visitor's name and destination, and `remainingUses` when > 0
  ("2 more entries left on this pass"). No approval wait at all — this is the fast path and it should
  *feel* like one.
- Failures: `409 CONFLICT` (already redeemed / max uses) and `410 GONE` (expired) get distinct copy, and
  both offer the escape hatch: **"Log as walk-in instead"**, pre-filling the visitor name from the failed
  pass response if available. A dead end at a gate turns into a phone call to the office.
- `429` → "Too many attempts, wait a moment" with a countdown; do not clear the entered PIN.

**Gate activity** — `GET /visits/gate/{gateId}?limit=50`, grouped by status. Currently-inside rows expose
a **swipe-to-check-out** (`PATCH /visits/{id}/check-out`) with an undo window before the request fires
(optimistic UI is wrong here — a mis-swipe would falsely mark someone as departed; a 3-second undo before
committing is right).

**Guard session hygiene:** the tablet is shared across shifts. Provide a prominent "End shift" that does
the full §5.5 logout including device de-registration. Consider an idle timeout (e.g. 8h) — but never an
aggressive one, because a login prompt mid-queue is worse than a warm session.

### 9.4 Resident

**Approvals (home)** — `GET /visits/pending`, plus `/user/queue/visits`.

- Card per pending visit: visitor name, type badge, gate, elapsed + TTL countdown.
- Two large buttons: **Approve** / **Reject** → `PATCH /visits/{id}/decision { decision }`.
- Optimistic update of the pending list with rollback on error. On `409` (the visit already expired, or a
  flat-mate decided first) don't show a scary error — show "Already handled — {name} approved this" and
  refetch. **Any resident of the flat may decide**, so a race with a flat-mate is a normal event, not an
  exception.
- Empty state is the common state: "No one is waiting."
- The heads-up push (§7.2) carries the same two actions, so the common path never opens the app.

**Passes** — `GET /passes/mine` (paged, 25) and `POST /passes`.

- Create form: visitor name/phone (optional), type, **valid until** (presets: 2h / today / tomorrow /
  custom, capped at 30 days), `maxUses` 1–50 (default 1).
- Response `CreatePassResponse { id, pin, qrToken, validFrom, validUntil, maxUses }` — the **PIN is shown
  once**. Present a full-screen pass card: big PIN, QR rendered locally from `qrToken`
  (`react-native-qrcode-svg`), validity window.
- **Share to WhatsApp** — the feature residents will actually use: `Share.share()` with text
  ("Your pass for Green Meadows: PIN 481920, valid until 6pm today") plus, ideally, the QR captured via
  `react-native-view-shot` so the guest gets a scannable image. The PIN in the share sheet is the user's
  own deliberate disclosure; the app must still never persist it.
- List rows show `status`, `pinLast4` (never the full PIN again), `useCount/maxUses`, validity. Active
  passes can be re-shown as a QR (the `qrToken` *is* retrievable) but **not** as a PIN.
- Revoke → `DELETE /passes/{id}` with confirm.

**Community** — `GET /community/posts` paged 20, infinite scroll, pinned first, pull-to-refresh, image if
present, plain-text body with linkification.

**Inbox** — `GET /notifications/mine` paged 25 · `GET /notifications/mine/unread-count` (tab badge) ·
`PATCH /notifications/mine/{id}/read` on open. Mark-read fires once and updates the badge optimistically.

### 9.5 Sales

Everything the resident has (minus flat-scoped framing), plus:

- **Duty toggle** — prominent, on the Profile tab *and* as a persistent header control on Approvals. It
  drives `PATCH /sales/me/duty { onDuty }` and, critically, whether the agent appears in the guard's
  dropdown. Off-duty must be visually unmistakable (dimmed header, "You're off duty — clients can't be
  routed to you"). Confirm before switching off if the agent has pending approvals.
- Approvals are `CLIENT`-type visits routed to them by id (`approverId == me`), so the ownership model is
  stricter than the resident's flat-wide one — no flat-mate races here.

### 9.6 Shared mobile concerns

- **Change password** screen: current + new (≥10 chars) + confirm, strength meter, and the copy must
  explain this is required. On success, **swap in the returned tokens** (§5.3) and navigate to the role
  home.
- **Profile**: name, `loginId`, role, flat (residents), duty (sales), notification settings, app version +
  build, "End shift"/"Sign out".
- **Permissions**: request notification permission *after* the first successful login with a rationale
  screen, not on cold start. Camera permission is requested at the moment the guard first taps Scan.
- **Offline**: read-only cached data with a clear "Showing data from 3 minutes ago" banner. **No write
  queue.** A queued approval that syncs 20 minutes later would let someone through a gate they were
  denied at — the correct behaviour is to fail the write loudly and make the user retry when online.

### 9.7 Accessibility & field conditions

- Minimum touch target 48dp; guard console 96dp for primary actions.
- Contrast ≥ 7:1 on the guard console (sunlight), ≥ 4.5:1 elsewhere.
- Never encode state in colour alone — approved/rejected carry an icon and a word.
- Support OS font scaling up to 200% without clipping on every screen except the guard console's
  primary actions, which are already at maximum.
- Screen-reader labels on every icon-only control (the check-out swipe needs an accessible alternative).

---

## 10. Design system

### 10.1 Tokens (shared, `packages/config/tailwind-preset`)

One token set, consumed by Tailwind on web and NativeWind on mobile. Semantic names only — no
`blue-500` in a component.

| Token | Role |
|---|---|
| `bg`, `surface`, `surface-raised`, `border` | Neutrals, light + dark |
| `text`, `text-muted`, `text-inverse` | Foreground |
| `primary` / `primary-fg` | Brand action |
| `success` / `danger` / `warning` / `info` | Status — `success` = approved/inside, `danger` = rejected, `warning` = expired/pending |
| `pending` | Distinct from `warning`: pending is *waiting*, expired is *failed* |

Type scale 12/14/16/20/24/32/48; spacing on a 4px grid; radii `sm 6 / md 10 / lg 16 / full`.

### 10.2 Status vocabulary — one mapping, everywhere

Visit statuses appear in six screens across two apps. Define once in `packages/core`:

| `VisitStatus` | Label | Colour | Icon |
|---|---|---|---|
| `PENDING` | Waiting for approval | `pending` | clock |
| `APPROVED` | Approved | `success` | check |
| `REJECTED` | Denied | `danger` | x |
| `EXPIRED` | No response | `warning` | clock-off |
| `CHECKED_IN` | Inside | `info` | log-in |
| `CHECKED_OUT` | Left | `text-muted` | log-out |

Same for `PassStatus` (`ACTIVE`/`REDEEMED`/`EXPIRED`/`REVOKED`), `VisitorType`, `NotifStatus`.
`packages/core` also exports the FSM so the UI can ask *"can I check in from here?"* rather than
hardcoding it in a button's `disabled`:

```ts
export const VISIT_TRANSITIONS: Record<VisitStatus, VisitStatus[]> = {
  PENDING:     ['APPROVED', 'REJECTED', 'EXPIRED'],
  APPROVED:    ['CHECKED_IN', 'EXPIRED'],
  CHECKED_IN:  ['CHECKED_OUT'],
  REJECTED: [], EXPIRED: [], CHECKED_OUT: [],
};
```

This mirrors `VisitStatus.java` exactly. When the backend's map changes, this changes in the same PR.

### 10.3 The guard console is its own language

Larger everything, higher contrast, fewer words, colour floods rather than badges, haptics and audio on
every state change. It should look like it belongs to the same product but not like it came off the same
screen template. Resist reusing the resident card component here.

### 10.4 Connection status

A pill in the header on both platforms: `● Live` (green) / `◌ Reconnecting` (amber, animated) /
`● Offline` (red, tappable → "Showing data from HH:MM · Retry"). On the guard console it is large enough
to read from a metre away. This is a functional control, not decoration.

---

## 11. Error handling

### 11.1 Where errors surface

| Kind | Surface |
|---|---|
| Field validation (`VALIDATION_FAILED`) | Inline, on the field, via `fieldErrors[].field` |
| Failed mutation | Toast + the form stays filled. **Never** clear user input on error. |
| Failed query, no cached data | Full-screen empty/error state with Retry |
| Failed query, cached data present | Stale banner, keep showing the cache |
| Auth/session death | Route to login with a one-line reason |

### 11.2 `409` is a first-class outcome, not a crash

Illegal FSM transitions are the expected result of two people acting at once, which is the *normal* case
in this product (flat-mates both tapping Approve; guard checking in a visit that just expired). The
handler pattern is always: refetch the entity → re-render the true state → tell the user what actually
happened in plain language. Never a red "Error 409".

### 11.3 Correlation ids

Every error toast for a `500` (and any unexpected code) shows a short, copyable correlation id from
`ApiError.correlationId`. Support then greps one string. Cheap to build, disproportionately useful.

### 11.4 Error boundaries

React error boundary per route (web) / per screen (mobile) with a Reload action, wired to whatever crash
reporter is chosen (Sentry recommended) — with a scrubber that drops `password`, `pin`,
`generatedPassword`, `fcmToken`, `accessToken`, `refreshToken` from every breadcrumb and payload.

---

## 12. Testing

| Layer | Tool | What it must cover |
|---|---|---|
| Unit | Vitest | FSM helpers, formatters, audience-rule builder, pagination conversion |
| Contract | Vitest + Zod | Every schema parses a real recorded response fixture; fixtures regenerated from the backend's OpenAPI in CI |
| Component | RTL + **MSW** | Every screen against mocked endpoints, including each error code in §4.5 |
| Session | Vitest | **Concurrent-401 single-flight refresh** (§5.3) — assert exactly one `/auth/refresh`; refresh-reuse → logout; `POST /auth/password` swaps tokens |
| Realtime | Vitest + fake STOMP | Frame → cache mutation for all five frame types; reconnect triggers reconciliation refetch |
| E2E web | Playwright | Login → must-reset → occupancy live update → compose notification with preview → send |
| E2E mobile | Maestro | Guard: log walk-in → (scripted approval) → approved screen → check in. Resident: push tap → approve. |
| A11y | axe (web), manual TalkBack/VoiceOver pass (mobile) | Per release |

Three tests that are non-negotiable because they encode the architecture:

1. **Socket-dead reconciliation.** With the STOMP client stubbed to never connect, the guard's awaiting
   screen still reaches `APPROVED` via polling, and the resident's approvals list still populates.
2. **Password-reset lockout.** With `mustResetPassword: true`, every navigation attempt lands on the
   change-password screen and no other endpoint is called.
3. **A blank township code is submitted as absent.** An empty string is a *present* code matching no
   township, and would turn every super-admin sign-in into a 401. The Zod transform in
   `loginRequestSchema` is what makes this true, and the login test asserts it.

MSW handlers live in `packages/api/src/mocks` and are shared by both apps, so a contract change breaks
one set of mocks, not two.

---

## 13. Build, config, release

### 13.1 Environment

| Var | Web | Mobile | Notes |
|---|---|---|---|
| `GATECRASH_API_URL` | `VITE_API_URL` | `EXPO_PUBLIC_API_URL` | Must be `https` outside local — the backend's `StartupSecretsValidator` refuses non-https CORS origins in prod, so a mixed-scheme setup fails at the server, confusingly. |
| Firebase config | `firebase-config.json` (web app) | `google-services.json` / `GoogleService-Info.plist` | **Not committed.** Injected at build time. |
| Sentry DSN | optional | optional | |

The backend's CORS allowlist (`CORS_ALLOWED_ORIGINS`) must contain the exact admin web origin —
scheme + host + port, no wildcard (the config rejects `*` at boot). Coordinate this at deploy time; it is
the most common "works locally, blank page in staging" cause.

### 13.2 CI

`lint → typecheck → test → build` on every PR, plus the OpenAPI drift check (§4.2). Web deploys as static
assets behind a CDN with `index.html` no-cache and hashed assets immutable. Mobile: EAS Build; internal
distribution to a test group, then store submission. Guard tablets get the OTA channel so a JS fix reaches
a gate the same day.

### 13.3 CSP (web)

The API's own CSP is irrelevant to the SPA (it serves JSON). Set the SPA's CSP at the CDN:
`default-src 'self'; connect-src 'self' https://api.example wss://api.example; img-src 'self' data: https:;
frame-ancestors 'none'`. `connect-src` must include the `wss://` origin or the socket dies silently in
production only.

---

## 14. Frontend guardrails (do not violate)

1. **Never persist an access token.** Memory only, both platforms.
2. **Never decode or trust the JWT client-side.** Use `GET /auth/me`.
3. **Never store, log, cache, or analytics-event a generated password, a PIN, an FCM token, or a refresh
   token.** The one-time credential dialog holds it in component state and nowhere else.
4. **Never treat a client-side role check as authorization.** It is navigation. The server re-checks.
5. **Never fire more than one `/auth/refresh` at a time.** Reuse revokes the family and logs the user out.
6. **Never send an unknown field in a request body.** Jackson rejects it (`400 MALFORMED_BODY`).
7. **Never render a screen that only works when the socket is alive.** Every live surface reconciles over
   REST on connect and foreground.
8. **Never queue a write for later offline sync.** Gate decisions are time-bound; fail loudly instead.
9. **Never optimistically render a state the FSM forbids.** Use `VISIT_TRANSITIONS`.
10. **Never dead-end a guard.** Every failure at the gate offers a next action.

---

## 15. Backend gaps that block frontend work

These are **not** client-side problems. Each needs a backend change; the proposed contract is included so
the work is small.

### 15.1 No image upload endpoint — blocks gate photos and community images

`CreateVisitRequest.photoUrl` and `CreatePostRequest.imageUrl` accept a URL that the server validates as
https on an allowlisted host (`SafeUrl`). There is no way for a client to *produce* such a URL. The guard
cannot capture a visitor snapshot, and the admin cannot upload a milestone photo.

**Proposed:** `POST /api/v1/uploads/presign { contentType, purpose: VISIT_PHOTO|COMMUNITY_IMAGE }` →
`{ uploadUrl, publicUrl, expiresAt }` (S3 presigned PUT), with the bucket host on the `SafeUrl` allowlist.
Client PUTs the file directly, then sends `publicUrl`. Needs a size cap (5MB, matching
`spring.servlet.multipart.max-file-size`) and content-type allowlist.

Until then: the guard flow ships **without** photo capture, and community images are paste-a-URL. Both are
called out in §8.6 and §9.3.

### 15.2 No plain WebSocket endpoint — mobile depends on a SockJS internal

`registry.addEndpoint("/ws").withSockJS()` registers SockJS only. RN connects to `/ws/websocket` (SockJS's
raw transport). It works, but it is undocumented surface that a Spring upgrade could move.

**Proposed:** add `registry.addEndpoint("/ws-native").setAllowedOriginPatterns(origins);` (no SockJS)
alongside the existing one. Two lines, and mobile gets a contract instead of a workaround.

### 15.3 No guard→gate assignment

The guard picks their own gate in the app and any `GUARD` may subscribe to any `/topic/gate/{id}` — noted
as a known limitation in `StompAuthChannelInterceptor`. The client-side picker (§9.3) is the interim.

**Proposed:** `gate_id` on `app_user` (or a `guard_gate` join table), set at provisioning, returned on
`MeResponse`, enforced in the STOMP interceptor. The frontend would then drop the picker and read the
gate from the session — strictly less code.

### 15.4 No server-side visitor-log export

The admin CSV export pages the API client-side and is capped at 10,000 rows (§8.4).

**Proposed:** `GET /admin/visits/export` with the same filters, streaming `text/csv`. Removes the cap and
the client-side paging loop.

### 15.5 Server constants aren't discoverable

The client needs `visit.pendingTtlMinutes` (countdown), `pass.pinLength`, `pass.maxValidityDays`,
`pass.maxUsesLimit`, `password.minLength`. All exist in `AppProperties`; none are exposed. Today the
client duplicates them as constants in `packages/core` — which silently diverges the moment ops changes
an env var.

**Proposed:** `GET /api/v1/config` (authenticated, non-secret values only) returning those five numbers.
Cached for the session.

### 15.6 `POST /visits` and `POST /notifications` omit `createdAt`

Verified against a running backend: the create responses for both endpoints come back **without**
`createdAt`, while every `GET` of the same entity includes it. The row is not flushed at the point
the mapper reads it, and `spring.jackson.default-property-inclusion: non_null` then drops the null
field entirely rather than sending `"createdAt": null`.

For notifications this is cosmetic. For visits it is not: **the guard's pending-TTL countdown
(§9.3) is computed from `createdAt`**, and the walk-in flow gets its visit from exactly that POST
response. The countdown therefore has no start time until the first reconciliation fetch lands.

**Proposed:** flush before mapping (or map from the persisted entity) so the create responses carry
the same fields as the reads. Until then `VisitResponse.createdAt` is typed nullable in
`packages/api`, and the guard screen must fall back to `GET /visits/{id}`.

> Related, and the reason the client's Zod schemas use a `nullish()` helper rather than
> `.nullable()`: because of `default-property-inclusion: non_null`, **every** null field is absent
> from the JSON rather than present as `null`. A schema written from Appendix B alone rejects most
> real responses — an admin's `MeResponse` has no `flatId` key at all, and a pending walk-in has no
> `visitorPhone`, `vehicleNo`, `photoUrl`, `decidedAt`, `checkedInAt` or `checkedOutAt`.

### 15.7 Service error codes are more specific than §4.5's table

`ConflictException`, `GoneException`, `UnauthorizedException` and `BusinessValidationException` all
accept an optional `code`, and services use it heavily. So the real wire codes include
`ILLEGAL_TRANSITION`, `FLAT_OCCUPIED`, `BLOCK_NOT_EMPTY`, `LOGIN_ID_TAKEN`, `PASS_EXPIRED`,
`INVALID_CREDENTIALS`, `WEAK_PASSWORD` and others — **not** the generic `CONFLICT` / `GONE` /
`UNAUTHORIZED` that §4.5's table lists.

There is also a **422 `UNPROCESSABLE`** status (`BusinessValidationException`) that §4.5 does not
mention at all; it carries the business-rule failures whose message is the only place the actual
reason appears ("Password must not contain your login id", "roles must be provided for mode ROLES").

Consequence for clients, and the reason `packages/api` classifies by **status** rather than by code:
a handler written as `code === 'CONFLICT'` misses almost every conflict that actually happens.
Switch on `code` for specific copy; use the status for "what kind of failure is this".

### 15.8 Smaller items

- **`GET /passes/mine` has no status filter** — "Active passes" tab filters client-side within the page,
  which is wrong across page boundaries. A `?status=ACTIVE` param fixes it.
- **No `GET /notifications/{id}` recipient breakdown** — the history screen can show counts but not
  "which flats didn't receive it".
- **Community feed is `ADMIN, RESIDENT, SALES`** — confirm with product that guards should genuinely have
  no feed. The current UI assumes yes.
- **`GET /visits/pending` is unpaged** — fine for a resident, potentially large for a busy sales agent.
  Worth watching.

---

## 16. Build order

Each phase ends with the stated Definition of Done green. Do not start a phase before the previous one's
DoD is met — the ordering is load-bearing, because F1 and F2 are what every later screen is built on.

### F1 — Contract layer (`packages/api`, `packages/core`)
OpenAPI codegen + committed spec · ky client with correlation ids · `ApiError` → `ApiException` · token
store abstraction (web + mobile impls) · **single-flight refresh** · Zod schemas for the four critical
payloads + all request bodies · query key factory · MSW handlers.
**DoD:** the §12 session tests pass, including the concurrent-401 test. No UI yet.

### F2 — Realtime layer (`packages/realtime`)
STOMP client with the SockJS/native split · role-driven subscription registry · backoff + token-refresh-on-
connect-error · frame→cache dispatcher · connection status store.
**DoD:** frame→cache tests pass for all five frame types; reconnect triggers reconciliation.

### F3 — Admin web shell
Vite app · design tokens + shadcn base · login · **change-password gate** · router with role loader ·
app shell + connection pill · error boundaries.
**DoD:** a real admin can sign in with a bootstrap password, is forced to change it, and lands on an empty
occupancy board. End-to-end against a local backend.

### F4 — Admin: occupancy + visitor log
`/admin/inside` with live `OCCUPANCY_CHANGED` · visitor log table with URL-serialised filters · detail
drawer · CSV export.
**DoD:** occupancy count changes within a second of a check-in performed via curl; filters survive a page
reload.

### F5 — Admin: notifications + community + users + township
Composer with debounced preview and the confirm-with-count dialog · history · community CRUD · **user
provisioning with the one-time credential dialog** · township CRUD + bulk flat helper.
**DoD:** an admin can provision a resident, a guard and a sales agent end-to-end, and those accounts can
log into the mobile app. This phase unblocks all mobile testing.

### F6 — Mobile foundation
Expo app · navigation shells · login · change-password gate · secure token storage · **FCM registration +
notifee channels + background handler** · deep links · connection pill · profile/sign-out with device
de-registration.
**DoD:** a data-only push sent from the backend renders an actionable heads-up on a locked Android device
and a locked iPhone, and tapping Approve calls the decision endpoint.

### F7 — Mobile: Resident + Sales
Approvals (list + optimistic decide + 409 handling) · pass creation with the one-time PIN card and QR ·
WhatsApp share · pass list/revoke · community feed · inbox + unread badge · sales duty toggle.
**DoD:** resident approves from the push heads-up without opening the app; a pass created on the phone is
redeemable at the gate.

### F8 — Mobile: Guard console
Gate picker · walk-in wizard · awaiting screen with socket + polling + TTL countdown · QR scan + PIN
keypad redeem with the walk-in fallback · gate activity with check-out.
**DoD:** the full §3 loop of ARCHITECTURE.md runs on real devices: guard logs a walk-in, resident's phone
buzzes, resident approves, **guard's screen flips green in under a second**, guard checks in, admin's
occupancy board increments.

### F5b — Admin: super admin console
Township list with status chips and the archived filter · onboarding wizard (township + first admin,
one-time credential dialog carrying the township code) · inline admin list with appoint/remove ·
suspend / restore / archive · township selection that sets `actingTownshipId`.

The contract half was already typed — `packages/api/src/endpoints/platform.ts`,
`PROVISIONABLE_ROLES`, `isPlatformOperator`/`canManageTownships`, and the `X-Township-Id` wiring in
`ApiClient` — so this phase was screens, not plumbing. See §8.9.

**DoD:** a super admin onboards a township, its admin signs in with the new code, the super admin
switches into that township and provisions a guard, then archives and restores it — with the archived
township's visitor log intact afterwards.

Still open here: a township detail page, a screen for `/super/admins` (peer platform operators), and
an audit-log viewer.

### F9 — Hardening
A11y pass · i18n extraction complete · crash reporting with the secret scrubber · Playwright + Maestro
suites · sunlight/field test of the guard console on the actual tablet hardware · performance pass
(list virtualisation on the visitor log and community feed) · store submission.
**DoD:** F8's loop passes on the real gate tablet, in daylight, on the venue's wifi.

---

## Appendix A — Reference: enums

Mirror these exactly; they are Postgres enum types and the server rejects anything else.

```ts
type UserRole    = 'SUPER_ADMIN' | 'ADMIN' | 'GUARD' | 'RESIDENT' | 'SALES';
type TownshipStatus = 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
type VisitorType = 'GUEST' | 'DELIVERY' | 'MAINTENANCE' | 'CLIENT';
type VisitStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'CHECKED_IN' | 'CHECKED_OUT';
type ApproverKind = 'RESIDENT' | 'SALES';
type PassStatus  = 'ACTIVE' | 'REDEEMED' | 'EXPIRED' | 'REVOKED';
type NotifStatus = 'QUEUED' | 'SENT' | 'FAILED';
type DevicePlatform = 'ANDROID' | 'IOS' | 'WEB';
type AudienceMode = 'ALL' | 'ALL_EXCEPT' | 'ROLES' | 'FLATS' | 'BLOCKS';
type Decision    = 'APPROVED' | 'REJECTED';
```

## Appendix B — Reference: response shapes

Field names are exact. `?` marks nullable.

```ts
LoginResponse   { accessToken, refreshToken, tokenType, expiresInSeconds, mustResetPassword, role, userId, fullName,
                  townshipId?, townshipCode?, townshipName? }   // all three null for a SUPER_ADMIN
MeResponse      { id, loginId, fullName, role, mustResetPassword, onDuty, flatId?, flatNumber?, blockName?,
                  townshipId?, townshipCode?, townshipName? }
UserResponse    { id, loginId, townshipId, fullName, role, phone?, email?, active, mustResetPassword,
                  onDuty, flatId?, flatNumber?, blockName?, createdAt }
CreatedUserResponse  { id, loginId, fullName, role, townshipId?, generatedPassword }   // once
ResetPasswordResponse{ id, loginId, generatedPassword }                                // once
SalesAgentResponse   { id, fullName, loginId }

// Platform (SUPER_ADMIN)
TownshipResponse { id, code, name, status, contactEmail?, contactPhone?, activeUserCount,
                   activeAdminCount, blockCount, gateCount, createdAt, archivedAt? }
CreatedTownshipResponse { township: TownshipResponse, admin: CreatedUserResponse }   // password once
SuperAdminResponse      { id, loginId, fullName, phone?, email?, active, mustResetPassword, createdAt }

VisitResponse   { id, gateId, gateName, visitorName, visitorPhone?, visitorType, vehicleNo?, photoUrl?,
                  status, approverKind?, approverId?, approverName?, targetFlatId?, targetFlatNumber?,
                  preApprovalId?, loggedByName, createdAt, decidedAt?, checkedInAt?, checkedOutAt? }
OccupancyResponse { insideCount, visits: VisitResponse[] }

CreatePassResponse { id, pin, qrToken, validFrom, validUntil, maxUses }   // pin once
PassResponse    { id, visitorName?, visitorPhone?, visitorType, status, pinLast4?, qrToken,
                  validFrom, validUntil, maxUses, useCount, createdAt }
RedeemPassResponse { passId, visit: VisitResponse, remainingUses }

NotificationResponse    { id, title, body, audienceRule, status, recipientCount, deliveredCount, sentAt?, createdAt }
AudiencePreviewResponse { recipientCount, deviceCount }
InboxItemResponse       { id, notificationId, title, body, read, readAt?, sentAt? }
UnreadCountResponse     { unread }

PostResponse    { id, title, body, imageUrl?, pinned, authorName, publishedAt }
BlockResponse   { id, name, flatCount, createdAt }
FlatResponse    { id, number, blockId, blockName, createdAt }
GateResponse    { id, name, createdAt }
DeviceResponse  { id, platform, lastSeenAt, createdAt }                   // token never echoed
```
