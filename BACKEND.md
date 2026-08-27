# GateCrash — Backend Build Spec

Implementation-ready backend for the Township ERP (Phase 1: Visitor Management + Targeted Notifications).
Follow this top-to-bottom; it is the source of truth for the backend. Where it deviates from
[ARCHITECTURE.md](ARCHITECTURE.md) it says so explicitly (it does not — this is the concrete realization of that design).

- **Java 21 · Spring Boot 3.3.x · Maven**
- **PostgreSQL 15+ · Flyway** (migrate on boot, `ddl-auto: validate`)
- **JWT** (access + refresh) · Spring Security method-level RBAC
- **Firebase Admin SDK** (FCM push) · **Spring WebSocket / STOMP** (live gate updates)
- **ShedLock** (leader-locked scheduled jobs) · **Testcontainers** (integration tests)

Layering is strict: `controller → service → repository`. Controllers never touch repositories; business
logic lives only in services. Never expose JPA entities over HTTP — map to/from DTOs. Money is not in
scope for Phase 1. snake_case in DB, camelCase in Java/JSON, kebab-case in URLs.

**This is a multi-tenant deployment.** Every operational row belongs to exactly one township, and
`SUPER_ADMIN` is the only role that belongs to none. §5.5 is the tenancy model and is as load-bearing
as the RBAC model beside it — read both before touching a repository or a service.

---

## 1. Project Layout

```
gatecrash-backend/
├── pom.xml
├── docker-compose.yml                 # postgres + (optional) pgadmin
├── src/main/resources/
│   ├── application.yml
│   ├── application-local.yml
│   ├── application-prod.yml
│   ├── firebase/service-account.json  # NOT committed; env/secret in prod
│   └── db/migration/
│       ├── V1__init.sql
│       ├── V2__super_admin_role.sql    # the enum label, alone -- see §5.5
│       └── V3__multi_tenancy.sql
└── src/main/java/com/gatecrash/
    ├── GateCrashApplication.java
    ├── config/
    │   ├── SecurityConfig.java
    │   ├── WebSocketConfig.java
    │   ├── FirebaseConfig.java
    │   ├── SchedulingConfig.java       # @EnableScheduling + ShedLock
    │   ├── JacksonConfig.java
    │   └── OpenApiConfig.java
    ├── security/
    │   ├── JwtService.java
    │   ├── JwtAuthFilter.java
    │   ├── AppUserDetails.java
    │   ├── AppUserDetailsService.java
    │   ├── StompAuthChannelInterceptor.java
    │   └── SecurityUtils.java          # currentUserId(), currentRole()
    ├── common/
    │   ├── ApiError.java
    │   ├── GlobalExceptionHandler.java
    │   ├── exceptions/ (NotFoundException, ForbiddenException, ConflictException, ValidationException)
    │   ├── tenant/ (TenantContext, TenantContextFilter)   # the acting township -- §5.5
    │   └── audit/ (AuditService, AuditAspect)
    ├── user/         (AppUser, enums, repo, dto, UserService, AdminUserController, AuthController, AuthService)
    ├── township/     (Township, TownshipStatus, Gate + repos + AdminTownshipController)
    ├── property/     (PropertyNode, PropertyLevel, PropertyNodeKind, PropertyType,
    │                  PropertyService, OccupancyService, AdminPropertyController)
    ├── platform/     (TownshipLifecycleService, SuperAdminService, SuperAdminController, dto)  # /api/v1/super
    ├── device/       (Device, DeviceRepository, DeviceController, DeviceService)
    ├── visit/        (VisitorLog, VisitService, VisitController, dto, VisitEventPublisher)
    ├── pass/         (PreApproval, PassService, PassController, dto)
    ├── notification/ (Notification, NotificationRecipient, AudienceResolver, NotificationService, controllers, dto)
    ├── community/    (CommunityPost, repo, service, controller, dto)
    ├── push/         (FcmService, FcmMessage, PushPayload)
    └── realtime/     (RealtimeService — thin wrapper over SimpMessagingTemplate)
```

Each feature package owns: `entity`, `Repository`, `Service`, `Controller`, `dto/`. Enums live beside the
entity that owns them (or in `user` for `UserRole`).

---

## 2. Build — `pom.xml` (key dependencies)

