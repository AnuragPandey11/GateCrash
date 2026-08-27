-- V4: the property tree.
--
-- Replaces the fixed two-level building_block -> flat hierarchy with a per-township
-- recursive tree, because "township with blocks of flats" is one shape of real estate
-- project among many. A villa developer has clusters of villas and no floors at all; a
-- high-rise has towers of floors of flats; a plotted layout has sectors of plots. All of
-- them were previously forced to call a cluster a "Block" and a villa a "Flat".
--
-- Two tables carry that:
--
--   property_level -- the SHAPE of one township's tree: an ordered list of levels, each
--                     with the developer's own word for it ("Tower"/"Towers"). This is
--                     what makes the admin panel dynamic: the UI renders one tab per level
--                     using these labels rather than the hardcoded Blocks/Flats pair.
--   property_node  -- the tree itself, every node at every level in one table.
--
-- The structural `kind` is a small fixed enum the code reasons about (does this level have
-- floor numbers? is it the addressable unit?); the singular/plural on property_level are
-- pure display. That split matters: nomenclature must never become load-bearing, or
-- renaming "Flat" to "Villa" in the UI would change which rows a query matches.
--
-- MIGRATION NOTE: existing building_block and flat rows are copied into property_node
-- PRESERVING THEIR UUIDs. app_user.flat_id and visitor_log.target_flat_id therefore keep
-- their values verbatim -- only the foreign key target moves. Those two columns keep their
-- names here on purpose: renaming them to unit_id is a separate migration to run once the
-- frontend has stopped sending flatId, so that this one is a pure structural change.

-- ---------- Enums ----------
-- A new type (not a new label on an existing one), so it is safe to both create and use it
-- inside this single transaction -- unlike V2, which had to add a label on its own.

CREATE TYPE property_type AS ENUM (
    'APARTMENT',    -- towers/wings -> floors -> flats
    'VILLA',        -- clusters -> villas
    'ROW_HOUSE',    -- blocks -> row houses
    'PLOTTED',      -- sectors -> plots
    'COMMERCIAL',   -- towers -> floors -> offices/suites
    'MIXED_USE'     -- phases -> buildings -> floors -> units
);

-- GROUP    a non-physical grouping: phase, cluster, sector, pocket
-- BUILDING a physical structure: tower, wing, block
-- FLOOR    a storey within a building; the only kind that carries level_number
-- UNIT     the addressable leaf a resident lives in and a visitor is routed to
CREATE TYPE property_node_kind AS ENUM ('GROUP', 'BUILDING', 'FLOOR', 'UNIT');

-- ---------- Township profile ----------
-- The type only seeds the default level set; a developer is free to rewrite every label
-- afterwards. It is kept on the row so the console can offer sensible presets when an
-- admin adds a second phase, and so reporting can group like projects together.
ALTER TABLE township ADD COLUMN property_type property_type NOT NULL DEFAULT 'APARTMENT';

-- ---------- Level definitions (the dynamic panel) ----------
CREATE TABLE property_level (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    township_id UUID NOT NULL REFERENCES township(id) ON DELETE CASCADE,
    depth       INT  NOT NULL,
    kind        property_node_kind NOT NULL,
    singular    TEXT NOT NULL,          -- "Tower", "Villa", "Plot"
    plural      TEXT NOT NULL,          -- "Towers", "Villas", "Plots"
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT property_level_depth_ok CHECK (depth BETWEEN 0 AND 5),
    CONSTRAINT property_level_labels_ok CHECK (
        length(btrim(singular)) BETWEEN 1 AND 40 AND length(btrim(plural)) BETWEEN 1 AND 40
    ),
    CONSTRAINT property_level_depth_uq UNIQUE (township_id, depth),
    -- FK target for property_node: a node's (township, depth) must be a level that exists,
    -- and its kind must be that level's kind. Without this a township could grow a node at
    -- depth 3 while only defining three levels, and the console would have nothing to label
    -- it with.
    CONSTRAINT property_level_shape_uq UNIQUE (township_id, depth, kind)
);

