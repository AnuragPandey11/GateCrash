# GateCrash — Frontend

pnpm workspace for the GateCrash Township ERP clients. [FRONTEND.md](../FRONTEND.md) is the spec;
this README is how to run what is here.

**Shipped: the Admin Web app and the three shared packages it is built on** — phases F1–F5 of
FRONTEND.md §16. The Expo mobile app (F6–F8) is not in this repo yet; `packages/api`,
`packages/core` and `packages/realtime` were written to be consumed by it unchanged, which is the
point of the workspace.

```
gatecrash-frontend/
├── packages/
│   ├── config/      Design tokens, Tailwind preset, shared ESLint config
│   ├── core/        Enums, the visit FSM, status vocabulary, formatters, i18n resources
│   ├── api/         THE contract layer — client, errors, session, schemas, endpoints, hooks, MSW
│   └── realtime/    STOMP client, subscription registry, frame → query-cache dispatcher
├── apps/
│   └── admin/       Vite + React SPA for ADMIN
└── tools/openapi/   Spec fetch + codegen against a running backend
```

## Setup

Requires Node ≥ 20.11 and pnpm 9 (`corepack enable && corepack prepare pnpm@9.12.0 --activate`).

```bash
pnpm install
cp apps/admin/.env.example apps/admin/.env.local     # VITE_API_URL=http://localhost:8080
pnpm dev:admin                                        # http://localhost:5173
```

The backend must be running, and its `CORS_ALLOWED_ORIGINS` must contain the **exact** SPA origin —
scheme, host and port, no wildcard. `http://localhost:5173` is already in the default allowlist.
Getting this wrong is the most common "works locally, blank page in staging" cause (§13.1).

```bash
cd ../gatecrash-backend
mvn spring-boot:run -Dspring-boot.run.profiles=local
```

## Sign in

Under the local profile the backend seeds a usable township on startup — a block, four flats, a
gate, and one ready-to-use account per role. All of them share one password:

| Login ID | Role | Where it signs in |
|---|---|---|
| `admin` | `ADMIN` | **This app** — http://localhost:5173 |
| `guard-01` | `GUARD` | Mobile app (not built yet) |
| `sales-01` | `SALES` | Mobile app (not built yet) |
| `A-101-1` | `RESIDENT` | Mobile app (not built yet) |

```
password: Township#2026
```

Use `admin` for the dashboard. The other three exist so the admin screens have real data to show —
a resident to route a visit to, a sales agent for the on-duty dropdown, a guard to log arrivals —
and so the mobile app has accounts waiting when it lands.

Seeded accounts skip the forced password change, so `admin` lands straight on the occupancy board.
The other three roles are refused by this app by design: signing in as `A-101-1` here gets the
"this account uses the mobile app" screen, not a permissions error.

Seeding is local/test only and the backend refuses to start if it is ever enabled elsewhere — see
[gatecrash-backend/README.md](../gatecrash-backend/README.md#seeded-development-accounts) for the
full rules, how to change the password, and what happens on a database with no seeding.

If you are pointing at a backend **without** seeding, the V1 migration creates only an `admin` row
with an unusable password; set `GATECRASH_BOOTSTRAP_ADMIN_PASSWORD` before its first boot or read
the generated one from the log. There `mustResetPassword` is true, so this app will force a
password change before anything else loads — which is the flow `/change-password` exists for.

## Commands

```bash
pnpm dev:admin        # Vite dev server
pnpm build:admin      # typecheck + production build
pnpm preview:admin

pnpm -r lint          # ESLint across every package
pnpm -r typecheck     # tsc --noEmit across every package
pnpm -r test          # Vitest across every package

pnpm gen:api          # regenerate openapi.json + generated types (needs a running backend)
```

Single test file or case:

```bash
pnpm --filter @gatecrash/api exec vitest run src/session.test.ts
pnpm --filter @gatecrash/admin exec vitest run -t "password-reset lockout"
```

## The parts worth knowing before changing anything

**Nothing outside `packages/api` talks to the backend.** A `no-restricted-globals: fetch` lint rule
enforces it. That is what keeps correlation ids, the auth header and the single-flight refresh true
everywhere rather than per call site.

**Only one `/auth/refresh` may ever be in flight.** Refresh tokens are one-time use and reuse
revokes the whole family server-side, so two concurrent 401s that each refresh would sign the user
out mid-shift. `SessionManager.refreshOnce` serialises them; `session.test.ts` asserts exactly one
request for ten concurrent callers.

**The access token is never persisted.** Memory only. A reload silently refreshes instead.

**Errors are classified by HTTP status, not by code.** The backend's services throw their own
specific codes at the standard statuses — `ILLEGAL_TRANSITION`, `FLAT_OCCUPIED`, `LOGIN_ID_TAKEN`
are all 409s that are not literally `"CONFLICT"`. Switch on `code` for specific copy; use
`error.isConflict` / `isGone` / `isBusinessRule` for "what kind of failure is this".

**Every null field is absent from the JSON.** The backend runs
`spring.jackson.default-property-inclusion: non_null`, so an admin's `MeResponse` has no `flatId`
key at all. The Zod schemas use a `nullish()` helper and normalise absent to `null`, which is a
large part of why the four critical payloads are parsed at the boundary.

**No screen may depend on the socket being alive.** WebSocket frames are an accelerant; Postgres is
the source of truth. Every live surface reconciles over REST on connect, on reconnect and on window
focus. The admin test suite renders **without** a `RealtimeProvider` at all, so this property is the
default condition rather than one test somebody remembered to write.

**One-time secrets never leave component state.** Generated passwords live in the credential
dialog's props and nowhere else — not the query cache, not a log, not a URL. There is a test
asserting the query cache never contains one.

## Testing

| Layer | Where |
|---|---|
| FSM, formatters, audience rules, pagination | `packages/core` |
| Session single-flight refresh, error envelope, boundary schemas | `packages/api` |
| Frame → cache for all five frame types, backoff, subscription registry | `packages/realtime` |
| Screens against MSW, including each error code | `apps/admin/src/routes/*.test.tsx` |

MSW handlers live in `packages/api/src/mocks` and are shared, so a contract change breaks one set
of mocks rather than two that drift apart.

The admin app runs its tests under **happy-dom, not jsdom**: jsdom supplies its own `AbortSignal`
but no `fetch`, so requests end up handing a jsdom signal to Node's undici and every one of them
fails. happy-dom provides the whole fetch stack from one realm.

## Known gaps

Client-side, from the spec's own list (§15) plus what running against a live backend turned up:

- **No image upload endpoint**, so community images are paste-a-URL and gate photo capture is not
  built at all (§15.1).
- **No server-side visitor-log export**, so the CSV export pages the API client-side and is capped
  at 10,000 rows (§15.4).
- **Server constants are not discoverable**, so `packages/core/src/constants.ts` duplicates the
  pending TTL, PIN length and pass limits. These silently diverge the moment ops changes an env
  var (§15.5).
- **`POST /visits` returns no `createdAt`** (§15.6), which is why `VisitResponse.createdAt` is
  typed nullable. It matters for the guard's TTL countdown, not for this app.
- **Web push is not wired.** The `platform: 'WEB'` registration path exists in `packages/api` but
  the admin app does not register a device or prompt for permission — occupancy already streams
  over WebSocket while the tab is open (§7.3).
- **Single-node WebSocket broker** on the backend, so horizontal scaling needs a relay before the
  connection pill means anything across instances.
