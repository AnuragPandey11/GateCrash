-- =====================================================================================
-- V10: society entry rules — "let these people in without asking me".
--
-- A resident asks for a kind of visitor to be admitted to their home automatically: all
-- deliveries, deliveries from one company, a named technician, a phone number. The society office
-- approves or rejects the request. While an approved rule is in force, a walk-in the guard logs for
-- that home which matches it is approved on the spot instead of waiting on a resident.
--
-- Rules belong to the *unit*, not to the resident who asked: any resident of the home sees them
-- and they survive the requester's account being replaced.
-- =====================================================================================

CREATE TYPE entry_rule_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'REVOKED');

CREATE TABLE entry_rule (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    township_id   UUID NOT NULL,
    unit_id       UUID NOT NULL,
    requested_by  UUID NOT NULL,
    visitor_type  visitor_type NOT NULL,
    label         TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
    -- Matched case-insensitively against the walk-in's name and purpose ("Amazon", "Ramesh").
    match_text    TEXT CHECK (match_text IS NULL OR length(match_text) BETWEEN 2 AND 60),
    visitor_phone TEXT,
    -- Optional daily window in the township's local time; both or neither.
    allowed_from  TIME,
    allowed_to    TIME,
    valid_until   TIMESTAMPTZ,
    note          TEXT,
    status        entry_rule_status NOT NULL DEFAULT 'PENDING',
    admin_note    TEXT,
    decided_by    UUID REFERENCES app_user(id),
    decided_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    version       BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT entry_rule_tenant_uq UNIQUE (id, township_id),
    CONSTRAINT entry_rule_window CHECK ((allowed_from IS NULL) = (allowed_to IS NULL)
                                        AND (allowed_to IS NULL OR allowed_to > allowed_from)),
    CONSTRAINT entry_rule_unit_same_township
        FOREIGN KEY (unit_id, township_id) REFERENCES property_node(id, township_id),
    CONSTRAINT entry_rule_requester_same_township
        FOREIGN KEY (requested_by, township_id) REFERENCES app_user(id, township_id)
);
CREATE INDEX idx_entry_rule_township ON entry_rule(township_id, status, created_at DESC);
-- The gate's hot path: approved rules of one home.
CREATE INDEX idx_entry_rule_unit_active ON entry_rule(unit_id) WHERE status = 'APPROVED';

-- Which rule let a visit in, so the visitor log can say "auto-approved" and why.
ALTER TABLE visitor_log ADD COLUMN entry_rule_id UUID;
ALTER TABLE visitor_log ADD CONSTRAINT visit_rule_same_township
    FOREIGN KEY (entry_rule_id, township_id) REFERENCES entry_rule(id, township_id);