```xml
<parent>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-starter-parent</artifactId>
  <version>3.3.4</version>
</parent>
<properties><java.version>21</java.version></properties>

<dependencies>
  <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency>
  <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-data-jpa</artifactId></dependency>
  <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-security</artifactId></dependency>
  <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-validation</artifactId></dependency>
  <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-websocket</artifactId></dependency>

  <dependency><groupId>org.postgresql</groupId><artifactId>postgresql</artifactId><scope>runtime</scope></dependency>
  <dependency><groupId>org.flywaydb</groupId><artifactId>flyway-core</artifactId></dependency>
  <dependency><groupId>org.flywaydb</groupId><artifactId>flyway-database-postgresql</artifactId></dependency>

  <!-- JWT -->
  <dependency><groupId>io.jsonwebtoken</groupId><artifactId>jjwt-api</artifactId><version>0.12.6</version></dependency>
  <dependency><groupId>io.jsonwebtoken</groupId><artifactId>jjwt-impl</artifactId><version>0.12.6</version><scope>runtime</scope></dependency>
  <dependency><groupId>io.jsonwebtoken</groupId><artifactId>jjwt-jackson</artifactId><version>0.12.6</version><scope>runtime</scope></dependency>

  <!-- Firebase / FCM -->
  <dependency><groupId>com.google.firebase</groupId><artifactId>firebase-admin</artifactId><version>9.4.1</version></dependency>

  <!-- ShedLock -->
  <dependency><groupId>net.javacrumbs.shedlock</groupId><artifactId>shedlock-spring</artifactId><version>5.16.0</version></dependency>
  <dependency><groupId>net.javacrumbs.shedlock</groupId><artifactId>shedlock-provider-jdbc-template</artifactId><version>5.16.0</version></dependency>

  <!-- Mapping & docs -->
  <dependency><groupId>org.mapstruct</groupId><artifactId>mapstruct</artifactId><version>1.6.2</version></dependency>
  <dependency><groupId>org.springdoc</groupId><artifactId>springdoc-openapi-starter-webmvc-ui</artifactId><version>2.6.0</version></dependency>

  <!-- Test -->
  <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-test</artifactId><scope>test</scope></dependency>
  <dependency><groupId>org.springframework.security</groupId><artifactId>spring-security-test</artifactId><scope>test</scope></dependency>
  <dependency><groupId>org.testcontainers</groupId><artifactId>postgresql</artifactId><scope>test</scope></dependency>
  <dependency><groupId>org.testcontainers</groupId><artifactId>junit-jupiter</artifactId><scope>test</scope></dependency>
</dependencies>
```

Add the MapStruct + Lombok annotation processors to `maven-compiler-plugin`.

---

## 3. Configuration

`application.yml`:
```yaml
spring:
  application: { name: gatecrash-backend }
  datasource:
    url: ${DB_URL:jdbc:postgresql://localhost:5432/gatecrash}
    username: ${DB_USER:gatecrash}
    password: ${DB_PASSWORD:gatecrash}
  jpa:
    hibernate: { ddl-auto: validate }
    properties: { hibernate.jdbc.time_zone: UTC }
    open-in-view: false
  flyway: { enabled: true, locations: classpath:db/migration }

app:
  jwt:
    secret: ${JWT_SECRET:change-me-32-bytes-min-in-prod-please}
    access-ttl-min: 30
    refresh-ttl-days: 30
  firebase:
    credentials: ${FIREBASE_CREDENTIALS:classpath:firebase/service-account.json}
  visit:
    pending-ttl-minutes: 10          # PENDING visit auto-expiry
  password:
    generated-length: 10

springdoc.swagger-ui.path: /swagger-ui
```

`docker-compose.yml` runs Postgres 15. Secrets (`JWT_SECRET`, `FIREBASE_CREDENTIALS`, DB creds) come from
env / AWS Secrets Manager in prod — never committed.

Run:
```bash
docker-compose up -d
./mvnw spring-boot:run -Dspring-boot.run.profiles=local
# Swagger at http://localhost:8080/swagger-ui
```

---

## 4. Flyway Migration — `V1__init.sql`

Use the full DDL from [ARCHITECTURE.md §1](ARCHITECTURE.md) verbatim, with these additions appended:

```sql
-- ShedLock table for leader-locked jobs
CREATE TABLE shedlock (
    name       TEXT PRIMARY KEY,
    lock_until TIMESTAMPTZ NOT NULL,
    locked_at  TIMESTAMPTZ NOT NULL,
    locked_by  TEXT NOT NULL
);

-- Refresh-token store (rotation + revocation)
CREATE TABLE refresh_token (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL UNIQUE,          -- SHA-256 of the opaque refresh token
    expires_at  TIMESTAMPTZ NOT NULL,
    revoked     BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_refresh_user ON refresh_token(user_id);

-- Seed a bootstrap admin (login_id: 'admin'; password rotated on first login).
-- password_hash below is a bcrypt of 'ChangeMe#2026' — force reset via must_reset_password.
INSERT INTO app_user (role, login_id, full_name, password_hash, must_reset_password)
VALUES ('ADMIN', 'admin', 'Bootstrap Admin',
        '$2a$10$Dow1p7Yy0m6b0m9m3rG0uu2m3Q1mQ2m3Q1mQ2m3Q1mQ2m3Q1mQ2', true);
```

> Regenerate the bootstrap bcrypt hash for your chosen seed password before shipping — do not trust the
> placeholder above. Every later schema change is a new `V<n>__description.sql`; never edit an applied one.

Map Postgres `ENUM` columns in JPA with `@JdbcTypeCode(SqlTypes.NAMED_ENUM)` and `@Enumerated(EnumType.STRING)`;
map `JSONB` columns with `@JdbcTypeCode(SqlTypes.JSON)`.

---

## 5. Security Model

### 5.1 Password login (all roles)
- Login is **`townshipCode` + `login_id` + password**. Login ids are unique only *within* a township,
  so the code names the namespace to resolve the id in. A `SUPER_ADMIN` omits it and is resolved in
  the tenantless platform namespace (`township_id IS NULL`) instead.
