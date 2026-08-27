# GateCrash Backend

Township ERP — Phase 1: Visitor Management + Targeted Notifications.

Implements [ARCHITECTURE.md](../ARCHITECTURE.md) and [BACKEND.md](../BACKEND.md) in full: identity &
RBAC, **multi-tenancy with a platform `SUPER_ADMIN`**, visitor management with a guarded state
machine, pre-approval passes, targeted notifications, community feed, and the real-time layer
(WebSocket/STOMP + FCM) that drives the gate/approver loop.

One deployment serves many **townships**, each fully isolated. Every operational row carries a
`township_id`; `SUPER_ADMIN` is the only role that carries none, and is the only role that can create,
suspend, archive or restore a township or appoint its administrators.

- **Java 21 · Spring Boot 3.3.4 · Maven**
- **PostgreSQL 16 · Flyway** (migrate on boot, `ddl-auto: validate`)
- **JWT access tokens + opaque rotating refresh tokens · Spring Security method-level RBAC**
- **Firebase Admin SDK (FCM) · Spring WebSocket/STOMP**
- **ShedLock** (leader-locked scheduled jobs) **· Testcontainers / embedded PostgreSQL** (integration tests)

## Quick start

```bash
cp .env.example .env        # then edit JWT_SECRET / PASS_PIN_PEPPER for anything beyond a laptop
docker-compose up -d        # Postgres 16 on localhost:5432
./mvnw spring-boot:run -Dspring-boot.run.profiles=local
```

Swagger UI: http://localhost:8080/swagger-ui

### Seeded development accounts

Under the **local** profile the app seeds a usable township on startup — a block, four flats, a
gate, and one ready-to-use account per role (`DevDataSeeder`). Every one shares the same password:

| Township code | Login ID | Role | Notes |
|---|---|---|---|
| *(none)* | `superadmin` | `SUPER_ADMIN` | Platform operator — creates townships |
| `DEFAULT` | `admin` | `ADMIN` | Admin web app |
| `DEFAULT` | `guard-01` | `GUARD` | Gate Guard One |
| `DEFAULT` | `sales-01` | `SALES` | Meera Shah |
| `DEFAULT` | `A-101-1` | `RESIDENT` | Ravi Kumar, flat A-101 |

```
password: Township#2026
```

**Sign-in takes the township code as well as the login id** — login ids are unique only within a
township, so `A-101-1` exists in every township that has a block A:

```bash
curl -s localhost:8080/api/v1/auth/login -H 'Content-Type: application/json' \
  -d '{"townshipCode":"DEFAULT","loginId":"admin","password":"Township#2026"}'

# The super admin belongs to no township, so it omits the code entirely:
curl -s localhost:8080/api/v1/auth/login -H 'Content-Type: application/json' \
  -d '{"loginId":"superadmin","password":"Township#2026"}'
```

Also created: the **`DEFAULT`** township, its property levels (**Block** → **Flat**), block
**Block A**, flats **A-101 … A-104**, gate **Main Gate**. The seed keeps the two-level shape
deliberately — its job is a predictable fixture, not a tour of the tree, which can express
Cluster → Villa or Tower → Floor → Flat just as well.

A resident cannot be provisioned without a unit and a guard cannot log a visit without a gate, so
seeding the accounts alone would not actually be usable.

Seeded accounts have `mustResetPassword` **false** — the point of a fixture is that it is ready to
use, and four forced password changes before any testing can start is not that. The seeder is
idempotent: it creates only what is missing and never modifies an account that already exists, so
if you change a password by hand it survives every restart.

> **This only ever runs under the `local` or `test` profiles.** `DevDataSeeder` refuses to start —
> loudly, not silently — if `app.bootstrap.seed-demo-data` is ever true anywhere else. Accounts
> sharing a password that is printed to a log and written in this README are a convenience on a
> laptop and a breach anywhere real. Override the password with `GATECRASH_SEED_PASSWORD`, or turn
> the whole thing off with `app.bootstrap.seed-demo-data: false`.

**Without seeding** (any other profile, or the flag off): the migrations seed two accounts with an
unusable `!` password hash — `superadmin` (tenantless platform operator, from `V3`) and `admin`
(administrator of the `DEFAULT` township, from `V1`) — and `BootstrapAdminInitializer` sets their real
passwords at startup, from `GATECRASH_BOOTSTRAP_SUPER_ADMIN_PASSWORD` /
`GATECRASH_BOOTSTRAP_ADMIN_PASSWORD`, or random ones printed once to the log under local/test. Either
way `mustResetPassword` is true, so sign in and `POST /api/v1/auth/password` immediately; that flag
blocks every other endpoint until you do.

