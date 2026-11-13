# GateCrash — Township Management ERP

**Phase 1 Technical Implementation Plan**
Scope: Advanced Visitor Management + Targeted Notifications, delivered as a **multi-tenant
platform** — one deployment, many townships, each fully isolated from the others.

- **Backend:** Java 21 · Spring Boot 3.x
- **Admin Web:** React
- **Mobile (Guard / Sales / Resident):** React Native
- **Database:** PostgreSQL 15+
- **Real-time & Push:** Firebase Cloud Messaging (FCM) + WebSocket (STOMP over STOMP/SockJS)

Build order: **Backend → Admin Web → Mobile apps.**

---

## 0. Domain Model at a Glance

Actors and their surfaces:

| Role     | Surface            | Tenancy | Core actions |
|----------|--------------------|---------|--------------|
| `SUPER_ADMIN` | Web console   | **None** — platform-wide | Create / suspend / archive / restore townships, appoint and remove their admins, manage peer super admins. Carries `ADMIN` authority into any township it names |
| `ADMIN`  | Web dashboard      | One township | Live "inside township" feed, broadcast targeted notifications, post community updates, manage users/gates |
| `GUARD`  | Tablet at gate     | One township | Log walk-ins, route approval to resident/sales, verify PIN/QR, see live approve/reject result |
| `RESIDENT`| Mobile app        | One township | Approve/reject walk-ins, generate visitor passes (PIN/QR), read community feed |
| *Sales team* (flag) | Mobile app | One township | Not a role: an `ADMIN` or `GUARD` with `is_sales` (V6). Toggle on/off duty, approve/reject "Meet Sales Agent" visitors, generate passes, read community feed |

Two load-bearing entities drive everything:
- **`visitor_log`** — one row per physical arrival at the gate (walk-in *or* pass redemption). It carries the live approval state the Guard screen watches.
- **`pre_approval`** — a time-bound PIN/QR pass minted by a resident/sales agent *before* the visitor arrives.

### Tenancy: the township is the boundary

Every operational row in the system belongs to exactly one **township**, and `SUPER_ADMIN` is the
only role that belongs to none. Three consequences shape the rest of this document:

1. **Login is `(townshipCode, loginId, password)`.** Login ids are unique *within* a township only —
   every township with a block A mints an `A-101-1` — so the code is the namespace the login id is
   resolved in, not a filter. A `SUPER_ADMIN` omits it and is resolved in the tenantless platform
   namespace instead.
2. **The acting township is resolved once, per request, from the principal.** For an ordinary
   account it is copied from their own row and cannot be overridden. A `SUPER_ADMIN` names the
   township it wants to act inside with an `X-Township-Id` header, which is validated against the
   `township` table before any service sees it. A tenant id a caller can assert freely is not a
   tenant boundary.
3. **The database enforces it too.** Composite foreign keys of the form
   `(child_id, township_id) → parent(id, township_id)` make it structurally impossible to point a
   visit at another township's gate, flat, guard, approver or pass — however the application layer
   is bypassed.

**There is no hard delete of a township.** Archiving is the terminal state and it is reversible:
sign-in stops immediately, every live session ends, and the visitor log and audit trail — the record
of who was admitted through a gate and who authorised it — survive intact. A cancelled customer stops
being able to sign in; they do not stop having had a history.

---

## 1. Database Schema (PostgreSQL)

Conventions: `snake_case`, UUID primary keys (`gen_random_uuid()` via `pgcrypto`), `timestamptz` everywhere, all state machines backed by `CHECK` constraints. Enums are Postgres `ENUM` types for integrity + index-friendliness.

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------- Enum types ----------
CREATE TYPE user_role       AS ENUM ('SUPER_ADMIN', 'ADMIN', 'GUARD', 'RESIDENT', 'SALES');
CREATE TYPE township_status AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');
CREATE TYPE visitor_type    AS ENUM ('GUEST', 'DELIVERY', 'MAINTENANCE', 'CLIENT');
CREATE TYPE visit_status    AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CHECKED_IN', 'CHECKED_OUT');
CREATE TYPE approver_kind   AS ENUM ('RESIDENT', 'SALES');       -- who a visit is routed to
CREATE TYPE pass_status     AS ENUM ('ACTIVE', 'REDEEMED', 'EXPIRED', 'REVOKED');
CREATE TYPE notif_status    AS ENUM ('QUEUED', 'SENT', 'FAILED');