- `PasswordEncoder` = `BCryptPasswordEncoder(10)`.
- Accounts are **admin-provisioned only**; there is no public registration endpoint.
- `AppUserDetailsService` is deliberately **not** a Spring `UserDetailsService`. That contract
  resolves an account from a username alone, which no longer has a single answer — implementing it
  would mean either picking a township arbitrarily or querying across all of them, and both are the
  exact bug multi-tenancy exists to prevent. It exposes `loadById` only.

`AuthService.login(townshipCode, loginId, rawPassword)`:
1. Throttle on `(townshipCode, loginId)` — keying on the login id alone would let failures against
   one township's `A-101-1` lock out the unrelated account of the same name everywhere else.
2. Resolve the township by code (or the platform namespace when the code is absent), then the
   account within it; `401` if either is absent or the account is inactive.
3. `passwordEncoder.matches(...)`; `401` on mismatch. An unknown township code, a missing account
   and a wrong password are indistinguishable and all pay for one bcrypt comparison — otherwise the
   login form enumerates the platform's customer list.
4. **Then** check the township's status; `403 TOWNSHIP_INACTIVE` if it is not `ACTIVE`. Reached only
   with valid credentials in hand, so a specific answer discloses nothing — and returning "invalid
   credentials" to an entire suspended township sends every resident chasing a password problem
   they do not have.
5. Mint access JWT (claims: `sub=userId`, `role`, `loginId`, `tid`) + opaque refresh token (store
   SHA-256 in `refresh_token`).
6. Return `{ accessToken, refreshToken, mustResetPassword, role, townshipId, townshipCode, townshipName }`.

`AuthService.changePassword(userId, current, next)`: verify current, set new bcrypt hash, clear
`must_reset_password`, revoke existing refresh tokens.

### 5.2 JWT
`JwtService` signs HS256 with `app.jwt.secret`. `JwtAuthFilter` (OncePerRequestFilter) parses the bearer
token, reloads the account, and builds an `Authentication` with authority `ROLE_<role>`.

The `tid` (township) claim is **informational only** — it makes a captured token readable in a
support session. Authorization never trusts it: the filter takes the township from the reloaded row,
so a token cannot outlive a tenancy change. The filter also rejects the request with
`401 TOWNSHIP_INACTIVE` when the account's township is suspended or archived, which is what makes a
lifecycle change take effect on the very next request rather than when the TTL lapses.

### 5.3 Method-level RBAC (three-layer isolation)
`@EnableMethodSecurity` on `SecurityConfig`. Every privileged service method carries `@PreAuthorize`:

```java
@PreAuthorize("hasRole('SUPER_ADMIN')")                    // township lifecycle, platform accounts
@PreAuthorize("hasRole('ADMIN')")                          // admin-only provisioning, notifications
@PreAuthorize("hasRole('GUARD')")                          // logging visits, redeeming passes
@PreAuthorize("hasAnyRole('RESIDENT','SALES')")            // deciding visits, minting passes
```

**A `SUPER_ADMIN` is granted `ROLE_ADMIN` as well as `ROLE_SUPER_ADMIN`** (`AppUserDetails.getAuthorities`),
so it passes every `hasRole('ADMIN')` check — but only inside the township its `X-Township-Id` header
names. Widening forty-odd annotations by hand would have worked once; granting the authority means the
*next* admin endpoint somebody adds does not silently exclude the platform operator because they
copied an annotation that only listed `ADMIN`. It is deliberately not granted `GUARD`, `RESIDENT` or
`SALES`: those are the physical parties to a visit, and a platform operator standing in for them
would make the audit trail a fiction.

Layer 2 alone is not enough — **service methods also re-check ownership** (layer 3). Example: a resident can
only decide a visit whose `approver_id == currentUserId()`; otherwise `ForbiddenException` → `403`. A guard
hitting an admin endpoint gets `403` from `@PreAuthorize`. Negative RBAC tests are mandatory (see §12).

`SecurityConfig` HTTP rules:
```
/auth/login, /auth/refresh, /v3/api-docs/**, /swagger-ui/**   -> permitAll
/ws/**                                                        -> permitAll (authenticated at STOMP CONNECT)
/api/v1/super/**                                              -> hasRole('SUPER_ADMIN')
everything else                                              -> authenticated
```

The `/super/**` rule is redundant with `@PreAuthorize` on every method behind it, and that is the
point: a newly added endpoint under that prefix is closed by default rather than open until somebody
remembers the annotation.
Stateless sessions, CSRF disabled (token auth), CORS allowlist for the web/admin origin.

