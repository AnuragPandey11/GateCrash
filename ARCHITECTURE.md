# GateCrash — Township Management ERP

**Phase 1 Technical Implementation Plan**
Scope: Advanced Visitor Management + Targeted Notifications for an under-construction township.

- **Backend:** Java 21 · Spring Boot 3.x
- **Admin Web:** React
- **Mobile (Guard / Sales / Resident):** React Native
- **Database:** PostgreSQL 15+
- **Real-time & Push:** Firebase Cloud Messaging (FCM) + WebSocket (STOMP over STOMP/SockJS)

Build order: **Backend → Admin Web → Mobile apps.**

---

## 0. Domain Model at a Glance

Actors and their surfaces:

| Role     | Surface            | Core actions |
|----------|--------------------|--------------|
| `ADMIN`  | Web dashboard      | Live "inside township" feed, broadcast targeted notifications, post community updates, manage users/gates |
| `GUARD`  | Tablet at gate     | Log walk-ins, route approval to resident/sales, verify PIN/QR, see live approve/reject result |
| `RESIDENT`| Mobile app        | Approve/reject walk-ins, generate visitor passes (PIN/QR), read community feed |
| `SALES`  | Mobile app         | Toggle on/off duty, approve/reject client site-visits, generate passes, read community feed |

Two load-bearing entities drive everything:
- **`visitor_log`** — one row per physical arrival at the gate (walk-in *or* pass redemption). It carries the live approval state the Guard screen watches.
- **`pre_approval`** — a time-bound PIN/QR pass minted by a resident/sales agent *before* the visitor arrives.

---

## 1. Database Schema (PostgreSQL)

Conventions: `snake_case`, UUID primary keys (`gen_random_uuid()` via `pgcrypto`), `timestamptz` everywhere, all state machines backed by `CHECK` constraints. Enums are Postgres `ENUM` types for integrity + index-friendliness.

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------- Enum types ----------
CREATE TYPE user_role       AS ENUM ('ADMIN', 'GUARD', 'RESIDENT', 'SALES');
CREATE TYPE visitor_type    AS ENUM ('GUEST', 'DELIVERY', 'MAINTENANCE', 'CLIENT');
CREATE TYPE visit_status    AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CHECKED_IN', 'CHECKED_OUT');
CREATE TYPE approver_kind   AS ENUM ('RESIDENT', 'SALES');       -- who a visit is routed to
CREATE TYPE pass_status     AS ENUM ('ACTIVE', 'REDEEMED', 'EXPIRED', 'REVOKED');
CREATE TYPE notif_status    AS ENUM ('QUEUED', 'SENT', 'FAILED');

-- ---------- Township structure ----------
CREATE TABLE building_block (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,                     -- "Block A", "Tower 3"
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (name)
);

CREATE TABLE flat (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    block_id    UUID NOT NULL REFERENCES building_block(id),
    number      TEXT NOT NULL,                     -- "A-101"
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (block_id, number)
);