-- ---------- The tenant ----------
-- Every table below carries township_id. `code` is part of a credential, not a label: it is what
-- tells the login endpoint which namespace to resolve a login id in, so it is short, upper case
-- and immutable once issued.
CREATE TABLE township (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code          TEXT NOT NULL UNIQUE,            -- "GREENWOOD"; typed at every sign-in
    name          TEXT NOT NULL,
    status        township_status NOT NULL DEFAULT 'ACTIVE',
    contact_email TEXT,
    contact_phone TEXT,
    created_by    UUID REFERENCES app_user(id),    -- the super admin who onboarded it
    archived_at   TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT township_code_shape CHECK (code ~ '^[A-Z0-9][A-Z0-9-]{1,31}$'),
    CONSTRAINT archived_is_stamped CHECK (status <> 'ARCHIVED' OR archived_at IS NOT NULL)
);

-- ---------- Township structure: the property tree ----------
-- V4 replaced the fixed building_block -> flat pair with a per-township tree. "Township with
-- blocks of flats" is one shape of real-estate project among many: a villa developer has
-- clusters of villas and no floors at all, a plotted layout has sectors of plots, a high-rise
-- has towers of floors of flats. All three previously had to call a cluster a "Block".
--
-- property_level is the SHAPE of one township's tree -- an ordered list of levels, each with the
-- developer's own word for it. It is what makes the admin console dynamic: the console renders
-- one tab per level using these labels rather than a hardcoded Blocks/Flats pair.

CREATE TABLE property_level (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    township_id UUID NOT NULL REFERENCES township(id) ON DELETE CASCADE,
    depth       INT  NOT NULL,                     -- 0 is outermost, contiguous
    kind        property_node_kind NOT NULL,       -- GROUP | BUILDING | FLOOR | UNIT
    singular    TEXT NOT NULL,                     -- "Tower", "Villa", "Plot"
    plural      TEXT NOT NULL,                     -- "Towers", "Villas", "Plots"
    UNIQUE (township_id, depth),
    UNIQUE (township_id, depth, kind)              -- FK target for property_node
);
-- Exactly one addressable level per township: this is what makes "the unit level" well defined.
CREATE UNIQUE INDEX ux_property_level_unit ON property_level(township_id) WHERE kind = 'UNIT';

CREATE TABLE property_node (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    township_id UUID NOT NULL REFERENCES township(id),
    parent_id   UUID REFERENCES property_node(id),
    depth       INT  NOT NULL,                     -- derived by trigger: parent.depth + 1
    kind        property_node_kind NOT NULL,
    name        TEXT NOT NULL,                     -- "Tower A", "14", "A-1401"
    code        TEXT,                              -- UNIT only: what a guard types; login-id base
    level_number INT,                              -- FLOOR only; signed, because basements are real
    declared_occupancy INT NOT NULL DEFAULT 0,     -- UNIT only: people, incl. those with no account
    path        TEXT NOT NULL,                     -- derived: '/root/child/self/'
    is_unit     BOOLEAN NOT NULL,                  -- derived; exists to be an FK target
    CONSTRAINT property_node_root_ok  CHECK ((parent_id IS NULL) = (depth = 0)),
    CONSTRAINT property_node_code_ok  CHECK ((code IS NOT NULL) = (kind = 'UNIT')),
    CONSTRAINT property_node_level_ok CHECK (level_number IS NULL OR kind = 'FLOOR'),
    CONSTRAINT property_node_occupancy_ok
        CHECK (declared_occupancy >= 0 AND (kind = 'UNIT' OR declared_occupancy = 0)),
    CONSTRAINT property_node_is_unit_ok CHECK (is_unit = (kind = 'UNIT')),
    UNIQUE (id, township_id),
    UNIQUE (id, township_id, is_unit),
    -- A node cannot be parented into another township...
    FOREIGN KEY (parent_id, township_id) REFERENCES property_node(id, township_id),
    -- ...nor exist at a depth its township never defined, nor with the wrong kind for it.
    FOREIGN KEY (township_id, depth, kind)
        REFERENCES property_level(township_id, depth, kind)
);

-- Unit codes are unique per TOWNSHIP, stricter than the per-block rule they replaced. Resident
-- login ids are derived as <code>-<n>, so two blocks that each held a "101" both minted "101-1".
CREATE UNIQUE INDEX ux_node_unit_code  ON property_node(township_id, lower(code)) WHERE kind = 'UNIT';
CREATE UNIQUE INDEX ux_node_floor_level ON property_node(parent_id, level_number)
    WHERE kind = 'FLOOR' AND level_number IS NOT NULL;
