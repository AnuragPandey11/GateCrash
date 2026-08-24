# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

This repo currently contains only the backend (`gatecrash-backend/`), plus two design documents at the
repo root that are the source of truth for the whole system:

- **`ARCHITECTURE.md`** — full DB schema (DDL), REST API design, real-time (WebSocket/FCM) flow, and
  phased build roadmap for the entire product (backend + admin web + mobile).
- **`BACKEND.md`** — the concrete backend build spec: project layout, security model, service-by-service
  logic, testing strategy, and a "Guardrails (do not violate)" section. This is what the current Java
  code implements.

Admin web (React) and mobile (React Native) are planned (see ARCHITECTURE.md §4 phases 7–8) but not yet
present in this repo — everything here today is the Spring Boot backend.

When a change touches API shape, DB schema, security rules, or the real-time protocol, check these two
docs first — they encode *why*, not just *what*.

## Commands

All commands run from `gatecrash-backend/`. There is no `mvnw` wrapper committed — use the system `mvn`.

```bash
# First-time setup
cp .env.example .env            # edit JWT_SECRET / PASS_PIN_PEPPER for anything beyond a laptop
docker-compose up -d            # Postgres 16 on localhost:5432

# Run the app (local profile)
mvn spring-boot:run -Dspring-boot.run.profiles=local

# Run the full test suite
mvn test

# Run a single test class
mvn test -Dtest=VisitFsmTest

# Run a single test method
mvn test -Dtest=VisitFsmTest#pendingCannotSkipToCheckedIn

# Build the jar
mvn package
```

Swagger UI: `http://localhost:8080/swagger-ui`.

Under the **local** profile, `DevDataSeeder` seeds a usable township on startup — block `Block A`,
flats `A-101`–`A-104`, gate `Main Gate`, and one ready-to-use account per role (`admin`, `guard-01`,
`sales-01`, `A-101-1`) all sharing the password `Township#2026`. It is idempotent, never modifies an
existing account, and **refuses to start if `app.bootstrap.seed-demo-data` is true outside
local/test**. See `gatecrash-backend/README.md`.

Without seeding, the V1 migration creates only an `admin` row with an unusable `!` hash and
`BootstrapAdminInitializer` sets the real password at startup — from
`GATECRASH_BOOTSTRAP_ADMIN_PASSWORD`, or a random one printed once to the log (local/test only).
There `mustResetPassword` is true, so sign in as `admin` then immediately
`POST /api/v1/auth/password` — that flag blocks every other endpoint until you do.

### Tests need no Docker, but do need real Postgres

`PostgresTestSupport` uses Testcontainers when a Docker daemon is reachable, and falls back to a real
embedded PostgreSQL binary (`io.zonky.test:embedded-postgres`) otherwise. Either way, tests run against
actual PostgreSQL with the real Flyway migration and Hibernate `ddl-auto: validate` — **never H2**, because
the schema depends on native Postgres enums, JSONB, and partial indexes that H2 can't validate honestly.
One Postgres instance is shared per JVM across all test classes (`PostgresTestSupport.instance()`); each
test class owns its own data isolation.

## Architecture

### Layering is strict: controller → service → repository

Controllers are thin — validate `@RequestBody`, call one service method, map to a DTO. **All business
logic and all `@PreAuthorize` annotations live on service methods, not controllers.** JPA entities are
never returned over HTTP; every response is a mapped DTO (MapStruct or manual mappers, e.g. `UserMapper`,
`VisitMapper`).

Feature packages under `com.gatecrash.*` each own their entity, repository, service, controller, and a
`dto/` subpackage: `user`, `township`, `device`, `visit`, `pass`, `notification`, `community`, `push`,
`realtime`, plus cross-cutting `common`, `common/audit`, `config`, `security`.

### The three-layer security model — every privileged operation needs all three

1. **`@PreAuthorize`** on the *service* method decides which role may call it at all.
2. **Service-layer ownership re-checks** decide whether *this* caller may touch *this* row. The id in the
   URL is attacker-controlled and never trusted alone — e.g. `VisitService.decide()` checks the caller is
   actually the routed approver (resident's `flat_id` matches, or sales agent's own id matches) before
   applying the FSM transition.
3. **DB constraints** (`CHECK`, `UNIQUE`, Postgres enum types) are the backstop, so a bug or race can never
   persist an invalid row independent of the application layer (e.g. `client_routes_to_sales` CHECK on
   `visitor_log`).

When adding a new privileged endpoint, all three layers are expected, not optional — see
`RbacNegativeTest` for the pattern of proving layer 1, and `VisitFsmTest`/`VisitStatusTest` for layer 2.

### Two load-bearing entities

