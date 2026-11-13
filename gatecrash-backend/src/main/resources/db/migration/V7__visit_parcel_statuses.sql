-- =====================================================================================
-- V7: the "Leave at Gate" outcome of a walk-in.
--
-- A resident who cannot come down can tell the guard to keep a delivery at the gate. The visit
-- then ends in LEFT_AT_GATE (the courier leaves, the parcel stays with security) and moves to
-- COLLECTED once a resident shows the guard the collection code.
--
-- Labels only, in their own migration: PostgreSQL cannot *use* an enum value in the transaction
-- that adds it, and Flyway runs one transaction per migration (same reason as V2 and V5).
-- =====================================================================================

ALTER TYPE visit_status ADD VALUE IF NOT EXISTS 'LEFT_AT_GATE';
ALTER TYPE visit_status ADD VALUE IF NOT EXISTS 'COLLECTED';