### Onboarding a township

```bash
# As the super admin. Creates the township and its first administrator in one call --
# a township with no admin is unusable and nobody inside it can fix that.
curl -s localhost:8080/api/v1/super/townships -H "Authorization: Bearer $SUPER_TOKEN" \
  -H 'Content-Type: application/json' -d '{
    "code": "GREENWOOD",
    "name": "Greenwood Township",
    "admin": { "loginId": "greenwood-admin", "fullName": "Priya Nair" }
  }'
# -> { township: {...}, admin: { loginId, generatedPassword } }   <- password shown exactly once
```

A super admin then works *inside* a township by calling the ordinary `/api/v1/admin/**` endpoints with
an `X-Township-Id` header naming it. Omitting the header on a township-scoped endpoint is a clear
`422 TOWNSHIP_CONTEXT_REQUIRED` rather than a silent default — picking a township on the caller's
behalf is how an announcement lands in the wrong community.

`DELETE /api/v1/super/townships/{id}` **archives**: sign-in stops immediately, every live session ends
(token versions bumped, refresh tokens revoked), and nothing is destroyed. It requires the township's
own code in the body as confirmation, and `POST .../restore` reverses it. There is no hard delete —
the visitor log and audit trail are the record of who was admitted through a gate and who authorised
it.

## Running the tests

```bash
./mvnw test
```

No Docker required: `PostgresTestSupport` uses Testcontainers when a Docker daemon is reachable and
falls back to a real embedded PostgreSQL binary otherwise. Either way, every test runs against actual
PostgreSQL with the real Flyway migration and Hibernate's `ddl-auto: validate` — never H2. 189 tests,
covering:

- **RBAC negative matrix** — every role probing every endpoint it doesn't own, over the real Spring
  Security filter chain with genuine signed JWTs (`RbacNegativeTest`).
- **Auth** — login/lockout, refresh rotation, reuse-detection burning the token family, forced
  password reset, session revocation on password change (`AuthIntegrationTest`).
- **Provisioning** — the `A-101-1`/`A-101-2` login-id sequence, one-time generated passwords, conflict
  handling (`UserProvisioningTest`).
- **Visit FSM** — every legal/illegal transition, ownership checks (wrong unit, wrong sales agent),
  CLIENT→SALES routing, hostile photo URLs (`VisitFsmTest`, `VisitStatusTest`).
- **Passes** — PIN/QR redemption, hash-only storage, rate limiting, expiry, revocation
  (`PassRedemptionTest`).
- **Notifications** — every audience mode resolves the exact expected set, preview matches send,
  inbox scoping (`AudienceResolverTest`).
- **Property tree** — a villa community and a high-rise built side by side in one database; level-shape
  validation; unit-code uniqueness; bulk floor/unit generation; and the occupancy invariant, including
  that a four-person household with one login counts as four residents (`PropertyTreeTest`).
- **Scheduled jobs** — expiry sweeps are idempotent and leave live state untouched
  (`ExpirySweepJobTest`).
- **End-to-end WebSocket** — a real STOMP client proves `VISIT_REQUESTED`/`VISIT_DECIDED` frames
  arrive, and that a resident is refused a subscription to the admin occupancy topic
  (`ApprovalLoopWebSocketTest`).

## Security posture

Three enforcement layers on every privileged operation, and none of them is optional:

1. **`@PreAuthorize`** on service methods (not controllers) settles which *role* may call it.
2. **Service-layer ownership re-checks** settle whether *this* caller may touch *this* row — e.g. a
   resident may only decide a visit routed to their own flat; a sales agent may only decide one routed
   to them personally. The id in the URL is attacker-controlled and never trusted alone.
3. **DB constraints** (`CHECK`, `UNIQUE`, enum types) are the backstop so a bug or race can never
   persist an invalid row, independent of the application layer.

**Tenancy is a fourth, independent boundary**, and it has to be: every one of the three layers above
passes for an admin reaching at another township's data, because their role really is `ADMIN` and the
row really does exist.

- **`TenantContext` / `TenantContextFilter`** decide the acting township once per request, from the
  authenticated principal — never from a path, body or query parameter. An ordinary account gets its
  own; a `SUPER_ADMIN` names one in `X-Township-Id`, validated before any service runs.