CREATE TABLE gate (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,                     -- "Main Gate", "Service Gate"
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Identity ----------
-- All accounts are admin-provisioned; the system auto-generates the password (no self-signup, no OTP).
-- login_id is the credential the user types:
--   RESIDENT -> flat/plot number + per-flat sequence, e.g. "A-101-1", "A-101-2"
--              (a flat can have multiple resident accounts)
--   SALES / GUARD / ADMIN -> an admin-assigned code (employee code or phone)
CREATE TABLE app_user (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role                 user_role NOT NULL,
    login_id             TEXT NOT NULL UNIQUE,      -- what the user enters to log in
    full_name            TEXT NOT NULL,
    phone                TEXT UNIQUE,               -- contact / optional
    email                TEXT UNIQUE,
    password_hash        TEXT NOT NULL,             -- bcrypt; set by admin at creation
    must_reset_password  BOOLEAN NOT NULL DEFAULT true,  -- force change after first login
    is_active            BOOLEAN NOT NULL DEFAULT true,
    created_by           UUID REFERENCES app_user(id),   -- the admin who provisioned this account
    -- residents only:
    flat_id              UUID REFERENCES flat(id),
    -- sales only: on/off-duty presence for the Guard dropdown
    is_on_duty           BOOLEAN NOT NULL DEFAULT false,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- residents must map to a flat, and by convention login_id = that flat's number
    CONSTRAINT resident_needs_flat CHECK (role <> 'RESIDENT' OR flat_id IS NOT NULL)
);
CREATE INDEX idx_user_role           ON app_user(role);
CREATE INDEX idx_user_flat           ON app_user(flat_id);
CREATE INDEX idx_sales_on_duty       ON app_user(role) WHERE role = 'SALES' AND is_on_duty = true;

-- ---------- Devices / FCM tokens (one user → many devices) ----------
CREATE TABLE device (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    fcm_token     TEXT NOT NULL UNIQUE,
    platform      TEXT NOT NULL,                   -- 'ANDROID' | 'IOS' | 'WEB'
    last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_device_user ON device(user_id);

-- ---------- Pre-approvals (PIN / QR passes) ----------
CREATE TABLE pre_approval (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_by       UUID NOT NULL REFERENCES app_user(id),   -- resident or sales
    approver_kind    approver_kind NOT NULL,
    visitor_name     TEXT,
    visitor_phone    TEXT,
    visitor_type     visitor_type NOT NULL DEFAULT 'GUEST',
    pin_hash         TEXT NOT NULL,                -- HMAC/bcrypt of the 6-digit PIN, never plaintext
    pin_last4        TEXT,                         -- optional display hint
    qr_token         UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,  -- encoded in QR
    status           pass_status NOT NULL DEFAULT 'ACTIVE',
    valid_from       TIMESTAMPTZ NOT NULL DEFAULT now(),
    valid_until      TIMESTAMPTZ NOT NULL,
    max_uses         INT NOT NULL DEFAULT 1,
    use_count        INT NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT valid_window CHECK (valid_until > valid_from),
    CONSTRAINT uses_ok      CHECK (use_count <= max_uses)
);
CREATE INDEX idx_pass_creator ON pre_approval(created_by);
CREATE INDEX idx_pass_active  ON pre_approval(status, valid_until);

-- ---------- Visitor log (the live gate event) ----------
CREATE TABLE visitor_log (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gate_id          UUID NOT NULL REFERENCES gate(id),
    logged_by        UUID NOT NULL REFERENCES app_user(id),    -- the guard
    visitor_name     TEXT NOT NULL,
    visitor_phone    TEXT,
    visitor_type     visitor_type NOT NULL,
    photo_url        TEXT,                          -- optional gate snapshot (S3)
    vehicle_no       TEXT,

    -- routing target: the resident OR sales agent who must decide
    approver_id      UUID REFERENCES app_user(id),
    approver_kind    approver_kind,
    target_flat_id   UUID REFERENCES flat(id),      -- denormalized for resident routing

    -- if this arose from a pass redemption:
    pre_approval_id  UUID REFERENCES pre_approval(id),

    status           visit_status NOT NULL DEFAULT 'PENDING',
    decided_at       TIMESTAMPTZ,
    checked_in_at    TIMESTAMPTZ,
    checked_out_at   TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT client_routes_to_sales
        CHECK (visitor_type <> 'CLIENT' OR approver_kind = 'SALES')
);
CREATE INDEX idx_visit_approver_pending ON visitor_log(approver_id, status);
CREATE INDEX idx_visit_gate             ON visitor_log(gate_id, created_at DESC);
CREATE INDEX idx_visit_inside           ON visitor_log(status) WHERE status = 'CHECKED_IN';

-- ---------- Community feed ----------
CREATE TABLE community_post (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id   UUID NOT NULL REFERENCES app_user(id),   -- admin
    title       TEXT NOT NULL,
    body        TEXT NOT NULL,
    image_url   TEXT,
    is_pinned   BOOLEAN NOT NULL DEFAULT false,
    published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_post_published ON community_post(published_at DESC);

-- ---------- Targeted notifications ----------
-- The admin's audience filter is stored as a JSONB rule; the fan-out to
-- individual users is materialized in notification_recipient for auditing.
CREATE TABLE notification (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id     UUID NOT NULL REFERENCES app_user(id),
    title         TEXT NOT NULL,
    body          TEXT NOT NULL,
    -- audience rule, e.g.
    --   {"mode":"ALL"}
    --   {"mode":"ALL_EXCEPT","roles":["GUARD"]}
    --   {"mode":"ROLES","roles":["SALES"]}
    --   {"mode":"FLATS","flatIds":["...","..."]}
    --   {"mode":"BLOCKS","blockIds":["..."]}
    audience_rule JSONB NOT NULL,
    status        notif_status NOT NULL DEFAULT 'QUEUED',
    recipient_cnt INT NOT NULL DEFAULT 0,
    sent_at       TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notification_recipient (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    notification_id  UUID NOT NULL REFERENCES notification(id) ON DELETE CASCADE,
    user_id          UUID NOT NULL REFERENCES app_user(id),
    delivered        BOOLEAN NOT NULL DEFAULT false,
    read_at          TIMESTAMPTZ,
    UNIQUE (notification_id, user_id)
);
CREATE INDEX idx_notif_recipient_user ON notification_recipient(user_id, read_at);

-- ---------- Audit trail ----------
CREATE TABLE audit_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id    UUID REFERENCES app_user(id),
    action      TEXT NOT NULL,                  -- 'VISIT_APPROVED', 'PASS_REVOKED', ...
    entity      TEXT NOT NULL,
    entity_id   UUID,
    detail      JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_entity ON audit_log(entity, entity_id);
```

### Relationship summary

- `building_block 1─* flat 1─* app_user(RESIDENT)`
- `app_user 1─* device` (FCM tokens; multi-device)
- `app_user(RESIDENT|SALES) 1─* pre_approval`
- `visitor_log *─1 gate`, `*─1 app_user(logged_by=guard)`, `*─0..1 app_user(approver)`, `*─0..1 pre_approval`
- `notification 1─* notification_recipient *─1 app_user`

### State machines (enforced in service + `CHECK`/transition guards)

- **Visit:** `PENDING → {APPROVED | REJECTED | EXPIRED}`; `APPROVED → CHECKED_IN → CHECKED_OUT`. Pass redemptions may skip straight to `CHECKED_IN`.
- **Pass:** `ACTIVE → {REDEEMED | EXPIRED | REVOKED}`.

Illegal transitions return `409`; every transition writes an `audit_log` row.

---

## 2. API Endpoint Design (REST)

Base path `/api/v1`. JWT bearer auth; role encoded in token claims + `@PreAuthorize` on every method. `kebab-case` URLs, `camelCase` JSON, DTOs only (never expose JPA entities).

### Auth & devices
All roles authenticate with **`login_id` + password** (no OTP, no self-signup). Residents type their **flat/plot number**; sales/guard/admin type their admin-assigned code.
| Method | Path | Role | Purpose |
|--------|------|------|---------|
| POST | `/auth/login` | public | `{ loginId, password }` → JWT (access + refresh). Response flags `mustResetPassword` |
| POST | `/auth/password` | any | Change own password (clears `must_reset_password`) |
| POST | `/auth/refresh` | any | Rotate access token |
| POST | `/devices` | any | Register/refresh this device's FCM token |
| DELETE | `/devices/{id}` | any | De-register on logout |

### Sales duty (drives the Guard dropdown)
| Method | Path | Role | Purpose |
|--------|------|------|---------|
| PATCH | `/sales/me/duty` | SALES | `{ "onDuty": true }` toggle presence |
| GET | `/sales/on-duty` | GUARD | Live list of on-duty sales agents for the dropdown |

### Visitor management (walk-ins)
| Method | Path | Role | Purpose |
|--------|------|------|---------|
| POST | `/visits` | GUARD | Log a walk-in → routes to resident (by flat) or sales agent; fires FCM + creates PENDING |
| GET | `/visits/{id}` | GUARD, approver | Poll/fetch a single visit (fallback if WS drops) |
| PATCH | `/visits/{id}/decision` | RESIDENT, SALES | `{ "decision": "APPROVED" \| "REJECTED" }` — the approve/reject tap |
| PATCH | `/visits/{id}/check-in` | GUARD | Mark physical entry |
| PATCH | `/visits/{id}/check-out` | GUARD | Mark exit |
| GET | `/visits/pending` | RESIDENT, SALES | Approver's open requests |
| GET | `/visits/gate/{gateId}` | GUARD | Recent activity at a gate |

### Pre-approvals (passes)
| Method | Path | Role | Purpose |
|--------|------|------|---------|
| POST | `/passes` | RESIDENT, SALES | Mint a time-bound pass → returns 6-digit PIN (once) + QR token |
| GET | `/passes/mine` | RESIDENT, SALES | List my active/expired passes |
| POST | `/passes/redeem` | GUARD | `{ "pin": "123456" }` or `{ "qrToken": "..." }` → validates, creates CHECKED_IN visit |
| DELETE | `/passes/{id}` | owner | Revoke a pass |

### Community feed
| Method | Path | Role | Purpose |
|--------|------|------|---------|
| POST | `/community/posts` | ADMIN | Publish a milestone/announcement |
| GET | `/community/posts` | any (non-guard) | Paginated feed |
| DELETE | `/community/posts/{id}` | ADMIN | Remove a post |

### Targeted notifications
| Method | Path | Role | Purpose |
|--------|------|------|---------|
| POST | `/notifications` | ADMIN | Submit `{title, body, audienceRule}` → resolves tokens & dispatches |
| GET | `/notifications` | ADMIN | Sent history + recipient counts |
| GET | `/notifications/mine` | any | Recipient's inbox |
| PATCH | `/notifications/mine/{id}/read` | any | Mark read |
| POST | `/notifications/preview` | ADMIN | Dry-run: returns resolved recipient count for a rule (no send) |

### Admin ops
| Method | Path | Role | Purpose |
|--------|------|------|---------|
| GET | `/admin/inside` | ADMIN | Live "who's inside" (visits where status = CHECKED_IN) |
| GET | `/admin/visits` | ADMIN | Filterable visitor log export |
| POST | `/admin/users` | ADMIN | **Provision an account.** For residents: `{role:"RESIDENT", flatId, fullName}` → server assigns the next per-flat `login_id` (`A-101-1`, `A-101-2`, …); for sales/guard: `{role, loginId, fullName}`. Server **auto-generates the password** and **returns it once** for the admin to hand over |
| POST | `/admin/users/{id}/reset-password` | ADMIN | Auto-generate a new password, return it once, set `must_reset_password=true` |
| GET/PATCH/DELETE | `/admin/users`, `/admin/users/{id}` | ADMIN | List / edit / deactivate accounts |
| CRUD | `/admin/blocks`, `/admin/flats`, `/admin/gates` | ADMIN | Township structure |

### WebSocket (STOMP) channels
- Connect: `/ws` (SockJS fallback), JWT in CONNECT header.
- Guard subscribes to their gate: `/topic/gate/{gateId}` — receives `VISIT_DECIDED` events.
- Approver subscribes to `/user/queue/visits` — receives `VISIT_REQUESTED` (belt-and-suspenders alongside FCM).
- Admin subscribes to `/topic/admin/inside` — live occupancy updates.

---

## 3. Real-Time Architecture Flow

FCM handles **wake-up / background delivery** (get the phone to buzz even when the app is closed). WebSocket handles **live in-app state** (instantly flip the Guard's screen). They are complementary, not redundant.

### The walk-in approval loop, step by step

```
GUARD app            Backend (Spring)                 RESIDENT/SALES app
   │                       │                                  │
 1 │ POST /visits ────────▶│                                  │
   │                       │ 2 validate + persist visitor_log │
   │                       │    (status=PENDING), audit       │
   │                       │ 3 resolve target device tokens   │
   │◀── 201 {visitId} ─────│                                  │
   │  (Guard shows         │ 4 FCM push ─────────────────────▶│  buzz (data msg,
   │   "Waiting…" spinner)  │ 4b WS /user/queue/visits ───────▶│   even if backgrounded)
   │                       │                                  │
   │  subscribes           │                                  │ 5 user taps Approve/Reject
   │  /topic/gate/{gateId} │                                  │
   │                       │◀──── PATCH /visits/{id}/decision─│ 6
   │                       │ 7 guard FSM transition           │
   │                       │    PENDING→APPROVED, decided_at, │
   │                       │    audit_log                     │
   │◀─ WS VISIT_DECIDED ───│ 8 publish to /topic/gate/{gate}  │
   │  screen flips green    │    + FCM to guard (fallback)     │
   │  instantly            │                                  │
 9 │ PATCH /check-in ─────▶│  status→CHECKED_IN               │
   │                       │  WS /topic/admin/inside update   │
```

**Detailed sequence:**

1. **Guard submits.** `POST /visits` with visitor details + chosen target (resident flat, or a sales agent picked from `GET /sales/on-duty`). For `CLIENT` type the target must be `SALES` (DB `CHECK` enforces it).
2. **Persist.** Service creates `visitor_log` (`PENDING`) in a `@Transactional` method, writes `audit_log`.
3. **Resolve tokens.** Look up the approver's `device` rows → FCM token list.
4. **Dual dispatch.**
   - **FCM data message** to every token — payload `{type:"VISIT_REQUESTED", visitId, visitorName, visitorType, gateName}`. Data (not notification-only) so the app can render a custom actionable heads-up even when killed.
   - **WebSocket** message to `/user/queue/visits` if that user has a live session — instant in-app card.
5. **Guard waits.** Guard's app subscribed to `/topic/gate/{gateId}`; shows a pending spinner. No polling needed.
6. **Approver decides.** Tap fires `PATCH /visits/{id}/decision`.
7. **Guarded transition.** Service validates the caller *is* the routed approver (ownership re-check), applies FSM `PENDING → APPROVED/REJECTED`, stamps `decided_at`, writes audit.
8. **Push result to Guard.** Broadcast `VISIT_DECIDED` on `/topic/gate/{gateId}` → the Guard tablet flips to green/red **in milliseconds**. FCM to the guard device is sent as a fallback in case the WS session dropped.
9. **Check-in / occupancy.** Guard taps check-in → `CHECKED_IN`; an event on `/topic/admin/inside` updates the Admin's live occupancy feed.

### Pass-redemption fast path (no approval ping)
Guard calls `POST /passes/redeem` with PIN or QR token → service verifies hash, window, and `use_count < max_uses`, increments use, creates a `visitor_log` directly in `CHECKED_IN`. Zero-wait entry; the pass owner optionally gets an informational FCM ("Your guest checked in").

### Reliability details
- **Delivery guarantee:** FCM is best-effort; the authoritative state always lives in Postgres. The approver app also has `GET /visits/pending` to reconcile on foreground.
- **Expiry sweep:** a ShedLock-guarded scheduled job flips stale `PENDING` visits to `EXPIRED` (e.g. 10-min TTL) and `ACTIVE` passes past `valid_until` to `EXPIRED`, emitting WS/FCM so the Guard screen doesn't hang.
- **Token hygiene:** FCM `UNREGISTERED`/`InvalidToken` responses prune the offending `device` row.
- **WS auth:** JWT validated on STOMP `CONNECT`; a channel interceptor rejects subscribes to gates/queues the principal doesn't own.

### Notification fan-out (targeting engine)
`POST /notifications` with an `audienceRule` JSONB. The service compiles the rule into a single parameterized SQL query against `app_user` (+ `flat`/`building_block` joins), e.g.:
- `ALL` → all active users
- `ALL_EXCEPT roles:[GUARD]` → `WHERE role NOT IN (:excluded)`
- `ROLES:[SALES]` → `WHERE role IN (:roles)`
- `FLATS:[...]` / `BLOCKS:[...]` → join on flat/block ids

The resolved user set is materialized into `notification_recipient` (audit + read tracking), then their `device` tokens are batched to FCM (multicast, ≤500/batch). `POST /notifications/preview` runs the same resolver and returns just the count so the admin sees the blast radius before sending.

---

## 4. Step-by-Step Implementation Roadmap

### Phase 0 — Foundations (backend scaffold)
1. Spring Boot 3 / Java 21 project, Gradle/Maven, `docker-compose` for Postgres.
2. Flyway `V1__init.sql` with the schema above; `ddl-auto: validate`.
3. Global exception handler, DTO/entity mapping (MapStruct), base audit interceptor.
4. Config profiles (`local`/`prod`), secrets via env.

### Phase 1 — Identity & RBAC
5. `app_user`, roles, password login (`login_id` + password), JWT issue/refresh, forced first-login password reset.
6. Admin user-provisioning (generate account + password, return once) — the *only* way accounts are created.
7. `@PreAuthorize` scaffolding + method-security tests proving a Guard hitting an admin endpoint gets `403`.
8. Device registration endpoints + FCM SDK wiring (`firebase-admin`).

### Phase 2 — Township & sales presence
8. CRUD for blocks/flats/gates/users (admin).
9. Sales duty toggle + `GET /sales/on-duty` (the Guard dropdown source).

### Phase 3 — Visitor management core
10. `visitor_log` CRUD, `POST /visits` with routing rules (client→sales `CHECK`).
11. Visit FSM service + ownership re-checks + audit.
12. FCM dispatch service (token resolution, multicast, token pruning).

### Phase 4 — Real-time layer
13. WebSocket/STOMP config, JWT-authenticated `CONNECT`, channel interceptors.
14. Wire `VISIT_REQUESTED` / `VISIT_DECIDED` / occupancy events end-to-end.
15. Scheduled expiry sweep (ShedLock).

### Phase 5 — Pre-approvals
16. Pass minting (hashed PIN, QR token, validity window, max-uses).
17. `POST /passes/redeem` fast path → direct `CHECKED_IN`.

### Phase 6 — Notifications & community
18. Audience-rule resolver + `preview` + fan-out to `notification_recipient`.
19. Community posts CRUD + feed.
20. Inbox endpoints + read tracking.

### Phase 7 — Admin web (React)
21. Auth + shell, live "who's inside" (WS), visitor log table.
22. Notification composer with checklist-style targeting UI + preview count.
23. Community post editor, user/township management.

### Phase 8 — Mobile apps (React Native)
24. Shared auth + FCM registration + WS client module.
25. **Resident:** pending approvals, approve/reject, pass generator (+ WhatsApp share), community feed.
26. **Sales:** duty toggle, client approvals, passes, feed.
27. **Guard:** high-contrast gate UI — visitor-type picker, resident/sales dropdown, PIN/QR entry, live result screen.

### Phase 9 — Hardening & integration testing
28. E2E test of the full approval loop (Testcontainers Postgres + WS test client + mocked FCM).
29. Load test the notification fan-out and gate throughput.
30. Token-pruning, expiry-sweep, and RBAC negative tests; observability (structured logs, metrics on push delivery).

---

## Key design decisions (rationale)

- **FCM + WebSocket split** — FCM wakes a backgrounded phone; WS gives the Guard sub-second screen updates without polling. Postgres is the single source of truth both reconcile against.
- **Audience rule as JSONB, recipients materialized** — flexible checklist targeting without schema churn, while `notification_recipient` still gives per-user audit and read receipts.
- **PIN stored hashed, QR as opaque UUID token** — a leaked DB never yields usable passes; redemption verifies against the hash.
- **Sales on-duty as a partial-indexed flag** — the Guard dropdown is a hot, tiny query.
- **Every state transition audited + FSM-guarded** — visitor security demands a defensible trail.
