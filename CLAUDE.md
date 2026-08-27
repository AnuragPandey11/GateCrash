# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

Two runnable trees, plus three design documents at the repo root that are the source of truth:

- **`gatecrash-backend/`** — Spring Boot 3 / Java 21 API. Everything below under "Architecture".
- **`gatecrash-frontend/`** — pnpm workspace: `packages/{core,api,realtime,config}` shared contract
  packages plus `apps/admin` (React + Vite admin web). Mobile (React Native) is still planned.
- **`ARCHITECTURE.md`** — full DB schema (DDL), REST API design, real-time (WebSocket/FCM) flow, and
  phased build roadmap for the entire product.
- **`BACKEND.md`** — the concrete backend build spec: project layout, security model, service-by-service
  logic, testing strategy, and a "Guardrails (do not violate)" section.
- **`FRONTEND.md`** — the frontend build spec: package split, session lifecycle, realtime client,
  screen-by-screen behaviour, and its own guardrails.

When a change touches API shape, DB schema, security rules, tenancy, or the real-time protocol, check
these docs first — they encode *why*, not just *what*.

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

Under the **local** profile, `DevDataSeeder` seeds a usable township on startup — the `DEFAULT`
township, block `Block A`, flats `A-101`–`A-104`, gate `Main Gate`, and one ready-to-use account per
role (`superadmin`, `admin`, `guard-01`, `sales-01`, `A-101-1`) all sharing the password
`Township#2026`. It is idempotent, never modifies an existing account, and **refuses to start if
`app.bootstrap.seed-demo-data` is true outside local/test**. See `gatecrash-backend/README.md`.

Sign-in takes a **township code** plus the login id (`DEFAULT` + `admin`), except for `superadmin`,
which is a `SUPER_ADMIN`, belongs to no township, and signs in with the code omitted.

Without seeding, the migrations create two accounts with an unusable `!` hash — `superadmin`
(tenantless platform operator) and `admin` (administrator of the `DEFAULT` township) — and
`BootstrapAdminInitializer` sets their real passwords at startup, from
`GATECRASH_BOOTSTRAP_SUPER_ADMIN_PASSWORD` / `GATECRASH_BOOTSTRAP_ADMIN_PASSWORD`, or random ones
printed once to the log (local/test only). There `mustResetPassword` is true, so sign in then
immediately `POST /api/v1/auth/password` — that flag blocks every other endpoint until you do.

### Tests need no Docker, but do need real Postgres

`PostgresTestSupport` uses Testcontainers when a Docker daemon is reachable, and falls back to a real
embedded PostgreSQL binary (`io.zonky.test:embedded-postgres`) otherwise. Either way, tests run against
actual PostgreSQL with the real Flyway migration and Hibernate `ddl-auto: validate` — **never H2**, because
the schema depends on native Postgres enums, JSONB, and partial indexes that H2 can't validate honestly.
One Postgres instance is shared per JVM across all test classes (`PostgresTestSupport.instance()`); each
test class owns its own data isolation.

## Architecture

### Multi-tenancy: the township is the boundary

Every operational row belongs to exactly one **township** (`township_id`), and `SUPER_ADMIN` is the
only role that belongs to none — `super_admin_is_tenantless` makes that an exact biconditional in the
schema, not a convention. Three mechanisms enforce it, and each covers what the others cannot:

1. **`TenantContext` + `TenantContextFilter`** (`common/tenant/`) decide the acting township **once,
   per request, from the authenticated principal**. An ordinary account gets its own and a header
   naming a different one is `403 TOWNSHIP_MISMATCH`; a `SUPER_ADMIN` names it in `X-Township-Id`,
   validated against the `township` table before any service runs. It is a `ThreadLocal` for the same
   reason `SecurityUtils` is: a `townshipId` threaded through every signature means the one call site
   somebody forgets is a *silent cross-tenant read*, while a missing context is a loud
   `422 TOWNSHIP_CONTEXT_REQUIRED`. Cleared in a `finally` block — request threads are pooled.
2. **Every query is anchored on it.** Finders are `findByIdAndTownship_Id`; listing specifications add
   the township predicate first and unconditionally. Another township's id is a `404`, never a `403`.
3. **Composite `(id, township_id)` foreign keys** make a cross-tenant `visitor_log` unwritable even if
   the service layer is bypassed.

Login is `(townshipCode, loginId, password)` because login ids are unique only within a township —
every township with a block A mints an `A-101-1`. A `SUPER_ADMIN` omits the code.

`SUPER_ADMIN` is granted `ROLE_ADMIN` alongside `ROLE_SUPER_ADMIN`, so it passes every
`hasRole('ADMIN')` check inside the township it names — but never `GUARD`, `RESIDENT` or `SALES`,
which are the physical parties to a visit. `/api/v1/super/**` (package `platform/`) owns the township
lifecycle: create, suspend, **archive** (the soft delete — reversible, requires the township's own
code as confirmation, and destroys nothing), restore, plus township-admin and peer-super-admin
management. `TenantContext.callAs` is how a super admin provisions into a township it names.