CREATE INDEX idx_node_path ON property_node(township_id, path text_pattern_ops);

-- depth, path and is_unit are maintained by a BEFORE trigger, never supplied. The trigger also
-- refuses a child of a UNIT (a unit is a leaf) and refuses re-parenting (it would strand the
-- stored path of every descendant). depth = parent.depth + 1 is what makes a cycle
-- unrepresentable: a cycle needs a node whose depth is not one more than its parent's.

CREATE TABLE gate (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    township_id UUID NOT NULL REFERENCES township(id),
    name        TEXT NOT NULL,                     -- "Main Gate", "Service Gate"
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (township_id, lower(name))
);

-- ---------- Identity ----------
-- All accounts are admin-provisioned; the system auto-generates the password (no self-signup, no OTP).
-- login_id is the credential the user types:
--   RESIDENT -> flat/plot number + per-flat sequence, e.g. "A-101-1", "A-101-2"
--              (a flat can have multiple resident accounts)
--   SALES / GUARD / ADMIN -> an admin-assigned code (employee code or phone)
--
-- login_id, phone and email are unique **within a township**, not globally. Two townships both
-- having an "A-101-1" is the normal case, and a global constraint on phone or email would also
-- leak across the boundary: "that number is already registered" would be a true statement about a
-- different customer's township.
CREATE TABLE app_user (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- NULL for, and only for, SUPER_ADMIN -- see super_admin_is_tenantless below.
    township_id          UUID REFERENCES township(id),
    role                 user_role NOT NULL,
    login_id             TEXT NOT NULL,             -- what the user enters to log in
    full_name            TEXT NOT NULL,
    phone                TEXT,                      -- contact / optional
    email                TEXT,
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
    CONSTRAINT resident_needs_flat CHECK (role <> 'RESIDENT' OR flat_id IS NOT NULL),
    -- An exact biconditional, not a convention: a SUPER_ADMIN has no township and nobody else may
    -- be without one.
    CONSTRAINT super_admin_is_tenantless CHECK ((role = 'SUPER_ADMIN') = (township_id IS NULL)),
    FOREIGN KEY (flat_id, township_id) REFERENCES flat(id, township_id)
);
CREATE UNIQUE INDEX ux_user_township_login ON app_user(township_id, login_id);
-- NULLs are distinct under the composite index, so the tenantless platform namespace needs its own
-- partial index or two super admins could share a login id and the credential would be ambiguous.
CREATE UNIQUE INDEX ux_user_platform_login ON app_user(login_id) WHERE township_id IS NULL;
CREATE UNIQUE INDEX ux_user_township_phone ON app_user(township_id, phone) WHERE phone IS NOT NULL;
CREATE UNIQUE INDEX ux_user_township_email ON app_user(township_id, email) WHERE email IS NOT NULL;
CREATE INDEX idx_user_township        ON app_user(township_id, role);
CREATE INDEX idx_user_flat            ON app_user(flat_id);
CREATE INDEX idx_sales_on_duty        ON app_user(township_id) WHERE role = 'SALES' AND is_on_duty = true;

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
    township_id      UUID NOT NULL REFERENCES township(id),
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
    CONSTRAINT uses_ok      CHECK (use_count <= max_uses),
    FOREIGN KEY (created_by, township_id) REFERENCES app_user(id, township_id)
);
CREATE INDEX idx_pass_creator  ON pre_approval(created_by);
CREATE INDEX idx_pass_township ON pre_approval(township_id, status);
-- The PIN lookup index is the security-critical one: redemption narrows to the guard's own
-- township *before* it bcrypt-compares, so a PIN minted in one township is not a key at another's
-- gate -- and six digits shared across a whole platform makes collisions routine, not theoretical.
CREATE INDEX idx_pass_pin_lookup ON pre_approval(township_id, pin_lookup) WHERE status = 'ACTIVE';

