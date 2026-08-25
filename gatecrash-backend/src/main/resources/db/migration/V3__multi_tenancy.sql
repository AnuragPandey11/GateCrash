-- =====================================================================================
-- GateCrash multi-tenancy -- one deployment, many townships.
--
-- A township is the tenant boundary. Every operational row belongs to exactly one, and
-- the isolation is enforced in the database as well as in the service layer: composite
-- foreign keys of the form (child_id, township_id) -> parent(id, township_id) make it
-- structurally impossible to point a visit at another township's gate, flat, guard,
-- approver or pass, however the application layer is bypassed.
--
-- SUPER_ADMIN is the one role that lives outside every tenant (township_id IS NULL).
-- It provisions townships and their admins, and carries the ADMIN authority into a
-- township it names explicitly on the request.
-- =====================================================================================

-- ---------- The tenant ----------
CREATE TYPE township_status AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');

CREATE TABLE township (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Typed by every non-super-admin at login, so it is short, upper case and unambiguous.
    code          TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    status        township_status NOT NULL DEFAULT 'ACTIVE',
    contact_email TEXT,
    contact_phone TEXT,
    created_by    UUID REFERENCES app_user(id),   -- the super admin who onboarded it
    archived_at   TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT township_code_shape CHECK (code ~ '^[A-Z0-9][A-Z0-9-]{1,31}$'),
    CONSTRAINT archived_is_stamped CHECK (status <> 'ARCHIVED' OR archived_at IS NOT NULL)
);
CREATE INDEX idx_township_status ON township(status);

-- The tenant that every pre-multi-tenancy row is adopted into. On a fresh install it is
-- simply the first township, ready to use; on an existing one it is where the whole
-- single-tenant deployment lands without a data migration decision to make.
INSERT INTO township (code, name) VALUES ('DEFAULT', 'Default Township');

-- ---------- Tenant columns ----------
-- app_user is the exception: SUPER_ADMIN accounts belong to no township, and the check
-- constraint makes that an exact biconditional rather than a convention.
ALTER TABLE app_user ADD COLUMN township_id UUID REFERENCES township(id);
UPDATE app_user SET township_id = (SELECT id FROM township WHERE code = 'DEFAULT');
ALTER TABLE app_user ADD CONSTRAINT super_admin_is_tenantless
    CHECK ((role = 'SUPER_ADMIN') = (township_id IS NULL));

ALTER TABLE building_block ADD COLUMN township_id UUID REFERENCES township(id);
UPDATE building_block SET township_id = (SELECT id FROM township WHERE code = 'DEFAULT');
ALTER TABLE building_block ALTER COLUMN township_id SET NOT NULL;

ALTER TABLE flat ADD COLUMN township_id UUID REFERENCES township(id);
UPDATE flat SET township_id = (SELECT id FROM township WHERE code = 'DEFAULT');
ALTER TABLE flat ALTER COLUMN township_id SET NOT NULL;

ALTER TABLE gate ADD COLUMN township_id UUID REFERENCES township(id);
UPDATE gate SET township_id = (SELECT id FROM township WHERE code = 'DEFAULT');
ALTER TABLE gate ALTER COLUMN township_id SET NOT NULL;

ALTER TABLE pre_approval ADD COLUMN township_id UUID REFERENCES township(id);
UPDATE pre_approval SET township_id = (SELECT id FROM township WHERE code = 'DEFAULT');
ALTER TABLE pre_approval ALTER COLUMN township_id SET NOT NULL;

ALTER TABLE visitor_log ADD COLUMN township_id UUID REFERENCES township(id);
UPDATE visitor_log SET township_id = (SELECT id FROM township WHERE code = 'DEFAULT');
ALTER TABLE visitor_log ALTER COLUMN township_id SET NOT NULL;

ALTER TABLE community_post ADD COLUMN township_id UUID REFERENCES township(id);
UPDATE community_post SET township_id = (SELECT id FROM township WHERE code = 'DEFAULT');
ALTER TABLE community_post ALTER COLUMN township_id SET NOT NULL;

ALTER TABLE notification ADD COLUMN township_id UUID REFERENCES township(id);
UPDATE notification SET township_id = (SELECT id FROM township WHERE code = 'DEFAULT');
ALTER TABLE notification ALTER COLUMN township_id SET NOT NULL;

-- Nullable here and only here: a super admin creating or archiving a township acts on the
-- platform, not inside a tenant, and those rows must still be recorded.
ALTER TABLE audit_log ADD COLUMN township_id UUID REFERENCES township(id);
UPDATE audit_log SET township_id = (SELECT id FROM township WHERE code = 'DEFAULT');

-- device, notification_recipient and refresh_token carry no township column on purpose:
-- each is owned by exactly one app_user and inherits that account's tenancy through it.

-- ---------- Uniqueness is now per tenant ----------
-- login_id was globally unique, which cannot survive two townships: both will mint a
-- resident "A-101-1" from their own block A. Scoping it is what makes the township code
-- a required part of the login credential.
ALTER TABLE app_user DROP CONSTRAINT app_user_login_id_key;
CREATE UNIQUE INDEX ux_user_township_login ON app_user(township_id, login_id);
-- township_id IS NULL rows do not collide under the composite index (NULLs are distinct),
-- so the platform namespace needs its own partial index or two super admins could share a
-- login id and the credential would be ambiguous.
CREATE UNIQUE INDEX ux_user_platform_login ON app_user(login_id) WHERE township_id IS NULL;

