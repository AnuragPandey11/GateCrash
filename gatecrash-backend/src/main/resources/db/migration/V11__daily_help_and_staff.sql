-- =====================================================================================
-- V11: daily help and society staff.
--
-- A staff member is someone who comes through the gate regularly to work: a maid, a cook or a
-- driver working for households (DAILY_HELP), or the society's own housekeeping, security and
-- maintenance people (SOCIETY_STAFF). Each has a long-lived 6-digit entry code — stored only as a
-- peppered HMAC, like pass PINs — and an ID-card QR. The guard marks them in and out, which is
-- their attendance; the households they work for are told.
--
-- Same tenancy pattern as V8: a township_id on every row and composite (id, township_id) keys so
-- nothing can point across a tenant boundary.
-- =====================================================================================

CREATE TYPE staff_scope    AS ENUM ('DAILY_HELP', 'SOCIETY_STAFF');
CREATE TYPE staff_category AS ENUM ('MAID', 'COOK', 'DRIVER', 'NANNY', 'CAR_CLEANER', 'GARDENER',
                                    'ELDER_CARE', 'LAUNDRY', 'HOUSEKEEPING', 'SECURITY',
                                    'ELECTRICIAN', 'PLUMBER', 'MAINTENANCE', 'OFFICE', 'OTHER');

CREATE TABLE staff_member (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    township_id  UUID NOT NULL REFERENCES township(id),
    scope        staff_scope NOT NULL,
    category     staff_category NOT NULL,
    full_name    TEXT NOT NULL CHECK (length(full_name) BETWEEN 1 AND 120),
    phone        TEXT,
    code_lookup  TEXT NOT NULL,
    qr_token     UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    active       BOOLEAN NOT NULL DEFAULT true,
    created_by   UUID REFERENCES app_user(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    version      BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT staff_tenant_uq UNIQUE (id, township_id)
);
-- The code identifies the person at the gate on its own, so it must be unique per township.
CREATE UNIQUE INDEX ux_staff_code  ON staff_member(township_id, code_lookup);
CREATE UNIQUE INDEX ux_staff_phone ON staff_member(township_id, phone) WHERE phone IS NOT NULL;
CREATE INDEX idx_staff_township    ON staff_member(township_id, scope, active);

-- Which homes a helper works for. One helper, many homes; one home, many helpers.
CREATE TABLE staff_household (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    township_id UUID NOT NULL,
    staff_id    UUID NOT NULL,
    unit_id     UUID NOT NULL,
    added_by    UUID REFERENCES app_user(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT staff_household_uq UNIQUE (staff_id, unit_id),
    CONSTRAINT household_staff_same_township
        FOREIGN KEY (staff_id, township_id) REFERENCES staff_member(id, township_id) ON DELETE CASCADE,
    CONSTRAINT household_unit_same_township
        FOREIGN KEY (unit_id, township_id) REFERENCES property_node(id, township_id)
);
CREATE INDEX idx_staff_household_unit ON staff_household(unit_id);

-- One row per stay inside: in at the gate, out (possibly at another gate).
CREATE TABLE staff_attendance (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    township_id    UUID NOT NULL,
    staff_id       UUID NOT NULL,
    gate_id        UUID NOT NULL,
    exit_gate_id   UUID,
    checked_in_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    checked_out_at TIMESTAMPTZ,
    logged_by      UUID REFERENCES app_user(id),
    CONSTRAINT attendance_order CHECK (checked_out_at IS NULL OR checked_out_at >= checked_in_at),
    CONSTRAINT attendance_staff_same_township
        FOREIGN KEY (staff_id, township_id) REFERENCES staff_member(id, township_id),
    CONSTRAINT attendance_gate_same_township
        FOREIGN KEY (gate_id, township_id) REFERENCES gate(id, township_id),
    CONSTRAINT attendance_exit_gate_same_township
        FOREIGN KEY (exit_gate_id, township_id) REFERENCES gate(id, township_id)
);
-- Nobody can be inside twice at once.
CREATE UNIQUE INDEX ux_staff_one_open_stay ON staff_attendance(staff_id) WHERE checked_out_at IS NULL;
CREATE INDEX idx_attendance_staff    ON staff_attendance(staff_id, checked_in_at DESC);
CREATE INDEX idx_attendance_township ON staff_attendance(township_id, checked_in_at DESC);

-- One rating per household per helper, editable.
CREATE TABLE staff_rating (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    township_id UUID NOT NULL,
    staff_id    UUID NOT NULL,
    unit_id     UUID NOT NULL,
    rating      INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    review      TEXT CHECK (review IS NULL OR length(review) <= 1000),
    rated_by    UUID REFERENCES app_user(id),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT staff_rating_uq UNIQUE (staff_id, unit_id),
    CONSTRAINT rating_staff_same_township
        FOREIGN KEY (staff_id, township_id) REFERENCES staff_member(id, township_id) ON DELETE CASCADE,
    CONSTRAINT rating_unit_same_township
        FOREIGN KEY (unit_id, township_id) REFERENCES property_node(id, township_id)
);