-- ---------- Visitor log (the live gate event) ----------
CREATE TABLE visitor_log (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    township_id      UUID NOT NULL REFERENCES township(id),
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
        CHECK (visitor_type <> 'CLIENT' OR approver_kind = 'SALES'),

    -- Tenant integrity, enforced by the database rather than trusted to the service layer. Every
    -- one of these pins its target to *this row's* township, so a visit that mixed two townships
    -- could not be persisted at all. MATCH SIMPLE, so a NULL in the referencing column skips the
    -- check -- exactly right for the optional links (a walk-in has no pass, a client no flat).
    FOREIGN KEY (gate_id, township_id)         REFERENCES gate(id, township_id),
    FOREIGN KEY (logged_by, township_id)       REFERENCES app_user(id, township_id),
    FOREIGN KEY (approver_id, township_id)     REFERENCES app_user(id, township_id),
    FOREIGN KEY (target_flat_id, township_id)  REFERENCES flat(id, township_id),
    FOREIGN KEY (pre_approval_id, township_id) REFERENCES pre_approval(id, township_id)
);
CREATE INDEX idx_visit_approver_pending ON visitor_log(approver_id, status);
CREATE INDEX idx_visit_gate             ON visitor_log(gate_id, created_at DESC);
CREATE INDEX idx_visit_township_created ON visitor_log(township_id, created_at DESC);
CREATE INDEX idx_visit_township_inside  ON visitor_log(township_id) WHERE status = 'CHECKED_IN';