- **`visitor_log`** (`VisitorLog`) — one row per physical arrival at the gate, walk-in or pass redemption.
  Carries the live approval state the Guard screen watches. FSM: `PENDING → {APPROVED|REJECTED|EXPIRED}`,
  `APPROVED → CHECKED_IN → CHECKED_OUT`; pass redemptions skip straight to `CHECKED_IN`. Illegal
  transitions are `409`. Every transition writes an `audit_log` row.
- **`pre_approval`** (`PreApproval`) — a time-bound PIN/QR pass minted by a resident/sales agent before the
  visitor arrives. FSM: `ACTIVE → {REDEEMED|EXPIRED|REVOKED}`.

### Real-time: FCM + WebSocket are complementary, not redundant

FCM wakes a backgrounded phone (data messages, not notification-only, so the client can render a custom
actionable heads-up). WebSocket/STOMP gives sub-second in-app screen updates with no polling. **Postgres is
always the single source of truth** both reconcile against — clients also have `GET /visits/pending` and
`/notifications/mine` to reconcile on foreground after a dropped push/socket.

- `RealtimeService` wraps `SimpMessagingTemplate`: `toGate(gateId, evt)` → `/topic/gate/{id}`,
  `toUser(userId, dest, evt)` → `/user/{userId}/queue/...`, occupancy → `/topic/admin/inside`.
- `StompAuthChannelInterceptor` validates the JWT on STOMP `CONNECT` and rejects subscriptions to
  channels the principal doesn't own (a guard may only subscribe to their own gate's topic).
- **After-commit dispatch is mandatory**: every push/WebSocket side effect goes through
  `AfterCommitExecutor` so it only fires once the triggering transaction actually commits — a rolled-back
  transaction must never have already told someone their gate buzzed.
- Single-node `enableSimpleBroker` for now; horizontal scaling needs a STOMP relay or Redis pub/sub bridge
  (noted in `WebSocketConfig`).

### Auth & tokens

- Login is `login_id` + password only — no self-signup, no OTP. All accounts are admin-provisioned
  (`UserProvisioningService`). Residents get a derived `login_id` (flat number + per-flat sequence, e.g.
  `A-101-1`, `A-101-2`); sales/guard/admin get an admin-assigned code.
- Generated passwords/PINs are returned exactly once in the API response and never logged or stored in
  plaintext (BCrypt for passwords; `PinHasher` — a peppered HMAC — gives PIN redemption a queryable index
  without ever storing/querying the plaintext PIN).
- Access tokens are short-lived JWTs stamped with `tokenVersion`, so a password change or admin
  deactivation invalidates them immediately rather than waiting out the TTL (`JwtAuthFilter`). Refresh
  tokens are opaque, stored only as SHA-256, one-time-use with family-wide revocation on reuse
  (`RefreshTokenService`, `RefreshTokenRevoker`).
- `LoginAttemptService` / `FixedWindowRateLimiter` throttle login and PIN redemption. In-process only —
  needs Redis before running more than one instance.
- `StartupSecretsValidator` refuses to boot outside local/test with the default JWT secret, PIN pepper, or
  a non-`https` CORS origin.

### Notification targeting engine

`AudienceResolver` compiles an `audienceRule` JSONB (`ALL`, `ALL_EXCEPT`, `ROLES`, `FLATS`, `BLOCKS`) into
one parameterized SQL query against `app_user` (+ `flat`/`building_block` joins). The resolved set is
materialized into `notification_recipient` for audit and read tracking, then device tokens are batched to
FCM (multicast, ≤500/batch). `POST /notifications/preview` runs the same resolver read-only so an admin
sees the blast radius before sending.

### Auditing

Every state transition — visit decisions, pass redemption/failure, login failures, refresh reuse — writes
an immutable `audit_log` row via `AuditService`. Values that look like secrets are redacted before being
persisted.

### Conventions

- `snake_case` in the DB, `camelCase` in Java/JSON, `kebab-case` in URLs.
- Every schema change is a new `V<n>__description.sql` Flyway migration — never edit an applied one.
  `ddl-auto: validate`, never auto-DDL.
- Postgres `ENUM` columns map with `@JdbcTypeCode(SqlTypes.NAMED_ENUM)` + `@Enumerated(EnumType.STRING)`;
  `JSONB` columns map with `@JdbcTypeCode(SqlTypes.JSON)`.
- Never expose `passwordHash`, generated passwords (beyond the one-time create response), PIN plaintext,
  or raw refresh tokens over HTTP or in logs.

## Known limitations (see `gatecrash-backend/README.md` for the full list)

- Single-node WebSocket broker — no cross-instance subscription sharing yet.
- No guard-to-gate assignment in the schema — any `GUARD` can currently subscribe to any gate topic.
- Rate limiting is in-process/per-instance — fine for Phase 1, move to Redis before scaling out.