When adding a tenant-scoped endpoint, expect all three of the above plus the RBAC layers below.
`MultiTenancyTest` is the negative matrix that proves it (the way `RbacNegativeTest` proves the
roles), `TenancyConstraintsTest` proves the DB backstop through raw JDBC, and `SuperAdminTest`
covers the township lifecycle.

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

### The property tree: every developer's project is a different shape

A township's hierarchy is **per-tenant configurable**, not a fixed block-then-flat pair. Two tables:

- **`property_level`** — the *shape* of one township's tree: an ordered, contiguous list of levels,
  each carrying a structural `kind` (`GROUP` | `BUILDING` | `FLOOR` | `UNIT`) and the developer's own
  word for it (`singular`/`plural`). A villa community defines Cluster → Villa; a high-rise defines
  Tower → Floor → Flat; a plotted layout defines Sector → Plot. **The admin console renders one tab
  per level from these labels**, which is what makes the panel adapt per developer.
- **`property_node`** — the tree itself, every node at every level in one self-referencing table.

`township.property_type` only *seeds* the level set at creation; every label is editable afterwards.
Fifteen types across three categories — residential (apartment, villa, row house, plotted, integrated
township, co-living/PG, student housing, senior living, serviced apartments, farmhouse plots),
commercial (office, IT park, mall/retail, industrial) and mixed-use — because "a township with blocks
of flats" is one shape among many. A mall addresses `Mall → Level → Shop`; a PG addresses
`Building → Floor → Room`.

**The shape is chosen at onboarding**, on `POST /super/townships`: `propertyType` picks a preset, and
an optional `levels` array describes a structure no preset covers (validated by the same rules as
`PUT /admin/property/levels`). `GET /super/property-types` is the catalogue and is deliberately
**tenantless** — a super admin onboarding a new developer has no township to name yet, so the
tenant-scoped `/admin/property/types` would 422 on the first screen. Onboarding is the only cheap
moment to get this right, because the level set cannot be reshaped once the tree holds anything.

**The rule that keeps this honest: nomenclature is display-only.** Nothing in the code branches on a
label — every decision is made on `PropertyNodeKind`. Otherwise renaming "Flat" to "Villa" in the
console would change which rows a query matches. Likewise the DB keeps its names: tables are
`property_node`, and `app_user.flat_id` / `visitor_log.target_flat_id` **kept their column names** in
V4 while their foreign key moved to `property_node` — renaming them is a later migration, once the
frontend stops sending `flatId`.