### 5.4 WebSocket auth
`StompAuthChannelInterceptor` validates the JWT on the STOMP `CONNECT` frame (bearer in the `Authorization`
native header), sets the `Principal`, and **rejects subscriptions to channels the principal doesn't own**
(a guard may only subscribe to their gate's topic; a user only to their own `/user/queue/**`).

It also refuses `CONNECT` when the principal's township is not `ACTIVE` — a socket outlives any
single request, so without that check a connection opened before a suspension would keep streaming
afterwards — and checks the *tenant*, not only the role, on `SUBSCRIBE`:

- `/topic/gate/{gateId}` — the gate is resolved within the subscriber's own township. Without this a
  guard in township A holding a perfectly valid token could watch township B's gate just by knowing
  its id. REST-layer tenant scoping does nothing for the broker.
- `/topic/admin/inside/{townshipId}` — must be the subscriber's own township (any, for a super admin).

### 5.5 Multi-tenancy — the township boundary

Three mechanisms, and each covers what the others cannot.

**1. `TenantContext` + `TenantContextFilter` — one decision, per request, from the principal.**
The filter runs after `JwtAuthFilter` and before the password-reset gate. For an ordinary account it
copies `app_user.township_id` into a `ThreadLocal`; a header naming a *different* township is
`403 TOWNSHIP_MISMATCH`, refused rather than ignored, because a client that sends it either has a bug
worth surfacing or is probing the boundary. For a `SUPER_ADMIN` it reads `X-Township-Id`, resolves it
against the `township` table, and rejects an archived one — so every service downstream can treat
`TenantContext.requireTownshipId()` as a real, existing, non-archived tenant. The context is cleared
in a `finally` block: request threads are pooled, and a leaked `ThreadLocal` hands the next request
the previous caller's tenant.

Why a `ThreadLocal` rather than a parameter, for the same reason `SecurityUtils` is one: threading a
`townshipId` through every signature guarantees that the one call site somebody forgets is a *silent
cross-tenant read*, whereas a missing context here is a loud `422 TOWNSHIP_CONTEXT_REQUIRED`.
`TenantContext.callAs` / `runAs` supply one explicitly for work with no request behind it — a super
admin provisioning a new township's first admin, or a test calling a service directly.

**2. Every query is anchored on the tenant.** Repository finders are `findByIdAndTownship_Id`, not
`findById`; listing specifications add the township predicate *first* and unconditionally, so no
combination of query parameters widens them. A row from another township resolves to a `404`, never a
`403` — across a tenant boundary "not yours" and "does not exist" must be the same answer, or the
endpoint is an existence oracle. Two lookups matter more than the rest:

- **Pass redemption** narrows by township before it bcrypt-compares a PIN or resolves a QR token.
  Six digits shared across a whole platform makes cross-township PIN collisions routine, not
  theoretical; this is both the security boundary and what keeps the candidate list small.
- **Audience resolution** anchors every mode, `ALL` included — the difference between "everyone here"
  and "everyone on the platform".

**3. The database is the backstop.** Composite `(id, township_id)` foreign keys pin a visit's gate,
guard, approver, flat and pass to the visit's own township; `super_admin_is_tenantless` makes
"SUPER_ADMIN ⟺ no township" an exact biconditional rather than a convention. A bug or a race cannot
persist a cross-tenant row independently of the application layer — the same reasoning the existing
`CHECK` constraints embody.

**Migrations.** `V2__super_admin_role.sql` adds the enum label and nothing else; `V3__multi_tenancy.sql`
does the rest. The split is required, not stylistic: PostgreSQL 12+ permits `ALTER TYPE … ADD VALUE`
inside a transaction but the new label cannot be *used* until that transaction commits, and Flyway
runs each migration in its own. Pre-existing rows are adopted into a `DEFAULT` township; on a fresh
install that is simply the first township, already usable.

**Bootstrap.** Two seeded accounts, because there are two levels of authority: `superadmin`
(tenantless, the account that creates townships) and `admin` (administrator of `DEFAULT`). Both are
inserted with the unusable `'!'` hash and given a real password at startup by
`BootstrapAdminInitializer`, from `GATECRASH_BOOTSTRAP_SUPER_ADMIN_PASSWORD` /
`GATECRASH_BOOTSTRAP_ADMIN_PASSWORD` or — in local/test only — a random one logged once.

---

## 6. Domain — Entities & Repositories

Entities mirror the DDL. Illustrative (Lombok, package `com.gatecrash.user`):

```java
@Entity @Table(name = "app_user")
@Getter @Setter @NoArgsConstructor
public class AppUser {
    @Id @GeneratedValue @UuidGenerator private UUID id;

    @Enumerated(EnumType.STRING) @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    @Column(columnDefinition = "user_role") private UserRole role;

    @Column(name = "login_id", nullable = false, unique = true) private String loginId;
    private String fullName;
    private String phone;
    private String email;
    @Column(nullable = false) private String passwordHash;
    private boolean mustResetPassword = true;
    private boolean active = true;

    // Column still named flat_id; it references property_node now. See V4.
    @ManyToOne(fetch = LAZY) @JoinColumn(name = "flat_id") private PropertyNode unit;
    private boolean onDuty = false;                 // SALES presence

    @ManyToOne(fetch = LAZY) @JoinColumn(name = "created_by") private AppUser createdBy;
    @CreationTimestamp private OffsetDateTime createdAt;
    @UpdateTimestamp   private OffsetDateTime updatedAt;
}
```

Enums (map 1:1 to Postgres enums): `UserRole{ADMIN,GUARD,RESIDENT,SALES}`, `VisitorType{GUEST,DELIVERY,MAINTENANCE,CLIENT}`,
`VisitStatus{PENDING,APPROVED,REJECTED,EXPIRED,CHECKED_IN,CHECKED_OUT}`, `ApproverKind{RESIDENT,SALES}`,
`PassStatus{ACTIVE,REDEEMED,EXPIRED,REVOKED}`, `NotifStatus{QUEUED,SENT,FAILED}`.

Key repository queries:
```java
// SALES dropdown for guards
List<AppUser> findByRoleAndOnDutyTrueAndActiveTrue(UserRole role);

// next per-unit login_id sequence (see UserProvisioningService)
long countByUnit_Id(UUID unitId);

// approver inbox
List<VisitorLog> findByApprover_IdAndStatus(UUID approverId, VisitStatus status);

// pass redemption
Optional<PreApproval> findByQrTokenAndStatus(UUID qrToken, PassStatus status);

// live occupancy
List<VisitorLog> findByStatus(VisitStatus status);   // CHECKED_IN

// device tokens for a user set
@Query("select d.fcmToken from Device d where d.user.id in :ids")
List<String> findTokensByUserIds(Collection<UUID> ids);
```

Pending-visit expiry uses a native, index-friendly update (see §10).

---

## 7. DTOs & Mapping

MapStruct mappers per feature (`VisitMapper`, `UserMapper`, …). Request DTOs are `record`s with Jakarta
validation; response DTOs never leak `passwordHash` or internal FKs beyond ids/labels.

```java
public record LoginRequest(@NotBlank String loginId, @NotBlank String password) {}
public record LoginResponse(String accessToken, String refreshToken, boolean mustResetPassword, UserRole role) {}

public record CreateUserRequest(
    @NotNull UserRole role,
    UUID flatId,                 // required for RESIDENT
    String loginId,              // required for SALES/GUARD/ADMIN; ignored for RESIDENT
    @NotBlank String fullName,
    String phone) {}
public record CreatedUserResponse(UUID id, String loginId, String generatedPassword) {} // password shown ONCE

public record CreateVisitRequest(
    @NotNull UUID gateId,
    @NotNull VisitorType visitorType,
    @NotBlank String visitorName,
    String visitorPhone, String vehicleNo, String photoUrl,
    UUID targetFlatId,           // resident routing
    UUID salesAgentId) {}        // sales routing (required when visitorType == CLIENT)

public record VisitDecisionRequest(@NotNull Decision decision) {}  // APPROVED | REJECTED

public record CreatePassRequest(
    @NotNull ApproverKind approverKind,
    String visitorName, String visitorPhone,
    @NotNull VisitorType visitorType,
    @NotNull @Future OffsetDateTime validUntil,
    @Min(1) int maxUses) {}
public record CreatePassResponse(UUID id, String pin, String qrToken, OffsetDateTime validUntil) {} // pin shown ONCE

public record CreateNotificationRequest(
    @NotBlank String title, @NotBlank String body, @NotNull AudienceRule audienceRule) {}
public record AudienceRule(
    @NotNull Mode mode, List<UserRole> roles, List<UUID> flatIds, List<UUID> blockIds) {
    public enum Mode { ALL, ALL_EXCEPT, ROLES, FLATS, BLOCKS }
}
```

---

## 8. Services — the load-bearing logic

### 8.1 `UserProvisioningService` (ADMIN)
`createUser(req)`:
1. `@PreAuthorize("hasRole('ADMIN')")`. The account lands in `TenantContext.requireTownshipId()`'s
   township — never in one named by the request body. Two roles are refused here and have their own
   paths: `ADMIN` needs `SUPER_ADMIN` (`403 ADMIN_REQUIRES_SUPER_ADMIN`), because an admin who could
   mint further admins would make the platform operator's control over the tenant advisory; and
   `SUPER_ADMIN` outright (`422 ROLE_NOT_PROVISIONABLE`), because it belongs to no township at all.
2. If `RESIDENT`: require `flatId`; resolve it as a node at the **unit level** (`requireUnit`, else
   `422 NOT_A_UNIT`); derive `login_id = unit.code + "-" + (countByUnit_Id(unitId)+1)`; then raise the
   unit's `declared_occupancy` to at least that account count, so occupancy never falls behind
   (e.g. `A-101-1`, then `A-101-2`) — unique within the township only. If `SALES/GUARD/ADMIN`: require
   the supplied `loginId`, ensure unique **within the township**. Phone and email uniqueness is
   likewise per township: a global check would leak across the boundary, since "that number is
   already registered" would be a true statement about a different customer's township.
3. **Generate password** — `PasswordGenerator.generate(app.password.generated-length)` (crypto-random,
   mixed case + digits, ambiguity-free alphabet). Store `bcrypt(password)`, `must_reset_password = true`,
   `created_by = currentUserId()`.
4. Persist; audit `USER_PROVISIONED`.
5. Return `CreatedUserResponse` with the **plaintext password once** (never stored, never logged, never
   returned again). `reset-password` follows the same generate-return-once path.

> Race safety on the per-flat sequence: `countByFlat_Id` under a `SELECT … FOR UPDATE` on the flat row, or a
> unique constraint on `login_id` with retry — the unique index is the backstop against a duplicated `-N`.

### 8.2 `VisitService`
`createVisit(req)` — `@PreAuthorize("hasRole('GUARD')")`, `@Transactional`:
1. Validate gate exists. Resolve routing:
   - `visitorType == CLIENT` → require `salesAgentId`, must be an on-duty SALES user; set `approverKind=SALES`,
     `approverId=salesAgentId`. (DB `CHECK client_routes_to_sales` is the backstop.)
   - else → require `targetFlatId`; pick that flat's resident account(s) as approver(s). Set
     `approverKind=RESIDENT`, `targetFlatId`, `approverId` = the flat's resident (if multiple, notify all
     flat residents but persist a primary `approver_id`; any flat resident may decide — see ownership check).