-- Exactly one addressable level per township. This is what makes "the unit level" a
-- well-defined question -- residents, visits and occupancy all hang off it.
CREATE UNIQUE INDEX ux_property_level_unit ON property_level(township_id) WHERE kind = 'UNIT';

-- ---------- The tree ----------
CREATE TABLE property_node (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    township_id UUID NOT NULL REFERENCES township(id),
    parent_id   UUID REFERENCES property_node(id),
    depth       INT  NOT NULL,
    kind        property_node_kind NOT NULL,

    name        TEXT NOT NULL,          -- "Tower A", "14", "A-1401"
    -- The addressable code, on UNIT nodes only: the string a guard types and the base of
    -- every resident login id in it ("A-1401" -> A-1401-1, A-1401-2).
    code        TEXT,
    -- Storey number on FLOOR nodes only. Signed, because basements are real: -2, -1, 0, 1.
    -- Separate from `name` so "Ground"/"G"/"GF" are one floor ordered correctly, not three.
    level_number INT,

    -- How many people live in this unit, including everyone without an app account -- the
    -- spouse, children and parents who never sign in. Counting app_user rows undercounts a
    -- four-person household to one, which is exactly the inconsistency this column fixes.
    -- Kept >= the number of active resident accounts by PropertyService, not by a constraint,
    -- because the check spans two tables.
    declared_occupancy INT NOT NULL DEFAULT 0,

    -- Materialized path of ancestor ids, '/root/child/self/'. Maintained by trigger. Makes
    -- "everything under Tower A" a prefix scan instead of a recursive CTE per notification.
    path        TEXT NOT NULL DEFAULT '',
    -- Mirrors (kind = 'UNIT'), maintained by the same trigger and pinned by a CHECK. It
    -- exists solely to be a foreign key target, so app_user.flat_id can reference the unit
    -- level specifically -- a plain FK to property_node(id) would happily let an admin file
    -- a resident under a floor or a whole tower.
    is_unit     BOOLEAN NOT NULL DEFAULT FALSE,

    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT property_node_depth_ok CHECK (depth BETWEEN 0 AND 5),
    -- Depth 0 is exactly the set of roots. Combined with the trigger's depth = parent + 1,
    -- this is what makes a cycle unrepresentable: any cycle would need a node whose depth is
    -- not one more than its parent's.
    CONSTRAINT property_node_root_ok CHECK ((parent_id IS NULL) = (depth = 0)),
    CONSTRAINT property_node_name_ok CHECK (length(btrim(name)) BETWEEN 1 AND 80),
    -- Only units are addressable, and every unit is.
    CONSTRAINT property_node_code_ok CHECK ((code IS NOT NULL) = (kind = 'UNIT')),
    CONSTRAINT property_node_code_shape CHECK (code IS NULL OR length(btrim(code)) BETWEEN 1 AND 40),
    -- Only floors carry a storey number.
    CONSTRAINT property_node_level_ok CHECK (level_number IS NULL OR kind = 'FLOOR'),
    CONSTRAINT property_node_level_range CHECK (level_number IS NULL OR level_number BETWEEN -10 AND 200),
    -- Only units house people; a tower's occupancy is the sum of its units, never stored.
    CONSTRAINT property_node_occupancy_ok CHECK (
        declared_occupancy >= 0 AND (kind = 'UNIT' OR declared_occupancy = 0)
    ),
    CONSTRAINT property_node_is_unit_ok CHECK (is_unit = (kind = 'UNIT')),

    -- Tenant backstop, same pattern as V3: the pair exists purely to be an FK target.
    CONSTRAINT property_node_tenant_uq UNIQUE (id, township_id),
    -- The triple additionally pins "and it is a unit", for app_user/visitor_log.
    CONSTRAINT property_node_unit_uq UNIQUE (id, township_id, is_unit),
    -- A node cannot be parented into another township.
    CONSTRAINT property_node_parent_same_township
        FOREIGN KEY (parent_id, township_id) REFERENCES property_node(id, township_id),
    -- A node must sit at a level its township has actually defined, with that level's kind.
    CONSTRAINT property_node_level_defined
        FOREIGN KEY (township_id, depth, kind) REFERENCES property_level(township_id, depth, kind)
);