- **Every finder is anchored on it** (`findByIdAndTownship_Id`, township-first specifications). A row
  from another township answers `404`, never `403` — across a tenant boundary "not yours" and "does
  not exist" must be the same answer.
- **Composite `(id, township_id)` foreign keys** make a cross-tenant `visitor_log` unwritable at the
  storage layer, and `super_admin_is_tenantless` makes "SUPER_ADMIN ⟺ no township" exact.
- **Pass redemption and audience resolution narrow by township first.** A PIN or QR code from one
  township is not a key at another's gate, and an `ALL` broadcast means "everyone here".

Three test classes hold this up: `MultiTenancyTest` is the negative tenancy matrix (the counterpart
to `RbacNegativeTest` — every case holds a valid token for the right role and is refused anyway),
`TenancyConstraintsTest` proves the database refuses a cross-tenant row through raw JDBC with the
whole application layer bypassed, and `SuperAdminTest` covers the township lifecycle.

Other things worth knowing before you extend this:

- **Passwords & PINs.** BCrypt only; a peppered HMAC (`PinHasher`) gives PIN redemption an index to
  query without ever storing or querying the plaintext. Generated credentials are returned exactly
  once and never logged.
- **Tokens.** Access tokens are short-lived JWTs stamped with `tokenVersion`, so a password change or
  admin deactivation invalidates them immediately rather than waiting out the TTL — see
  `JwtAuthFilter`. Refresh tokens are opaque, stored only as SHA-256, one-time-use with family-wide
  revocation on reuse (`RefreshTokenService`, `RefreshTokenRevoker`).
- **Login/redemption throttling.** `LoginAttemptService` / `FixedWindowRateLimiter` bound brute force
  on both login and PIN redemption. In-process only — swap for Redis before running >1 instance.
- **Startup guardrails.** `StartupSecretsValidator` refuses to boot outside local/test with the
  default JWT secret, PIN pepper, or a non-`https` CORS origin.
- **After-commit dispatch.** Every push/WebSocket side effect (`AfterCommitExecutor`) fires only after
  the triggering transaction commits — a rollback must never have already told someone their gate
  buzzed.
- **Everything is audited.** Every state transition — visit decisions, pass redemption/failure, login
  failures, refresh reuse — writes an immutable `audit_log` row (`AuditService`), with values that
  look like secrets redacted defensively before they're ever persisted.

See inline docs on `SecurityConfig`, `VisitService`, `PassService`, `StompAuthChannelInterceptor`, and
`AudienceResolver` for the reasoning behind specific decisions.

## Known limitations / next steps

- **A node cannot be re-parented.** Moving a tower between phases would strand the stored `path` of
  every descendant, so the trigger refuses it outright rather than shipping a recursive path rewrite
  whose failure mode is a silently mis-scoped notification audience. Delete and recreate for now.
- **Levels cannot be reshaped once the tree is populated** (`409 PROPERTY_TREE_NOT_EMPTY`). Inserting
  a Floor level under towers that already hold flats has no safe automatic answer to which floor each
  flat belongs on. Renaming a level stays available at any time.
- **Single-node WebSocket broker.** `enableSimpleBroker` doesn't share subscriptions across instances.
  Scaling horizontally needs a STOMP relay (RabbitMQ/ActiveMQ) or a Redis pub/sub bridge — noted in
  `WebSocketConfig`.
- **No guard-to-gate assignment in the schema.** Any GUARD may subscribe to any gate topic *in their
  own township* — the tenant half of that check is enforced, the per-gate half is not. Narrowing it
  needs a `gate_id` on `app_user` (or a join table) plus one more check in
  `StompAuthChannelInterceptor` — noted there.
- **Rate limiting is per-instance.** Fine for Phase 1; move to Redis when the backend goes
  multi-instance. Login budgets are keyed on `(townshipCode, loginId)`, so one township's failures
  cannot lock out another township's account of the same name.
- **The super admin console is minimal.** `/townships` in the admin web app covers the lifecycle and
  admin management; the `/super/admins` endpoints (managing peer platform operators) are implemented
  and typed on the client but have no screen yet.
- **Scheduled sweeps run platform-wide.** `ExpirySweepJob` acts on a time predicate, not on caller
  input, so one set-based statement covers every township rather than N per-tenant queries. Its audit
  rows are recorded as system actions with no township, which is what they are.