2. Persist `visitor_log` (`PENDING`), audit `VISIT_LOGGED`.
3. **Dual dispatch** (after commit, via `TransactionSynchronization` afterCommit):
   - `fcmService.push(approverTokens, PushPayload.visitRequested(visit))`
   - `realtimeService.toUser(approverId, "/queue/visits", VisitRequestedEvent)`
4. Return `visitId` + status; the guard's client subscribes to `/topic/gate/{gateId}`.

`decide(visitId, decision)` — `@PreAuthorize("hasAnyRole('RESIDENT','SALES')")`, `@Transactional`:
1. Load visit; `404` if missing.
2. **Ownership re-check:** caller must be the routed approver — for resident routing, caller's `flat_id`
   must equal `visit.targetFlatId`; for sales routing, `caller.id == visit.approverId`. Else `403`.
3. **FSM guard:** only `PENDING → APPROVED|REJECTED` allowed; anything else `409`.
4. Apply, stamp `decided_at`, audit `VISIT_APPROVED`/`VISIT_REJECTED`.
5. After commit: `realtimeService.toGate(gateId, VisitDecidedEvent)` (**flips guard screen**) + FCM fallback
   to the guard's devices.

`checkIn` / `checkOut` — GUARD only, FSM `APPROVED → CHECKED_IN → CHECKED_OUT`; on `CHECKED_IN`/`CHECKED_OUT`
publish occupancy delta to `/topic/admin/inside/{townshipId}`, with a count scoped to that township.

