-- =====================================================================================
-- V8: gate flows (durations, overstay, parcel codes, richer passes) and the resident services
--     that sit beside them — help desk, amenities, move-in/move-out, bills.
--
-- Every new table follows the tenancy pattern of V3/V4: a township_id on every row, and
-- composite (id, township_id) foreign keys so a row can never point across a tenant boundary
-- even if the service layer is bypassed.
-- =====================================================================================

-- ---------- Visits: expected duration, overstay, Leave at Gate ----------

ALTER TABLE visitor_log
    ADD COLUMN purpose                   TEXT,
    ADD COLUMN expected_duration_minutes INT,
    ADD COLUMN expected_out_at           TIMESTAMPTZ,
    ADD COLUMN overstay_alerted_at       TIMESTAMPTZ,
    ADD COLUMN collection_code_lookup    TEXT,
    ADD COLUMN collected_at              TIMESTAMPTZ,
    ADD CONSTRAINT visit_duration_range
        CHECK (expected_duration_minutes IS NULL OR expected_duration_minutes BETWEEN 5 AND 10080);

-- The overstay sweep's hot path: inside, past the expected exit, not yet alerted.
CREATE INDEX idx_visit_overstay ON visitor_log(expected_out_at)
    WHERE status = 'CHECKED_IN' AND overstay_alerted_at IS NULL;

-- ---------- Passes: one-time vs frequent, and the same details a walk-in carries ----------

CREATE TYPE pass_type AS ENUM ('ONE_TIME', 'FREQUENT');

ALTER TABLE pre_approval
    ADD COLUMN pass_type                 pass_type NOT NULL DEFAULT 'ONE_TIME',
    ADD COLUMN purpose                   TEXT,
    ADD COLUMN vehicle_no                TEXT,
    ADD COLUMN expected_arrival_at       TIMESTAMPTZ,
    ADD COLUMN expected_duration_minutes INT,
    ADD CONSTRAINT pass_duration_range
        CHECK (expected_duration_minutes IS NULL OR expected_duration_minutes BETWEEN 5 AND 1440);

-- A frequent pass (a tutor, a cook) has no use limit inside its window.
ALTER TABLE pre_approval ALTER COLUMN max_uses DROP NOT NULL;
ALTER TABLE pre_approval DROP CONSTRAINT uses_ok;
ALTER TABLE pre_approval ADD CONSTRAINT uses_ok CHECK (max_uses IS NULL OR use_count <= max_uses);
ALTER TABLE pre_approval ADD CONSTRAINT frequent_is_unlimited
    CHECK ((pass_type = 'FREQUENT') = (max_uses IS NULL));
-- A frequent pass must say how long each visit lasts, or overstay could never be judged.
ALTER TABLE pre_approval ADD CONSTRAINT frequent_has_duration
    CHECK (pass_type <> 'FREQUENT' OR expected_duration_minutes IS NOT NULL);

-- ---------- Help desk ----------

CREATE TYPE ticket_status   AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');
CREATE TYPE ticket_category AS ENUM ('MAINTENANCE', 'PLUMBING', 'ELECTRICAL', 'HOUSEKEEPING',
                                     'SECURITY', 'PARKING', 'BILLING', 'OTHER');

CREATE TABLE support_ticket (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    township_id UUID NOT NULL REFERENCES township(id),
    raised_by   UUID NOT NULL,
    unit_id     UUID,
    category    ticket_category NOT NULL,
    subject     TEXT NOT NULL CHECK (length(subject) BETWEEN 1 AND 160),
    description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 4000),
    status      ticket_status NOT NULL DEFAULT 'OPEN',
    resolved_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    version     BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT ticket_tenant_uq UNIQUE (id, township_id),
    CONSTRAINT ticket_raiser_same_township
        FOREIGN KEY (raised_by, township_id) REFERENCES app_user(id, township_id),
    CONSTRAINT ticket_unit_same_township
        FOREIGN KEY (unit_id, township_id) REFERENCES property_node(id, township_id)
);
CREATE INDEX idx_ticket_township ON support_ticket(township_id, status, created_at DESC);
CREATE INDEX idx_ticket_raiser   ON support_ticket(raised_by, created_at DESC);

-- author_id keeps a plain foreign key: a super admin replying inside a township is a legitimate
-- author and has no township_id (the same reasoning as community_post.author_id in V3).
CREATE TABLE ticket_message (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    township_id UUID NOT NULL,
    ticket_id   UUID NOT NULL,
    author_id   UUID NOT NULL REFERENCES app_user(id),
    from_staff  BOOLEAN NOT NULL,
    body        TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT message_ticket_same_township
        FOREIGN KEY (ticket_id, township_id) REFERENCES support_ticket(id, township_id) ON DELETE CASCADE
);
CREATE INDEX idx_ticket_message ON ticket_message(ticket_id, created_at);

-- ---------- Amenities ----------

CREATE TYPE booking_status AS ENUM ('CONFIRMED', 'CANCELLED');

