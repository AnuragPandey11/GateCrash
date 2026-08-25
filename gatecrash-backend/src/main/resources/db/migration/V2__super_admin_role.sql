-- =====================================================================================
-- Adds the platform-level SUPER_ADMIN role to the user_role enum.
--
-- This is deliberately a migration of its own. PostgreSQL 12+ permits
-- ALTER TYPE ... ADD VALUE inside a transaction block, but the new label cannot be
-- *used* until that transaction commits. Flyway runs each migration in its own
-- transaction, so splitting the label addition from everything that references it
-- (V3) is what makes the pair applicable in a single `flyway migrate` run.
-- =====================================================================================

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'SUPER_ADMIN';