Every lookup above resolves by `(id, townshipId)` — the gate, the routed flat, the sales agent, the
visit itself — so an id from another township is a `404` before the ownership and FSM checks run.

### 8.3 `PassService`
`createPass(req)` — RESIDENT/SALES, `@Transactional`:
- Generate a random 6-digit PIN and a `qr_token` UUID. Store **`pin_hash = bcrypt(pin)`** (+ optional
  `pin_last4`), validity window, `max_uses`. Return `pin` and `qrToken` **once**.

`redeem(pinOrQr)` — `@PreAuthorize("hasRole('GUARD')")`, `@Transactional`:
1. Resolve pass: by `qrToken` (direct lookup) or by PIN (fetch candidate `ACTIVE` passes and
   `passwordEncoder.matches(pin, pin_hash)` — never query by plaintext PIN).
2. Validate: `status==ACTIVE`, `now within [valid_from, valid_until]`, `use_count < max_uses`. Else `409/410`.
3. Increment `use_count`; if it reaches `max_uses` → `status=REDEEMED`. Create a `visitor_log` directly in
   **`CHECKED_IN`** (zero-wait), link `pre_approval_id`, audit `PASS_REDEEMED`.
4. Informational FCM to the pass owner ("guest checked in"); occupancy update to admin.

`revoke(passId)` — owner only, `ACTIVE → REVOKED`.

### 8.4 `NotificationService` + `AudienceResolver` (ADMIN)
`AudienceResolver.resolve(rule) : List<UUID userIds>` — compiles the rule into one parameterized query:

| mode | predicate |
|------|-----------|
| `ALL` | `is_active` |
| `ALL_EXCEPT` | `role NOT IN (:roles)` |
| `ROLES` | `role IN (:roles)` |
| `FLATS` | `flat_id IN (:flatIds)` — unit ids |
| `BLOCKS` | everyone anywhere *beneath* the named nodes, via the materialized path: `EXISTS (SELECT 1 FROM property_node a WHERE a.id IN (:blockIds) AND unit.path LIKE a.path \|\| '%')`. Outgrew its name in V4 — name a tower and it reaches every flat in it, name a phase and it reaches the whole phase |

`send(req)`:
1. `resolve(rule)` → user ids. Persist `notification` (rule as JSONB) + one `notification_recipient` per user
   (audit + read tracking). Set `recipient_cnt`.
2. Fetch tokens (`findTokensByUserIds`), FCM **multicast in ≤500-token batches**; prune `UNREGISTERED`/invalid
   tokens from `device`. Mark `notification.status = SENT`, `sent_at`.

`preview(rule)` returns just `resolve(rule).size()` — the admin sees blast radius before sending (no writes).

### 8.5 `FcmService`
Wraps `FirebaseMessaging`. `push(tokens, payload)` builds **data messages** (not notification-only) so mobile
clients render actionable heads-up even when backgrounded. Batches with `sendEachForMulticast`; returns a
result whose failed tokens are pruned by the caller. All pushes are best-effort — **Postgres is the source of
truth**; clients reconcile via `GET /visits/pending` and `/notifications/mine`.

### 8.6 `RealtimeService`
Thin wrapper over `SimpMessagingTemplate`: `toGate(gateId, evt)` → `/topic/gate/{id}`;
`toUser(userId, dest, evt)` → `/user/{userId}/queue/...`; `toAdminInside(townshipId, evt)` →
`/topic/admin/inside/{townshipId}`. The tenant is in the destination rather than the payload: a single
shared topic would deliver every township's movements to every township's dashboard, and no
client-side filtering fixes that once the frame has left the server.

---

## 9. Controllers (thin)

One controller per feature; validates `@RequestBody`, delegates to the service, maps to DTO. Full endpoint
list is [ARCHITECTURE.md §2](ARCHITECTURE.md). Skeleton:

