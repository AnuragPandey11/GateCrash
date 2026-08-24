# GateCrash Backend

Township ERP — Phase 1: Visitor Management + Targeted Notifications.

Implements [ARCHITECTURE.md](../ARCHITECTURE.md) and [BACKEND.md](../BACKEND.md) in full: identity &
RBAC, visitor management with a guarded state machine, pre-approval passes, targeted notifications,
community feed, and the real-time layer (WebSocket/STOMP + FCM) that drives the gate/approver loop.

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

| Login ID | Role | Notes |
|---|---|---|
| `admin` | `ADMIN` | Admin web app |
| `guard-01` | `GUARD` | Gate Guard One |
| `sales-01` | `SALES` | Meera Shah |
| `A-101-1` | `RESIDENT` | Ravi Kumar, flat A-101 |

```
password: Township#2026
```

Also created: block **Block A**, flats **A-101 … A-104**, gate **Main Gate**. A resident cannot be
provisioned without a flat and a guard cannot log a visit without a gate, so seeding the accounts
alone would not actually be usable.

Seeded accounts have `mustResetPassword` **false** — the point of a fixture is that it is ready to
use, and four forced password changes before any testing can start is not that. The seeder is
idempotent: it creates only what is missing and never modifies an account that already exists, so
if you change a password by hand it survives every restart.

> **This only ever runs under the `local` or `test` profiles.** `DevDataSeeder` refuses to start —
> loudly, not silently — if `app.bootstrap.seed-demo-data` is ever true anywhere else. Accounts
> sharing a password that is printed to a log and written in this README are a convenience on a
> laptop and a breach anywhere real. Override the password with `GATECRASH_SEED_PASSWORD`, or turn
> the whole thing off with `app.bootstrap.seed-demo-data: false`.

**Without seeding** (any other profile, or the flag off): the V1 migration seeds only an `admin`
row with an unusable `!` password hash, and `BootstrapAdminInitializer` sets the real one at
startup — from `GATECRASH_BOOTSTRAP_ADMIN_PASSWORD`, or a random one printed once to the log under
local/test. Either way `mustResetPassword` is true, so sign in as `admin` and
`POST /api/v1/auth/password` immediately; that flag blocks every other endpoint until you do.

## Running the tests

```bash
./mvnw test
```

No Docker required: `PostgresTestSupport` uses Testcontainers when a Docker daemon is reachable and
falls back to a real embedded PostgreSQL binary otherwise. Either way, every test runs against actual
PostgreSQL with the real Flyway migration and Hibernate's `ddl-auto: validate` — never H2. 112 tests,
covering:

- **RBAC negative matrix** — every role probing every endpoint it doesn't own, over the real Spring
  Security filter chain with genuine signed JWTs (`RbacNegativeTest`).
- **Auth** — login/lockout, refresh rotation, reuse-detection burning the token family, forced
  password reset, session revocation on password change (`AuthIntegrationTest`).
- **Provisioning** — the `A-101-1`/`A-101-2` login-id sequence, one-time generated passwords, conflict
  handling (`UserProvisioningTest`).
- **Visit FSM** — every legal/illegal transition, ownership checks (wrong flat, wrong sales agent),
  CLIENT→SALES routing, hostile photo URLs (`VisitFsmTest`, `VisitStatusTest`).
- **Passes** — PIN/QR redemption, hash-only storage, rate limiting, expiry, revocation
  (`PassRedemptionTest`).
- **Notifications** — every audience mode resolves the exact expected set, preview matches send,
  inbox scoping (`AudienceResolverTest`).
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

- **Single-node WebSocket broker.** `enableSimpleBroker` doesn't share subscriptions across instances.
  Scaling horizontally needs a STOMP relay (RabbitMQ/ActiveMQ) or a Redis pub/sub bridge — noted in
  `WebSocketConfig`.
- **No guard-to-gate assignment in the schema.** Any GUARD may currently subscribe to any gate topic;
  narrowing that needs a `gate_id` on `app_user` (or a join table) plus one more check in
  `StompAuthChannelInterceptor` — noted there.
- **Rate limiting is per-instance.** Fine for Phase 1; move to Redis when the backend goes
  multi-instance.