-- ---------- Community feed ----------
-- community_post.author_id and notification.author_id keep a plain single-column foreign key: a
-- super admin acting inside a township is a legitimate author, and its own township_id is NULL, so
-- a composite key would reject the row it is meant to allow.
CREATE TABLE community_post (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    township_id UUID NOT NULL REFERENCES township(id),
    author_id   UUID NOT NULL REFERENCES app_user(id),   -- admin or super admin
    title       TEXT NOT NULL,
    body        TEXT NOT NULL,
    image_url   TEXT,
    is_pinned   BOOLEAN NOT NULL DEFAULT false,
    published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_post_published ON community_post(published_at DESC);
CREATE INDEX idx_post_township  ON community_post(township_id, published_at DESC);

-- ---------- Targeted notifications ----------
-- The admin's audience filter is stored as a JSONB rule; the fan-out to
-- individual users is materialized in notification_recipient for auditing.
-- An audience rule is always evaluated **within one township**, including {"mode":"ALL"} -- that
-- is the difference between "everyone here" and "everyone on the platform".
CREATE TABLE notification (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    township_id   UUID NOT NULL REFERENCES township(id),
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
-- device, notification_recipient and refresh_token carry no township column on purpose: each is
-- owned by exactly one app_user and inherits that account's tenancy through it.

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

- `township 1─* {property_level, property_node, gate, app_user, pre_approval, visitor_log, community_post, notification}` — the tenant is the root of everything
- `township 1─* property_level` — the shape of its tree; exactly one level has `kind = 'UNIT'`
- `property_node 0..1─* property_node` — the tree itself, max depth 6, every node pinned to a defined level
- `property_node(kind='UNIT') 1─* app_user(RESIDENT)` — residents attach to the addressable level only, enforced by the composite `(id, township_id, is_unit)` key
- `app_user 1─* device` (FCM tokens; multi-device)
- `app_user(RESIDENT|SALES) 1─* pre_approval`
- `visitor_log *─1 gate`, `*─1 app_user(logged_by=guard)`, `*─0..1 app_user(approver)`, `*─0..1 pre_approval` — each additionally pinned to the same township by a composite FK
- `notification 1─* notification_recipient *─1 app_user`
- `app_user(SUPER_ADMIN)` has **no** township edge at all

### State machines (enforced in service + `CHECK`/transition guards)

- **Visit:** `PENDING → {APPROVED | REJECTED | EXPIRED}`; `APPROVED → CHECKED_IN → CHECKED_OUT`. Pass redemptions may skip straight to `CHECKED_IN`.
- **Pass:** `ACTIVE → {REDEEMED | EXPIRED | REVOKED}`.
- **Township:** `ACTIVE ⇄ SUSPENDED`, `{ACTIVE | SUSPENDED} → ARCHIVED → ACTIVE` (restore). There is no terminal deleted state — see §0.

Illegal transitions return `409`; every transition writes an `audit_log` row.

### Migration layout

`V1__init.sql` is the single-tenant baseline. Multi-tenancy arrives as two migrations, and the split
is load-bearing: PostgreSQL 12+ permits `ALTER TYPE … ADD VALUE` inside a transaction but the new
label cannot be *used* until that transaction commits, and Flyway runs each migration in its own.

- `V2__super_admin_role.sql` — adds the `SUPER_ADMIN` label to `user_role`, and nothing else.
- `V3__multi_tenancy.sql` — the `township` table, every `township_id` column, the re-scoped unique
  indexes, the composite foreign keys, and the bootstrap `superadmin` row. Existing rows are adopted
  into a `DEFAULT` township, which on a fresh install is simply the first township, ready to use.
- `V4__property_tree.sql` — `property_type` on `township`, the `property_level` / `property_node`
  pair, and `flat.declared_occupancy`'s successor `property_node.declared_occupancy`. Existing
  `building_block` and `flat` rows are copied into `property_node` **preserving their UUIDs**, so
  `app_user.flat_id` and `visitor_log.target_flat_id` keep their values verbatim and only their
  foreign-key target moves. Both columns deliberately keep the name `flat_id`: renaming them is a
  separate migration for once the frontend stops sending `flatId`, so this one stays a pure
  structural change. The old tables are dropped at the end.

  Note the difference from V2's constraint: V4 *creates* enum types rather than adding labels to an
  existing one, and a freshly created type is usable in the same transaction — so it needs no split.

---

## 2. API Endpoint Design (REST)

Base path `/api/v1`. JWT bearer auth; role encoded in token claims + `@PreAuthorize` on every method. `kebab-case` URLs, `camelCase` JSON, DTOs only (never expose JPA entities).

### Tenancy on the wire

Every endpoint below except `/auth/login`, `/auth/refresh` and `/super/**` acts **inside one
township**, and which one is never taken from the path or the body:

| Caller | Acting township | Notes |
|--------|-----------------|-------|
| `ADMIN`, `GUARD`, `RESIDENT`, `SALES` | Their own, from `app_user.township_id` | Sending `X-Township-Id` for a *different* township is `403 TOWNSHIP_MISMATCH` — refused, not ignored |
| `SUPER_ADMIN` | Whichever it names in `X-Township-Id` | Validated against `township` before any service runs. Omitted on a township-scoped endpoint → `422 TOWNSHIP_CONTEXT_REQUIRED`; naming an archived township → `409 TOWNSHIP_ARCHIVED` |

A `SUPER_ADMIN` is granted `ROLE_ADMIN` alongside `ROLE_SUPER_ADMIN`, so it passes every
`hasRole('ADMIN')` check — but only inside the township its header names. It is deliberately **not**
granted `GUARD`, `RESIDENT` or `SALES`: those roles are the physical parties to a visit, and a
platform operator standing in for them would make the audit trail a fiction.

### Auth & devices
All roles authenticate with **`townshipCode` + `login_id` + password** (no OTP, no self-signup). Residents type their **flat/plot number**; sales/guard/admin type their admin-assigned code. `townshipCode` is the namespace the login id resolves in, and is omitted only by a `SUPER_ADMIN`, which belongs to no township.
| Method | Path | Role | Purpose |
|--------|------|------|---------|
| POST | `/auth/login` | public | `{ townshipCode?, loginId, password }` → JWT (access + refresh). Response flags `mustResetPassword` and echoes `townshipId`/`townshipCode`/`townshipName` |
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
| GET | `/admin/inside` | ADMIN | Live "who's inside" (visits where status = CHECKED_IN). The guard's screen; **not** the developer's occupancy figure — see `/admin/property/occupancy` |
| GET | `/admin/visits` | ADMIN | Filterable visitor log export |
| POST | `/admin/users` | ADMIN | **Provision an account.** For residents: `{role:"RESIDENT", flatId, fullName}` → server assigns the next per-flat `login_id` (`A-101-1`, `A-101-2`, …); for sales/guard: `{role, loginId, fullName}`. Server **auto-generates the password** and **returns it once** for the admin to hand over |
| POST | `/admin/users/{id}/reset-password` | ADMIN | Auto-generate a new password, return it once, set `must_reset_password=true` |
| GET/PATCH/DELETE | `/admin/users`, `/admin/users/{id}` | ADMIN | List / edit / deactivate accounts |
| CRUD | `/admin/gates` | ADMIN | Gates |
| GET | `/admin/property/profile` | ADMIN, GUARD | The township's project type and its ordered, labelled levels — **the console renders its structure tabs from this**, which is what makes the panel adapt per developer |
| GET | `/admin/property/types` | ADMIN | The project presets and their default level sets (same payload as `/super/property-types`) |
| PUT | `/admin/property/levels` | ADMIN | Replace the level set. Refused once any node exists (`409 PROPERTY_TREE_NOT_EMPTY`) — re-depthing a populated tree has no safe automatic answer |
| PATCH | `/admin/property/levels/{id}` | ADMIN | Rename one level. Stays available after the tree is populated, because it changes nothing structural |
| CRUD | `/admin/property/nodes` | ADMIN (GUARD reads) | The tree. A node's `kind` comes from the level it lands at, never from the request |
| POST | `/admin/property/nodes/bulk` | ADMIN | Generate a building's floors and units in one transaction |
| PUT | `/admin/property/nodes/{id}/occupancy` | ADMIN | Set a unit's declared headcount |
| GET | `/admin/property/occupancy` | ADMIN | Occupancy summary — see below |

### Occupancy: three different questions that share one word

Before V4 the only thing in the system carrying the word "occupancy" was `GET /admin/inside`, which
counts `visitor_log` rows in `CHECKED_IN` — **visitors physically on the premises right now**. That
is a live security number and a useful one, but it is not what a real-estate developer means by
occupancy, and nothing answered what they do mean.

`GET /admin/property/occupancy` reports all three separately, deliberately not collapsed into one
headline:

| Field | Question it answers | Source |
|-------|--------------------|--------|
| `occupancyRate`, `occupiedUnits`, `totalUnits` | How much of the project is lived in? — **the developer's metric** | units with a declared headcount **or** ≥1 active resident account |
| `residentHeadcount` | How many people live here? | `SUM(property_node.declared_occupancy)` |
| `registeredResidentAccounts` | How many of them can actually sign in? | active `app_user` rows with `role = RESIDENT` |
| `visitorsInside` | Who is on site right now? | `visitor_log` where `status = CHECKED_IN` |

**Why `declared_occupancy` exists rather than counting accounts.** A flat with four occupants
typically has *one* login — the owner's. The spouse, children and parents never sign up. Deriving
headcount from `app_user` would report that household as one person. So the headcount is declared
per unit, and the account count is reported *alongside* it rather than instead of it: the gap
between the two is itself the interesting figure, because it is how many residents cannot yet be
notified of anything.

**The consistency rule.** `declared_occupancy` can never sit below the number of active resident
accounts on that unit. Provisioning a resident raises it automatically
(`UserProvisioningService` → `PropertyService.raiseDeclaredOccupancy`), and setting it manually
below the account count is a `409 OCCUPANCY_BELOW_RESIDENTS`. The two can therefore only disagree in
the direction of the declaration being *higher*, which is exactly the legitimate case. The invariant
spans two tables, so it lives in the service layer rather than in a `CHECK`.

`POST /admin/users` refuses `role: "ADMIN"` from a township admin (`403 ADMIN_REQUIRES_SUPER_ADMIN`)
and refuses `role: "SUPER_ADMIN"` outright (`422 ROLE_NOT_PROVISIONABLE`). Appointing the account
with authority over every other account in a township is a platform action, not a township one.

### Onboarding a developer: choosing the project shape

`POST /super/townships` takes **`propertyType`** — the kind of project this developer builds — and
optionally an explicit **`levels`** array for a structure no preset covers. The type seeds the
township's level set, so its admin's first visit to the structure screen already says Malls, Levels
and Shops rather than Blocks and Flats.

`GET /super/property-types` is the catalogue, and it is **tenantless on purpose**: a super admin
onboarding a *new* developer has no township to name in `X-Township-Id`, so the tenant-scoped
`/admin/property/types` would answer `422 TOWNSHIP_CONTEXT_REQUIRED` on the first screen of the
flow. It returns each type's category, description and the level set it would seed, so the console
can show the resulting structure before anything is created.

**Why the choice belongs at onboarding.** The level set cannot be reshaped once the tree holds
anything (`409 PROPERTY_TREE_NOT_EMPTY`) — inserting a Floor level under towers that already hold
flats has no safe automatic answer to which floor each flat belongs on. Onboarding is therefore the
only cheap moment to get the shape right, which is why the picker shows the structure inline rather
than hiding it behind a dropdown label. An explicit `levels` array is validated with exactly the
same rules `PUT /admin/property/levels` applies, so a shape that could not be set later cannot be
set here either.

| Category | Types |
|---|---|
| Residential | `APARTMENT` (Tower→Floor→Flat) · `VILLA` (Cluster→Villa) · `ROW_HOUSE` · `PLOTTED` (Sector→Plot) · `GATED_TOWNSHIP` (Phase→Block→Floor→Flat) · `CO_LIVING` (Building→Floor→Room) · `STUDENT_HOUSING` · `SENIOR_LIVING` · `SERVICED_APARTMENT` · `FARMHOUSE` |
| Commercial | `COMMERCIAL` (Tower→Floor→Office) · `IT_PARK` · `RETAIL` (Mall→Level→Shop) · `INDUSTRIAL` |
| Mixed | `MIXED_USE` (Phase→Building→Floor→Unit) |

The type is a *starting point*, never a constraint: every label stays editable, and nothing in the
code branches on it — `PropertyNodeKind` is what decisions are made on.

### Platform ops (SUPER_ADMIN only)
Everything under `/super` acts **on** townships rather than inside one, and needs no
`X-Township-Id`. Closed by a URL rule in `SecurityConfig` as well as `@PreAuthorize`, so a newly
added endpoint here is closed by default.

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/super/townships` | **Onboard a township and its first admin in one call.** Returns the admin's generated password once. They are not two endpoints because a township with no admin is unusable and nobody inside it can fix that |
| GET | `/super/townships` | List; archived ones hidden unless `?includeArchived=true` |
| GET/PATCH | `/super/townships/{id}` | Fetch with headline counts / edit name and contacts (the `code` is immutable — it is part of every resident's credential) |
| POST | `/super/townships/{id}/suspend` | Reversible lockout; nothing is torn down |
| DELETE | `/super/townships/{id}` | **Archive** — the soft delete. Body `{ confirmCode }` must equal the township's own code |
| POST | `/super/townships/{id}/restore` | Return a suspended or archived township to service |
| GET/POST | `/super/townships/{id}/admins` | List / appoint township administrators |
| DELETE | `/super/townships/{id}/admins/{userId}` | Deactivate one; refused (`409 LAST_TOWNSHIP_ADMIN`) for the last active admin |
| POST | `/super/townships/{id}/admins/{userId}/reset-password` | Reissue a township admin's password |
| GET/POST | `/super/admins` | List / provision peer super admins |
| DELETE | `/super/admins/{userId}` | Deactivate; refused for yourself (`422 CANNOT_DEACTIVATE_SELF`) and for the last active operator (`409 LAST_SUPER_ADMIN`) |
| POST | `/super/admins/{userId}/activate`, `/reset-password` | Reactivate / reissue |

Suspending or archiving ends every live session in the township at once: each member's
`token_version` is bumped (so access tokens already in the wild stop verifying on their *next*
request, not when their TTL lapses) and every refresh token is revoked. Accounts are deliberately
**not** deactivated — restoring the township would otherwise have to guess which of them an admin
had disabled beforehand, and it would guess wrong.

### WebSocket (STOMP) channels
- Connect: `/ws` (SockJS fallback), JWT in CONNECT header. Refused if the principal's township is not `ACTIVE`.
- Guard subscribes to their gate: `/topic/gate/{gateId}` — receives `VISIT_DECIDED` events. The interceptor resolves the gate *within the subscriber's township*, so a valid token cannot watch another township's gate.
- Approver subscribes to `/user/queue/visits` — receives `VISIT_REQUESTED` (belt-and-suspenders alongside FCM).
- Admin subscribes to `/topic/admin/inside/{townshipId}` — live occupancy updates. **The township id is part of the destination**: a single shared topic would push every township's movements to every township's dashboard, and no client-side filtering fixes that once the frame has left the server.

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
   │                       │  WS /topic/admin/inside/{tid}    │
```

**Detailed sequence:**

1. **Guard submits.** `POST /visits` with visitor details + chosen target (resident flat, or — with the **Meet Sales Agent** tick-box set — a sales agent picked from `GET /sales/on-duty`). A ticked visit must route to `SALES` and an unticked one must not (`sales_meeting_routes_to_sales` CHECK, V6).
2. **Persist.** Service creates `visitor_log` (`PENDING`) in a `@Transactional` method, writes `audit_log`.
3. **Resolve tokens.** Look up the approver's `device` rows → FCM token list.
4. **Dual dispatch.**
   - **FCM data message** to every token — payload `{type:"VISIT_REQUESTED", visitId, visitorName, visitorType, gateName}`. Data (not notification-only) so the app can render a custom actionable heads-up even when killed.
   - **WebSocket** message to `/user/queue/visits` if that user has a live session — instant in-app card.
5. **Guard waits.** Guard's app subscribed to `/topic/gate/{gateId}`; shows a pending spinner. No polling needed.
6. **Approver decides.** Tap fires `PATCH /visits/{id}/decision`.
7. **Guarded transition.** Service validates the caller *is* the routed approver (ownership re-check), applies FSM `PENDING → APPROVED/REJECTED`, stamps `decided_at`, writes audit.
8. **Push result to Guard.** Broadcast `VISIT_DECIDED` on `/topic/gate/{gateId}` → the Guard tablet flips to green/red **in milliseconds**. FCM to the guard device is sent as a fallback in case the WS session dropped.
9. **Check-in / occupancy.** Guard taps check-in → `CHECKED_IN`; an event on `/topic/admin/inside/{townshipId}` updates that township's Admin occupancy feed. The count carried in the event is scoped to the township too — a platform-wide "currently inside" figure would be meaningless to every admin who saw it.

Every step above happens inside one township. The gate resolved in step 1, the approver in step 3, the routed flat and the pass in the fast path below are each looked up by `(id, townshipId)`, so an id belonging to another township is a `404` before any ownership or FSM check runs.

### Pass-redemption fast path (no approval ping)
Guard calls `POST /passes/redeem` with PIN or QR token → service resolves the pass **within the guard's own township**, verifies hash, window, and `use_count < max_uses`, increments use, creates a `visitor_log` directly in `CHECKED_IN`. Zero-wait entry; the pass owner optionally gets an informational FCM ("Your guest checked in").

The tenant predicate on resolution is not incidental. Six digits is a million-value space shared by the whole platform, so PIN collisions *between* townships are routine rather than theoretical — narrowing first is both what stops a photographed QR code or an overheard PIN working at another community's gate, and what keeps the bcrypt-verify candidate list to the handful the design assumes.

### Reliability details
- **Delivery guarantee:** FCM is best-effort; the authoritative state always lives in Postgres. The approver app also has `GET /visits/pending` to reconcile on foreground.
- **Expiry sweep:** a ShedLock-guarded scheduled job flips stale `PENDING` visits to `EXPIRED` (e.g. 10-min TTL) and `ACTIVE` passes past `valid_until` to `EXPIRED`, emitting WS/FCM so the Guard screen doesn't hang.
- **Token hygiene:** FCM `UNREGISTERED`/`InvalidToken` responses prune the offending `device` row.
- **WS auth:** JWT validated on STOMP `CONNECT`; a channel interceptor rejects subscribes to gates/queues the principal doesn't own.

### Notification fan-out (targeting engine)
`POST /notifications` with an `audienceRule` JSONB. The service compiles the rule into a single parameterized SQL query against `app_user` (+ `property_node` joins), e.g.:
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
5. `app_user`, roles, password login (`townshipCode` + `login_id` + password), JWT issue/refresh, forced first-login password reset.
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

### Phase 9a — Multi-tenancy & the platform role *(done — see BACKEND.md §5.5)*
- `V2` / `V3` migrations: `township`, `SUPER_ADMIN`, `township_id` everywhere, re-scoped unique indexes, composite `(id, township_id)` foreign keys.
- `TenantContext` + `TenantContextFilter`: the acting township resolved once per request from the principal, never from a path or body.
- Every repository finder and every service read anchored on the tenant; PIN/QR redemption and audience resolution narrowed before they authorise anything.
- `/api/v1/super/**`: township lifecycle (create · suspend · archive · restore), township-admin appointment and removal, peer super admins.
- Occupancy topic keyed by township; STOMP subscription authorisation checks the tenant, not just the role.
- `MultiTenancyTest` (the negative tenancy matrix) and `SuperAdminTest` alongside the existing `RbacNegativeTest`.

### Phase 9b — Super admin console (admin web) *(done — see FRONTEND.md §16 F5b)*
- `/townships`: list with archived filter, onboarding wizard (township + first admin, one-time credential card carrying the township code), admin appointment and removal, suspend/restore, and archive behind typed confirmation.
- Township selection writes the acting township; `ApiClient` sends it as `X-Township-Id` on every subsequent request, and the shell hides the township-scoped nav until one is chosen.

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
- **Township code as part of the login credential** — login ids are only unique within a tenant, so the alternative was either globally prefixed ids (`GRN-A-101-1`, ugly on a resident's sign-in card) or a cross-tenant lookup at login, which is an authentication bug and an enumeration oracle at once.
- **Tenant resolved once per request, in a filter, from the principal** — the alternative is a `townshipId` parameter threaded through every signature, where the one call site somebody forgets is a silent cross-tenant read rather than a loud 400.
- **Composite `(id, township_id)` foreign keys** — the service layer scopes every query, but a bug or a future endpoint could stop doing so. These make a cross-tenant row unwritable at the storage layer, which is the same reasoning the `CHECK` constraints already embody.
- **Archive rather than delete a township** — the visitor log and audit trail are the record of who was admitted through a gate and who authorised it. Erasing them to tidy up a cancelled customer is not a trade this system makes; sign-in stops, history stays.