```java
@RestController @RequestMapping("/api/v1/visits") @RequiredArgsConstructor
public class VisitController {
    private final VisitService visits;

    @PostMapping                                   // GUARD
    public ResponseEntity<VisitResponse> create(@Valid @RequestBody CreateVisitRequest r) {
        return ResponseEntity.status(201).body(visits.createVisit(r));
    }

    @PatchMapping("/{id}/decision")                // RESIDENT/SALES
    public VisitResponse decide(@PathVariable UUID id, @Valid @RequestBody VisitDecisionRequest r) {
        return visits.decide(id, r.decision());
    }

    @PatchMapping("/{id}/check-in")  public VisitResponse checkIn(@PathVariable UUID id) { return visits.checkIn(id); }
    @PatchMapping("/{id}/check-out") public VisitResponse checkOut(@PathVariable UUID id){ return visits.checkOut(id); }
    @GetMapping("/pending")          public List<VisitResponse> myPending() { return visits.pendingForCurrentUser(); }
    @GetMapping("/gate/{gateId}")    public List<VisitResponse> byGate(@PathVariable UUID gateId){ return visits.recentForGate(gateId); }
    @GetMapping("/{id}")             public VisitResponse one(@PathVariable UUID id) { return visits.get(id); }
}
```

`@PreAuthorize` lives on the **service** methods (single enforcement point), not duplicated on controllers.

---

## 10. Real-time & Scheduled Jobs

### WebSocket config
```java
@Configuration @EnableWebSocketMessageBroker
class WebSocketConfig implements WebSocketMessageBrokerConfigurer {
    public void registerStompEndpoints(StompEndpointRegistry r) {
        r.addEndpoint("/ws").setAllowedOriginPatterns(allowed).withSockJS();
    }
    public void configureMessageBroker(MessageBrokerRegistry r) {
        r.enableSimpleBroker("/topic", "/queue");
        r.setApplicationDestinationPrefixes("/app");
        r.setUserDestinationPrefix("/user");
    }
    public void configureClientInboundChannel(ChannelRegistration reg) {
        reg.interceptors(stompAuthChannelInterceptor);   // §5.4
    }
}
```
Single-node simple broker for Phase 1; swap to an external STOMP relay (or Redis pub/sub bridge) when the
backend scales horizontally.

### Scheduled jobs (ShedLock, `SchedulingConfig` with `@EnableSchedulerLock`)
```java
@Scheduled(cron = "0 * * * * *")   // every minute
@SchedulerLock(name = "expirePendingVisits", lockAtMostFor = "PT2M")
void expirePendingVisits() {
    // native update: PENDING older than pending-ttl -> EXPIRED, returning ids
    List<ExpiredVisit> expired = visitRepo.expireOlderThan(now().minusMinutes(ttl));
    expired.forEach(v -> realtime.toGate(v.gateId(), VisitExpiredEvent.of(v))); // unstick guard screen
}

@Scheduled(cron = "0 */5 * * * *")
@SchedulerLock(name = "expirePasses", lockAtMostFor = "PT4M")
void expirePasses() { passRepo.markExpired(now()); }   // ACTIVE past valid_until -> EXPIRED
```
Jobs are **idempotent** and safe under multi-instance deploys (ShedLock ensures one leader runs each tick).

---

## 11. Validation & Error Handling

- Bean Validation on every request DTO (`@Valid`); violations → `400` with field errors.
- Domain rules in services throw typed exceptions mapped by `GlobalExceptionHandler`:
  - `NotFoundException` → `404`; `ForbiddenException` → `403`; `ConflictException` (illegal FSM / pass
    reuse / duplicate `login_id`) → `409`; `ValidationException` (unknown/oversized input) → `422`;
    `AuthenticationException` → `401`.
- Standard body: `ApiError{ timestamp, status, error, message, path, fieldErrors[] }`.
- **Business invariants** (also DB-constrained): `CLIENT` visits must route to SALES; visit FSM transitions;
  pass `use_count ≤ max_uses` and validity window; per-flat `login_id` uniqueness. The DB `CHECK`/`UNIQUE`
  constraints are the backstop so a bug or race can never persist an invalid row.

---

## 12. Testing Strategy

Testcontainers Postgres (real schema via Flyway) for all integration tests. Layers:

1. **RBAC negative tests (mandatory):** with `@WithMockUser(roles="GUARD")`, hitting `POST /admin/users`,
   `POST /notifications`, `PATCH /visits/{id}/decision` → `403`. Repeat for each role × each forbidden route.
2. **Auth:** login success/failure, `must_reset_password` flag, forced password change revokes refresh tokens,
   refresh rotation.
3. **User provisioning:** resident `login_id` sequence (`A-101-1`, `A-101-2`) incl. concurrent-create race →
   unique constraint holds; generated password logs in exactly once; `reset-password` invalidates the old one.
4. **Visit FSM:** every legal transition passes; every illegal one → `409`. Ownership: a resident of a
   *different* flat deciding a visit → `403`. `CLIENT` without `salesAgentId` → `422`.
5. **End-to-end approval loop:** WS test client (`WebSocketStompClient`) subscribes to `/topic/gate/{id}`;
   guard posts a visit; approver `PATCH …/decision`; assert the `VISIT_DECIDED` frame arrives. FCM mocked.