Three fields are derived by database trigger and mapped `insertable = false, updatable = false`:
`depth` (`parent.depth + 1`), `path` (materialized `/root/child/self/`, which turns "everyone under
Tower A" into a prefix scan), and `is_unit`. `is_unit` exists solely to be a foreign-key target: the
composite `(id, township_id, is_unit)` key is what stops a resident being filed under a floor or a
whole tower. The trigger also refuses a child of a `UNIT` (a unit is a leaf) and refuses re-parenting
(it would strand every descendant's stored path). `depth = parent.depth + 1` is what makes a cycle
unrepresentable.

Unit codes are unique **per township**, stricter than the per-block rule they replaced — resident
login ids derive from them (`A-101` → `A-101-1`), so two blocks that each held a "101" both minted
`101-1`. V4 de-duplicates any such collision on the way in.

`PropertyTreeTest` is the matrix that proves the shapes; `TenancyConstraintsTest` proves the DB
backstops through raw JDBC.

**The admin console renders its structure tabs from `GET /admin/property/profile`** — one tab per
level, labelled with that level's `plural`. `apps/admin/src/features/property/use-nomenclature.ts`
is the single place labels come from; `township.test.tsx` renders the same component against a villa
and a high-rise level set and asserts it speaks both vocabularies. The i18n bundle holds templates
(`'Add {{level}}'`), never level names. Nullable fields in the property DTOs are typed `?:` on the
client because the API runs `default-property-inclusion: non_null`, so a null is omitted rather than
sent.

### Occupancy means three different things — keep them apart

- **Unit occupancy** (`occupancyRate`) — occupied units ÷ total units. **The developer's metric.**
- **Resident headcount** — `SUM(property_node.declared_occupancy)`: people, *including the family
  members who have no app account*. Counting `app_user` rows reports a four-person household as one,
  because typically only the owner has a login. `registeredResidentAccounts` is reported alongside,
  never instead — the gap is how many residents cannot yet be notified of anything.
- **Visitors inside** — `visitor_log` where `status = CHECKED_IN`. The live gate roll.

`GET /admin/property/occupancy` returns all three. `GET /admin/inside` is unchanged and still the
guard's screen. **Consistency rule:** `declared_occupancy` may never sit below a unit's active
resident account count — provisioning raises it automatically, and lowering it below is a
`409 OCCUPANCY_BELOW_RESIDENTS`. The invariant spans two tables, so it lives in the service layer.

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
  `toUser(userId, dest, evt)` → `/user/{userId}/queue/...`, occupancy →
  `/topic/admin/inside/{townshipId}`. The tenant is in the destination, not the payload — a shared
  topic would push every township's movements to every township's dashboard.
- `StompAuthChannelInterceptor` validates the JWT on STOMP `CONNECT` (refusing a non-`ACTIVE`
  township) and rejects subscriptions to channels the principal doesn't own — checking the **tenant**
  as well as the role, since a valid token from township A must not reach township B's gate topic.
- **After-commit dispatch is mandatory**: every push/WebSocket side effect goes through
  `AfterCommitExecutor` so it only fires once the triggering transaction actually commits — a rolled-back
  transaction must never have already told someone their gate buzzed.
- Single-node `enableSimpleBroker` for now; horizontal scaling needs a STOMP relay or Redis pub/sub bridge
  (noted in `WebSocketConfig`).

### Auth & tokens

- Login is `townshipCode` + `login_id` + password only — no self-signup, no OTP. All accounts are
  admin-provisioned (`UserProvisioningService`, which refuses `ADMIN` from anyone but a super admin
  and `SUPER_ADMIN` outright). Residents get a derived `login_id` (flat number + per-flat sequence,
  e.g. `A-101-1`, `A-101-2`, unique *within the township*); sales/guard/admin get an admin-assigned
  code. `AppUserDetailsService` is deliberately not a Spring `UserDetailsService` — resolving an
  account from a username alone no longer has a single answer.
- Generated passwords/PINs are returned exactly once in the API response and never logged or stored in
  plaintext (BCrypt for passwords; `PinHasher` — a peppered HMAC — gives PIN redemption a queryable index
  without ever storing/querying the plaintext PIN).
- Access tokens are short-lived JWTs stamped with `tokenVersion`, so a password change, admin
  deactivation, or a township suspension invalidates them immediately rather than waiting out the TTL
  (`JwtAuthFilter`, which also refuses a non-`ACTIVE` township). The `tid` claim is informational
  only — authorization always takes the township from the reloaded row. Refresh
  tokens are opaque, stored only as SHA-256, one-time-use with family-wide revocation on reuse
  (`RefreshTokenService`, `RefreshTokenRevoker`).
- `LoginAttemptService` / `FixedWindowRateLimiter` throttle login and PIN redemption. In-process only —
  needs Redis before running more than one instance.
- `StartupSecretsValidator` refuses to boot outside local/test with the default JWT secret, PIN pepper, or
  a non-`https` CORS origin.

### Notification targeting engine

`AudienceResolver` compiles an `audienceRule` JSONB (`ALL`, `ALL_EXCEPT`, `ROLES`, `FLATS`, `BLOCKS`) into
one parameterized SQL query against `app_user` (+ `property_node` joins), anchored on the
current township in **every** mode including `ALL` — the difference between "everyone here" and
"everyone on the platform". The resolved set is
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
  `ddl-auto: validate`, never auto-DDL. Current migrations: `V1__init.sql` (single-tenant baseline),
  `V2__super_admin_role.sql` (the enum label alone — PostgreSQL cannot *use* a new enum value in the
  transaction that adds it, and Flyway runs one transaction per migration), `V3__multi_tenancy.sql`,
  `V4__property_tree.sql`, `V5__property_types.sql` (nine more `property_type` labels — labels only,
  split out for V2's reason). Note V4 *creates* enum types rather than adding labels to an existing one,
  and a freshly created type **is** usable in the same transaction — so it needed no split.
- Postgres `ENUM` columns map with `@JdbcTypeCode(SqlTypes.NAMED_ENUM)` + `@Enumerated(EnumType.STRING)`;
  `JSONB` columns map with `@JdbcTypeCode(SqlTypes.JSON)`.
- Never expose `passwordHash`, generated passwords (beyond the one-time create response), PIN plaintext,
  or raw refresh tokens over HTTP or in logs.

## Known limitations (see `gatecrash-backend/README.md` for the full list)

- Single-node WebSocket broker — no cross-instance subscription sharing yet.
- No guard-to-gate assignment in the schema — any `GUARD` can subscribe to any gate topic *in their
  own township*; the tenant half of that check is enforced, the per-gate half is not.
- Rate limiting is in-process/per-instance — fine for Phase 1, move to Redis before scaling out.
- The super admin **console** (admin web screens for the township lifecycle) is not built yet. The
  API, the typed client (`packages/api/src/endpoints/platform.ts`) and the acting-township wiring are
  complete; see ARCHITECTURE.md §4 phase 9b.