-- Sibling names are unique case-insensitively: two "Tower A"s under the same phase is a
-- data-entry mistake, not a configuration. Roots are scoped to the township instead, since
-- their parent_id is NULL and NULLs never conflict in a unique index.
CREATE UNIQUE INDEX ux_node_sibling_name ON property_node(parent_id, lower(name))
    WHERE parent_id IS NOT NULL;
CREATE UNIQUE INDEX ux_node_root_name ON property_node(township_id, lower(name))
    WHERE parent_id IS NULL;

-- NOTE: ux_node_unit_code (unit codes unique per township) is created further down, after
-- the existing flat rows have been carried across and de-duplicated -- the old schema allowed
-- collisions this index forbids, so it cannot exist while that data is being loaded.

-- Floors within one building are one per storey number.
CREATE UNIQUE INDEX ux_node_floor_level ON property_node(parent_id, level_number)
    WHERE kind = 'FLOOR' AND level_number IS NOT NULL;

CREATE INDEX idx_node_township_depth ON property_node(township_id, depth);
CREATE INDEX idx_node_parent         ON property_node(parent_id);
CREATE INDEX idx_node_path           ON property_node(township_id, path text_pattern_ops);
CREATE INDEX idx_node_units          ON property_node(township_id) WHERE kind = 'UNIT';

-- ---------- Structural trigger ----------
-- depth, path and is_unit are derived, never supplied. Deriving them in the database rather
-- than in PropertyService is the same call V3 made with the composite foreign keys: the
-- service layer is the place bugs live, and a wrong path silently mis-targets a notification
-- to another tower rather than failing loudly.
CREATE OR REPLACE FUNCTION property_node_derive() RETURNS TRIGGER AS $$
DECLARE
    parent property_node%ROWTYPE;
BEGIN
    NEW.is_unit := (NEW.kind = 'UNIT');

    IF NEW.parent_id IS NULL THEN
        NEW.depth := 0;
        NEW.path  := '/' || NEW.id || '/';
    ELSE
        SELECT * INTO parent FROM property_node WHERE id = NEW.parent_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'parent property_node % does not exist', NEW.parent_id
                USING ERRCODE = 'foreign_key_violation';
        END IF;
        -- A unit is a leaf by definition; nothing may be filed inside someone's home.
        IF parent.kind = 'UNIT' THEN
            RAISE EXCEPTION 'property_node % is a unit and cannot have children', parent.id
                USING ERRCODE = 'check_violation';
        END IF;
        NEW.depth := parent.depth + 1;
        NEW.path  := parent.path || NEW.id || '/';
    END IF;

    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_property_node_derive
    BEFORE INSERT OR UPDATE ON property_node
    FOR EACH ROW EXECUTE FUNCTION property_node_derive();

-- Re-parenting would invalidate the stored path of every descendant. Moving a tower between
-- phases is rare enough that the honest answer for now is to refuse it, rather than ship a
-- recursive path rewrite whose failure mode is a silently mis-scoped notification audience.
CREATE OR REPLACE FUNCTION property_node_no_reparent() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.parent_id IS DISTINCT FROM OLD.parent_id THEN
        RAISE EXCEPTION 'property_node % cannot be re-parented', OLD.id
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.township_id IS DISTINCT FROM OLD.township_id THEN
        RAISE EXCEPTION 'property_node % cannot change township', OLD.id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_property_node_no_reparent
    BEFORE UPDATE ON property_node
    FOR EACH ROW EXECUTE FUNCTION property_node_no_reparent();

-- ---------- Carry the existing hierarchy across ----------
-- Every existing township is an APARTMENT project whose tree happens to be two levels deep
-- and has no floors -- which is precisely what the old schema could express. Seeding the
-- levels with "Block"/"Flat" keeps every existing console label reading exactly as it does
-- today; a developer who wants "Tower"/"Apartment" edits them afterwards.
INSERT INTO property_level (township_id, depth, kind, singular, plural)
SELECT id, 0, 'BUILDING'::property_node_kind, 'Block', 'Blocks' FROM township
UNION ALL
SELECT id, 1, 'UNIT'::property_node_kind, 'Flat', 'Flats' FROM township;

