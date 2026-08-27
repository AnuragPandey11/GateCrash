-- =====================================================================================
-- Widens property_type to cover the range of projects a developer actually onboards.
--
-- V4 shipped six types, which turned out to be the shapes we happened to think of first
-- rather than the shapes that exist. A co-living operator addresses beds in rooms, a mall
-- addresses shops on levels, an industrial park addresses sheds in phases, and a student
-- hostel addresses rooms on floors -- none of which is "a township with blocks of flats"
-- wearing a different label.
--
-- The type only ever *seeds* a level set, and every label stays editable afterwards, so
-- this is about giving a super admin a sensible starting point at onboarding rather than
-- about constraining anything. The structural rules live on property_node_kind, which is
-- unchanged and deliberately still small.
--
-- Its own migration, for the reason V2 states: PostgreSQL 12+ permits
-- ALTER TYPE ... ADD VALUE inside a transaction block, but the new label cannot be *used*
-- until that transaction commits, and Flyway runs each migration in its own transaction.
-- Nothing here references the new labels; the Java preset table does, at runtime.
-- =====================================================================================

-- Residential
ALTER TYPE property_type ADD VALUE IF NOT EXISTS 'GATED_TOWNSHIP';
ALTER TYPE property_type ADD VALUE IF NOT EXISTS 'CO_LIVING';
ALTER TYPE property_type ADD VALUE IF NOT EXISTS 'STUDENT_HOUSING';
ALTER TYPE property_type ADD VALUE IF NOT EXISTS 'SENIOR_LIVING';
ALTER TYPE property_type ADD VALUE IF NOT EXISTS 'SERVICED_APARTMENT';
ALTER TYPE property_type ADD VALUE IF NOT EXISTS 'FARMHOUSE';

-- Commercial
ALTER TYPE property_type ADD VALUE IF NOT EXISTS 'IT_PARK';
ALTER TYPE property_type ADD VALUE IF NOT EXISTS 'RETAIL';
ALTER TYPE property_type ADD VALUE IF NOT EXISTS 'INDUSTRIAL';
