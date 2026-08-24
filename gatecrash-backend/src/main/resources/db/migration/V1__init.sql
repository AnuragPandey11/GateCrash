-- =====================================================================================
-- GateCrash Township ERP -- Phase 1 baseline schema.
-- Conventions: snake_case, UUID PKs (pgcrypto), timestamptz everywhere,
-- state machines backed by CHECK constraints, Postgres ENUM types for integrity.
-- Never edit an applied migration -- add V<n>__description.sql instead.
-- =====================================================================================

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

-- ---------- Devices / FCM tokens (one user -> many devices) ----------
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
    pin_hash         TEXT NOT NULL,                -- bcrypt of the 6-digit PIN, never plaintext
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

-- =====================================================================================
-- Additions on top of ARCHITECTURE.md section 1 (BACKEND.md section 4).
-- =====================================================================================

-- ShedLock table for leader-locked jobs.
CREATE TABLE shedlock (
    name       TEXT PRIMARY KEY,
    lock_until TIMESTAMPTZ NOT NULL,
    locked_at  TIMESTAMPTZ NOT NULL,
    locked_by  TEXT NOT NULL
);

-- Refresh-token store (rotation + revocation + reuse detection).
-- family_id ties a rotation chain together: replaying a already-rotated token revokes the
-- whole family, which is the standard mitigation for a stolen refresh token.
CREATE TABLE refresh_token (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    family_id      UUID NOT NULL,
    token_hash     TEXT NOT NULL UNIQUE,          -- SHA-256 of the opaque refresh token
    expires_at     TIMESTAMPTZ NOT NULL,
    revoked        BOOLEAN NOT NULL DEFAULT false,
    revoked_reason TEXT,
    rotated_at     TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_refresh_user   ON refresh_token(user_id);
CREATE INDEX idx_refresh_family ON refresh_token(family_id);
CREATE INDEX idx_refresh_expiry ON refresh_token(expires_at) WHERE revoked = false;

-- token_version is stamped into every access JWT. Bumping it (password change, deactivation,
-- forced logout) invalidates already-issued access tokens immediately instead of waiting out
-- the 30-minute TTL. Without it, revocation is only eventually consistent.
ALTER TABLE app_user ADD COLUMN token_version INT NOT NULL DEFAULT 0;

-- Optimistic-lock columns. Every state transition is also guarded by a pessimistic row lock in
-- the service; these are the second line of defence against a lost update under concurrency.
ALTER TABLE visitor_log  ADD COLUMN version BIGINT NOT NULL DEFAULT 0;
ALTER TABLE pre_approval ADD COLUMN version BIGINT NOT NULL DEFAULT 0;

-- Deterministic, peppered lookup index for PIN redemption.
-- pin_hash stays bcrypt (slow + salted) and remains the only thing that authorises a redemption.
-- pin_lookup = HMAC-SHA256(server pepper, pin) lets the guard's PIN entry hit an index instead of
-- bcrypt-comparing every ACTIVE pass in the township, which would be both slow and a DoS vector.
-- The pepper lives in config, not the DB, so a stolen dump still yields no usable PINs.
ALTER TABLE pre_approval ADD COLUMN pin_lookup TEXT;
CREATE INDEX idx_pass_pin_lookup ON pre_approval(pin_lookup) WHERE status = 'ACTIVE';

-- Supporting indexes for hot read paths not covered above.
CREATE INDEX idx_visit_target_flat   ON visitor_log(target_flat_id, status);
CREATE INDEX idx_visit_created_at    ON visitor_log(created_at DESC);
CREATE INDEX idx_notif_created_at    ON notification(created_at DESC);
CREATE INDEX idx_audit_actor         ON audit_log(actor_id, created_at DESC);

-- ---------- Bootstrap admin ----------
-- Seeded WITHOUT a usable password on purpose: '!' is not a valid bcrypt digest, so no password
-- can ever match it. BootstrapAdminInitializer sets the real one at startup from
-- GATECRASH_BOOTSTRAP_ADMIN_PASSWORD (prod), or generates and logs a random one once (local).
-- must_reset_password forces a change on first login either way.
INSERT INTO app_user (role, login_id, full_name, password_hash, must_reset_password)
VALUES ('ADMIN', 'admin', 'Bootstrap Admin', '!', true);