-- IDs are preserved, so every existing app_user.flat_id and visitor_log.target_flat_id stays
-- valid without being rewritten. The trigger fills depth/path/is_unit.
INSERT INTO property_node (id, township_id, parent_id, depth, kind, name, code, created_at)
SELECT b.id, b.township_id, NULL, 0, 'BUILDING'::property_node_kind, b.name, NULL, b.created_at
FROM building_block b;

INSERT INTO property_node (id, township_id, parent_id, depth, kind, name, code, created_at)
SELECT f.id, f.township_id, f.block_id, 1, 'UNIT'::property_node_kind, f.number, f.number, f.created_at
FROM flat f;

-- Two blocks could each hold a "101" under the old per-block uniqueness, and ux_node_unit_code
-- forbids that. Disambiguate by prefixing the parent's name -- what an admin would have done
-- had the constraint always existed. The oldest row keeps the bare code, so the resident whose
-- login id was minted first ("101-1") keeps matching their unit. A no-op on unique data.
--
-- Residents of a renamed unit keep their existing login id -- it is deliberately immutable
-- (every sign-in card already handed out carries it), so a resident of the renamed "Block B-101"
-- still signs in as "101-1". The two only have to agree at the moment the id is minted; after
-- that the flat_id foreign key, not the string, is what links them. Newly provisioned residents
-- of that unit get "Block B-101-1" onward.
WITH dupes AS (
    SELECT n.id, b.name AS parent_name,
           row_number() OVER (PARTITION BY n.township_id, lower(n.code) ORDER BY n.created_at, n.id) AS rn
    FROM property_node n
    JOIN property_node b ON b.id = n.parent_id
    WHERE n.kind = 'UNIT'
)
UPDATE property_node n
SET code = d.parent_name || '-' || n.code,
    name = d.parent_name || '-' || n.name
FROM dupes d
WHERE n.id = d.id AND d.rn > 1;

-- Safe to enforce now that the carried-over data has been repaired. If a township somehow
-- still holds a collision (a unit literally named "Block B-101" alongside the generated one),
-- this fails the migration loudly rather than letting two units share a login id namespace.
CREATE UNIQUE INDEX ux_node_unit_code ON property_node(township_id, lower(code))
    WHERE kind = 'UNIT';

-- ---------- Repoint the references ----------
-- The columns keep their names; only what they point at changes.

-- app_user: a resident belongs to a unit. The generated column is NULL when flat_id is NULL,
-- and a composite foreign key with a NULL member is not enforced (MATCH SIMPLE) -- so guards
-- and admins, who have no unit, still pass while residents are pinned to is_unit = TRUE.
ALTER TABLE app_user DROP CONSTRAINT user_flat_same_township;
ALTER TABLE app_user DROP CONSTRAINT app_user_flat_id_fkey;
ALTER TABLE app_user ADD COLUMN flat_is_unit BOOLEAN
    GENERATED ALWAYS AS (CASE WHEN flat_id IS NULL THEN NULL ELSE TRUE END) STORED;
ALTER TABLE app_user ADD CONSTRAINT user_unit_same_township
    FOREIGN KEY (flat_id, township_id, flat_is_unit)
    REFERENCES property_node(id, township_id, is_unit);

ALTER TABLE visitor_log DROP CONSTRAINT visit_flat_same_township;
ALTER TABLE visitor_log DROP CONSTRAINT visitor_log_target_flat_id_fkey;
ALTER TABLE visitor_log ADD COLUMN target_flat_is_unit BOOLEAN
    GENERATED ALWAYS AS (CASE WHEN target_flat_id IS NULL THEN NULL ELSE TRUE END) STORED;
ALTER TABLE visitor_log ADD CONSTRAINT visit_unit_same_township
    FOREIGN KEY (target_flat_id, township_id, target_flat_is_unit)
    REFERENCES property_node(id, township_id, is_unit);

DROP TABLE flat;
DROP TABLE building_block;