6. **Pass redemption:** PIN matches by hash (never plaintext query); expired/over-used pass → `409/410`;
   redemption creates a `CHECKED_IN` visit and increments `use_count`.
7. **Audience resolver:** each `Mode` resolves the exact expected user set on a seeded township;
   `preview` count matches `send` recipient count.
8. **Scheduled jobs:** seed a stale `PENDING` visit → `expirePendingVisits` flips it and emits the WS event;
   ShedLock prevents double-run across two app contexts.
9. **Negative tenancy matrix (mandatory, `MultiTenancyTest`):** the multi-tenant counterpart to (1).
   Every case holds a *valid* token for a *real* account with the *right* role and is refused anyway,
   because the row it reaches for belongs to another township — which is the point: the role checks
   pass in all of them, so if the tenant boundary is not enforced independently, every one succeeds.
   Two townships are stood up with deliberately identical structure (same block name, same flat
   number, therefore the same derived resident login id), because the collisions tenancy has to
   survive are exactly the ones a single-tenant schema made impossible. Covers: login ids that do not
   cross; an unknown township code indistinguishable from a wrong password; a tenant header refused
   for an ordinary account; user/flat/gate/visit lookups answering `404`; a pass that will not redeem
   at another township's gate; an `ALL` broadcast and a community feed that stop at the boundary.
10. **Tenancy constraints (`TenancyConstraintsTest`):** layer 3 tested where it lives. Every
    statement goes through raw JDBC, deliberately bypassing Hibernate, the services and the security
    chain — which is the point: the service layer already scopes every query and (9) proves it, so
    what these assert is what happens when that layer is *wrong*. A visit borrowing another
    township's gate, flat or approver; a `SUPER_ADMIN` with a township or a `GUARD` without one; a
    duplicate login id within a township (and the same one legal across two); a malformed township
    code; an archived township with no timestamp. If any of these were writable, tenant isolation
    would be a convention rather than a guarantee.
11. **Platform lifecycle (`SuperAdminTest`):** onboarding returns a working admin credential;
    archiving requires the township's own code, kills a live token on the *next* request, and
    `restore` finds everything intact; a suspended township stays reachable by the operator; the last
    township admin and the last super admin cannot be removed; no township role reaches `/super/**`;
    a `SUPER_ADMIN` cannot be minted through a township endpoint.

Target: services + resolvers ~90% line coverage; controllers covered via slice/e2e tests.

---

## 13. Build Order (matches ARCHITECTURE.md §4 roadmap)

Phase 0 scaffold → 1 identity/RBAC + admin provisioning → 2 township + sales duty → 3 visit core →
4 real-time (WS + jobs) → 5 passes → 6 notifications + community → 9a multi-tenancy + the platform role
→ then hand off to the web/admin and mobile tracks. Each phase ships with its migration, service tests,
and the RBAC **and tenancy** negative tests green before moving on.

---

## Guardrails (do not violate)

- Never expose `passwordHash`, generated passwords (beyond the one-time create response), PIN plaintext, or
  raw refresh tokens over HTTP or in logs.
- Never trust the client for authorization — `@PreAuthorize` **and** service-layer ownership re-checks.
- Every state transition is FSM-guarded, DB-constrained, and written to `audit_log`.
- All push/WS delivery is best-effort; **Postgres is authoritative** and clients reconcile on foreground.
- Every schema change is a new Flyway migration; `ddl-auto: validate`, never auto-DDL.
- **The acting township comes from `TenantContext`, never from a request body, path variable or query
  parameter.** A `townshipId` argument on a service method is the beginning of a cross-tenant bug; if
  one is genuinely needed for out-of-request work, borrow the context with `TenantContext.callAs`.
- **Every repository finder is anchored on the tenant.** A bare `findById` in a service that serves an
  HTTP request is a bug, even when it looks safe — the id came from a URL. Resolve `(id, townshipId)`
  and let another township's id be a `404`, never a `403`.
- **Never widen `@PreAuthorize` to reach across townships.** Role and tenant are independent
  questions; a `SUPER_ADMIN` gets its breadth from the `ROLE_ADMIN` authority plus an explicit
  `X-Township-Id`, not from an annotation that skips the boundary.
- **Nomenclature is never load-bearing.** A level's `singular`/`plural` are display strings; every
  decision in code branches on `PropertyNodeKind` instead. The moment a query matches on a label,
  renaming "Flat" to "Villa" in the console silently changes which rows it returns.
- **`depth`, `path` and `is_unit` on `property_node` are derived by database trigger, never set from
  Java.** They are mapped `insertable = false, updatable = false`. A hand-maintained path that drifts
  does not fail loudly — it silently sends a notification to the wrong tower.
- **Residents and visits attach to the unit level only.** Resolve with `requireUnit`, not
  `requireNode`. The composite `(id, township_id, is_unit)` foreign key is the backstop, but a `422`
  naming the problem beats a foreign-key violation surfacing as a `500`.
- **Occupancy is a unit-level fact.** A building's occupancy is the sum of its units and is never
  stored; `declared_occupancy` is people (including those with no login), not accounts, and may
  never sit below the unit's active resident account count.
- **A township is archived, never deleted.** No cascade, no purge endpoint, no cleanup job: the
  visitor log and audit trail are the record of who was let through a gate and who authorised it.
