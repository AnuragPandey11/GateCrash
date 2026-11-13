-- =====================================================================================
-- V6: sales becomes a capability flag, "client" becomes a visitor tick-box, and
--     community posts become rich text.
--
-- 1. SALES is no longer a role. A sales agent is a staff account (ADMIN or GUARD) with
--    is_sales = true. The flag is what grants the sales capabilities -- duty toggle, being
--    routed "meet a sales agent" visitors, minting passes -- via a derived ROLE_SALES
--    authority in AppUserDetails. Existing SALES accounts become GUARD + is_sales.
--
-- 2. CLIENT is no longer a visitor type. Whether a visitor came to meet a sales agent is
--    recorded on the visit itself (meet_sales_agent), orthogonal to what kind of visitor
--    they are. Existing CLIENT rows become GUEST + meet_sales_agent.
--
-- 3. community_post.body is HTML from now on (sanitised server-side against an allowlist
--    before it is stored). Existing plain-text bodies are escaped and wrapped so they keep
--    rendering exactly as they did.
--
-- PostgreSQL cannot drop a label from an enum type, so both enums are rebuilt: rename the
-- old type, create the new one, re-type the columns, drop the old type. Everything that
-- compares against the old type (check constraints, partial indexes) has to be dropped
-- first and recreated afterwards, because its stored expression is typed against it.
-- =====================================================================================

-- ---------- 1. Sales flag ----------

ALTER TABLE app_user ADD COLUMN is_sales BOOLEAN NOT NULL DEFAULT false;

UPDATE app_user SET is_sales = true, role = 'GUARD' WHERE role = 'SALES';

DROP INDEX idx_sales_on_duty;
ALTER TABLE app_user DROP CONSTRAINT resident_needs_flat;
ALTER TABLE app_user DROP CONSTRAINT super_admin_is_tenantless;

ALTER TYPE user_role RENAME TO user_role_v5;
CREATE TYPE user_role AS ENUM ('SUPER_ADMIN', 'ADMIN', 'GUARD', 'RESIDENT');
ALTER TABLE app_user ALTER COLUMN role TYPE user_role USING role::text::user_role;
DROP TYPE user_role_v5;

ALTER TABLE app_user ADD CONSTRAINT resident_needs_flat
    CHECK (role <> 'RESIDENT' OR flat_id IS NOT NULL);
ALTER TABLE app_user ADD CONSTRAINT super_admin_is_tenantless
    CHECK ((role = 'SUPER_ADMIN') = (township_id IS NULL));

-- Sales is a staff capability. A resident is a party to visits, not a host of them, and a
-- super admin is never a physical party to a visit at all.
ALTER TABLE app_user ADD CONSTRAINT sales_is_staff
    CHECK (NOT is_sales OR role IN ('ADMIN', 'GUARD'));
-- Duty is a sales concept; an account that is not sales cannot be "on duty" in the dropdown.
ALTER TABLE app_user ADD CONSTRAINT on_duty_needs_sales
    CHECK (NOT is_on_duty OR is_sales);

-- The guard's on-duty dropdown stays a hot, tiny, tenant-prefixed partial-index read.
CREATE INDEX idx_sales_on_duty ON app_user(township_id) WHERE is_sales AND is_on_duty;

-- Stored audience rules are deserialised into the UserRole enum when history is read, so a
-- rule still naming SALES would break the history screen. "Only sales" becomes the new
-- SALES_TEAM mode; SALES inside a mixed list is dropped (the rule is a historical record of
-- intent, and the recipients it actually reached are materialised in notification_recipient).
UPDATE notification
   SET audience_rule = jsonb_build_object('mode', 'SALES_TEAM')
 WHERE audience_rule->>'mode' = 'ROLES'
   AND audience_rule->'roles' = '["SALES"]'::jsonb;

UPDATE notification
   SET audience_rule = jsonb_set(audience_rule, '{roles}',
         COALESCE((SELECT jsonb_agg(r) FROM jsonb_array_elements(audience_rule->'roles') r
                    WHERE r <> '"SALES"'::jsonb), '[]'::jsonb))
 WHERE audience_rule->'roles' @> '["SALES"]'::jsonb;

UPDATE notification
   SET audience_rule = jsonb_build_object('mode', 'ALL')
 WHERE audience_rule->>'mode' = 'ALL_EXCEPT'
   AND audience_rule->'roles' = '[]'::jsonb;

-- ---------- 2. Meet-sales-agent tick-box on visits ----------

ALTER TABLE visitor_log ADD COLUMN meet_sales_agent BOOLEAN NOT NULL DEFAULT false;
UPDATE visitor_log SET meet_sales_agent = true WHERE approver_kind = 'SALES';

ALTER TABLE visitor_log DROP CONSTRAINT client_routes_to_sales;

UPDATE visitor_log  SET visitor_type = 'GUEST' WHERE visitor_type = 'CLIENT';
UPDATE pre_approval SET visitor_type = 'GUEST' WHERE visitor_type = 'CLIENT';

ALTER TABLE pre_approval ALTER COLUMN visitor_type DROP DEFAULT;
ALTER TYPE visitor_type RENAME TO visitor_type_v5;
CREATE TYPE visitor_type AS ENUM ('GUEST', 'DELIVERY', 'MAINTENANCE');
ALTER TABLE visitor_log  ALTER COLUMN visitor_type TYPE visitor_type USING visitor_type::text::visitor_type;
ALTER TABLE pre_approval ALTER COLUMN visitor_type TYPE visitor_type USING visitor_type::text::visitor_type;
ALTER TABLE pre_approval ALTER COLUMN visitor_type SET DEFAULT 'GUEST';
DROP TYPE visitor_type_v5;

-- The successor of client_routes_to_sales, and stricter: a visitor who came to meet sales is
-- routed to a sales agent, and a visit routed to a sales agent is one that came to meet sales.
ALTER TABLE visitor_log ADD CONSTRAINT sales_meeting_routes_to_sales
    CHECK (approver_kind IS NULL OR meet_sales_agent = (approver_kind = 'SALES'));

CREATE INDEX idx_visit_township_sales ON visitor_log(township_id, created_at DESC)
    WHERE meet_sales_agent;

-- ---------- 3. Rich-text community posts ----------

UPDATE community_post
   SET body = '<p>'
              || replace(replace(replace(replace(body, '&', '&amp;'), '<', '&lt;'), '>', '&gt;'),
                         E'\n', '<br>')
              || '</p>';