CREATE TABLE amenity (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    township_id  UUID NOT NULL REFERENCES township(id),
    name         TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
    description  TEXT,
    capacity     INT  NOT NULL CHECK (capacity BETWEEN 1 AND 500),
    open_time    TIME NOT NULL,
    close_time   TIME NOT NULL,
    slot_minutes INT  NOT NULL CHECK (slot_minutes BETWEEN 15 AND 480),
    max_slots_per_booking INT NOT NULL DEFAULT 2 CHECK (max_slots_per_booking BETWEEN 1 AND 12),
    active       BOOLEAN NOT NULL DEFAULT true,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT amenity_tenant_uq UNIQUE (id, township_id),
    CONSTRAINT amenity_hours CHECK (close_time > open_time)
);
CREATE UNIQUE INDEX ux_amenity_name ON amenity(township_id, lower(name));

CREATE TABLE amenity_booking (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    township_id   UUID NOT NULL,
    amenity_id    UUID NOT NULL,
    booked_by     UUID NOT NULL,
    unit_id       UUID,
    starts_at     TIMESTAMPTZ NOT NULL,
    ends_at       TIMESTAMPTZ NOT NULL,
    guests        INT NOT NULL DEFAULT 1 CHECK (guests BETWEEN 1 AND 50),
    note          TEXT,
    status        booking_status NOT NULL DEFAULT 'CONFIRMED',
    cancel_reason TEXT,
    cancelled_at  TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT booking_window CHECK (ends_at > starts_at),
    CONSTRAINT booking_amenity_same_township
        FOREIGN KEY (amenity_id, township_id) REFERENCES amenity(id, township_id),
    CONSTRAINT booking_user_same_township
        FOREIGN KEY (booked_by, township_id) REFERENCES app_user(id, township_id),
    CONSTRAINT booking_unit_same_township
        FOREIGN KEY (unit_id, township_id) REFERENCES property_node(id, township_id)
);
CREATE INDEX idx_booking_amenity_time ON amenity_booking(amenity_id, starts_at)
    WHERE status = 'CONFIRMED';
CREATE INDEX idx_booking_user ON amenity_booking(booked_by, starts_at DESC);

-- ---------- Move-in / move-out ----------

CREATE TYPE move_type   AS ENUM ('MOVE_IN', 'MOVE_OUT');
CREATE TYPE move_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'COMPLETED');

CREATE TABLE move_request (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    township_id     UUID NOT NULL,
    unit_id         UUID NOT NULL,
    requested_by    UUID NOT NULL,
    move_type       move_type NOT NULL,
    move_date       DATE NOT NULL,
    time_from       TIME NOT NULL,
    time_to         TIME NOT NULL,
    vehicle_details TEXT,
    helpers_count   INT CHECK (helpers_count IS NULL OR helpers_count BETWEEN 0 AND 50),
    notes           TEXT,
    status          move_status NOT NULL DEFAULT 'PENDING',
    admin_note      TEXT,
    decided_by      UUID REFERENCES app_user(id),
    decided_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    version         BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT move_window CHECK (time_to > time_from),
    CONSTRAINT move_unit_same_township
        FOREIGN KEY (unit_id, township_id) REFERENCES property_node(id, township_id),
    CONSTRAINT move_requester_same_township
        FOREIGN KEY (requested_by, township_id) REFERENCES app_user(id, township_id)
);
CREATE INDEX idx_move_township ON move_request(township_id, status, move_date);
CREATE INDEX idx_move_requester ON move_request(requested_by, created_at DESC);

-- ---------- Bills ----------

CREATE TYPE invoice_status   AS ENUM ('UNPAID', 'PAID');
CREATE TYPE invoice_category AS ENUM ('MAINTENANCE', 'ELECTRICITY', 'WATER', 'PARKING',
                                      'AMENITY', 'PENALTY', 'OTHER');

-- Money is stored in paise (minor units) as BIGINT: never a float for currency.
CREATE TABLE invoice (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    township_id       UUID NOT NULL,
    unit_id           UUID NOT NULL,
    category          invoice_category NOT NULL,
    title             TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
    period_label      TEXT,
    amount_paise      BIGINT NOT NULL CHECK (amount_paise > 0),
    due_date          DATE,
    status            invoice_status NOT NULL DEFAULT 'UNPAID',
    paid_at           TIMESTAMPTZ,
    payment_method    TEXT,
    payment_reference TEXT,
    receipt_no        TEXT,
    created_by        UUID REFERENCES app_user(id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT invoice_paid_has_date CHECK ((status = 'PAID') = (paid_at IS NOT NULL)),
    CONSTRAINT invoice_unit_same_township
        FOREIGN KEY (unit_id, township_id) REFERENCES property_node(id, township_id)
);
CREATE INDEX idx_invoice_unit     ON invoice(unit_id, status, created_at DESC);
CREATE INDEX idx_invoice_township ON invoice(township_id, status, created_at DESC);
CREATE UNIQUE INDEX ux_invoice_receipt ON invoice(township_id, receipt_no) WHERE receipt_no IS NOT NULL;