-- Phone and email were globally unique too. Beyond being wrong (the same handset can serve
-- a resident in one township and a guard in another), a global constraint is an information
-- leak: "PHONE_TAKEN" would tell one tenant's admin that another tenant holds that number.
ALTER TABLE app_user DROP CONSTRAINT app_user_phone_key;
ALTER TABLE app_user DROP CONSTRAINT app_user_email_key;
CREATE UNIQUE INDEX ux_user_township_phone ON app_user(township_id, phone) WHERE phone IS NOT NULL;
CREATE UNIQUE INDEX ux_user_township_email ON app_user(township_id, email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX ux_user_platform_phone ON app_user(phone)
    WHERE township_id IS NULL AND phone IS NOT NULL;
CREATE UNIQUE INDEX ux_user_platform_email ON app_user(email)
    WHERE township_id IS NULL AND email IS NOT NULL;

-- Block names were globally unique; gate names were unique only by service convention.
-- Both become per-township, case-insensitively, matching what the services already check.
ALTER TABLE building_block DROP CONSTRAINT building_block_name_key;
CREATE UNIQUE INDEX ux_block_township_name ON building_block(township_id, lower(name));
CREATE UNIQUE INDEX ux_gate_township_name  ON gate(township_id, lower(name));

-- ---------- Cross-tenant referential integrity ----------
-- Layer 3 of the security model. Each parent gets a (id, township_id) unique key so a child
-- can carry a composite foreign key that pins both sides to the same tenant. The id column
-- alone is already unique; the pair exists purely to be a foreign-key target.
ALTER TABLE building_block ADD CONSTRAINT building_block_tenant_uq UNIQUE (id, township_id);
ALTER TABLE flat           ADD CONSTRAINT flat_tenant_uq           UNIQUE (id, township_id);
ALTER TABLE gate           ADD CONSTRAINT gate_tenant_uq           UNIQUE (id, township_id);
ALTER TABLE app_user       ADD CONSTRAINT app_user_tenant_uq       UNIQUE (id, township_id);
ALTER TABLE pre_approval   ADD CONSTRAINT pre_approval_tenant_uq   UNIQUE (id, township_id);

-- These are MATCH SIMPLE, so a NULL in any referencing column skips the check entirely --
-- which is exactly right for the optional links (a guard has no flat, a walk-in has no pass).
ALTER TABLE flat ADD CONSTRAINT flat_block_same_township
    FOREIGN KEY (block_id, township_id) REFERENCES building_block(id, township_id);

ALTER TABLE app_user ADD CONSTRAINT user_flat_same_township
    FOREIGN KEY (flat_id, township_id) REFERENCES flat(id, township_id);

ALTER TABLE pre_approval ADD CONSTRAINT pass_creator_same_township
    FOREIGN KEY (created_by, township_id) REFERENCES app_user(id, township_id);

ALTER TABLE visitor_log ADD CONSTRAINT visit_gate_same_township
    FOREIGN KEY (gate_id, township_id) REFERENCES gate(id, township_id);
ALTER TABLE visitor_log ADD CONSTRAINT visit_guard_same_township
    FOREIGN KEY (logged_by, township_id) REFERENCES app_user(id, township_id);
ALTER TABLE visitor_log ADD CONSTRAINT visit_approver_same_township
    FOREIGN KEY (approver_id, township_id) REFERENCES app_user(id, township_id);
ALTER TABLE visitor_log ADD CONSTRAINT visit_flat_same_township
    FOREIGN KEY (target_flat_id, township_id) REFERENCES flat(id, township_id);
ALTER TABLE visitor_log ADD CONSTRAINT visit_pass_same_township
    FOREIGN KEY (pre_approval_id, township_id) REFERENCES pre_approval(id, township_id);

-- community_post.author_id and notification.author_id keep their plain single-column foreign
-- key: a super admin acting inside a township is a legitimate author, and their township_id
-- is NULL, so a composite key would reject the row it is supposed to allow.

-- ---------- Tenant-aware indexes ----------
-- Every hot read path is now prefixed by township_id; the single-tenant versions of these
-- would force a scan across all tenants and then filter.
CREATE INDEX idx_user_township          ON app_user(township_id, role);
CREATE INDEX idx_block_township         ON building_block(township_id);
CREATE INDEX idx_flat_township          ON flat(township_id);
CREATE INDEX idx_gate_township          ON gate(township_id);
CREATE INDEX idx_visit_township_created ON visitor_log(township_id, created_at DESC);
CREATE INDEX idx_visit_township_inside  ON visitor_log(township_id) WHERE status = 'CHECKED_IN';
CREATE INDEX idx_pass_township          ON pre_approval(township_id, status);
CREATE INDEX idx_post_township          ON community_post(township_id, published_at DESC);
CREATE INDEX idx_notif_township         ON notification(township_id, created_at DESC);
CREATE INDEX idx_audit_township         ON audit_log(township_id, created_at DESC);

-- Rebuilt with the tenant as the leading column.
DROP INDEX idx_sales_on_duty;
CREATE INDEX idx_sales_on_duty ON app_user(township_id)
    WHERE role = 'SALES' AND is_on_duty = true;

-- The PIN lookup index is the security-critical one: redemption must narrow to the guard's
-- own township before it ever bcrypt-compares, or a PIN minted in one township could be
-- offered at another township's gate.
DROP INDEX idx_pass_pin_lookup;
CREATE INDEX idx_pass_pin_lookup ON pre_approval(township_id, pin_lookup) WHERE status = 'ACTIVE';

-- ---------- Bootstrap super admin ----------
-- Same discipline as the V1 bootstrap admin: '!' is not a valid bcrypt digest, so nothing can
-- match it until BootstrapAdminInitializer sets a real password at startup.
INSERT INTO app_user (role, login_id, full_name, password_hash, must_reset_password, township_id)
VALUES ('SUPER_ADMIN', 'superadmin', 'Bootstrap Super Admin', '!', true, NULL);
