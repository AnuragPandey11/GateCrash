-- =====================================================================================
-- V9: five more project shapes for onboarding.
--
--   HOUSING_SOCIETY       Wing -> Floor -> Flat        (cooperative housing societies)
--   RESIDENTIAL_COLONY    Block -> House               (independent houses run by an RWA)
--   BUILDER_FLOOR         Plot -> Floor (as the home)  (low-rise builder floors)
--   MARKET                Row -> Shop                  (markets and shopping streets)
--   INSTITUTIONAL_CAMPUS  Building -> Floor -> Room    (schools, hospitals, hostels)
--
-- Labels only, in their own migration: PostgreSQL cannot use an enum value in the transaction that
-- adds it (the same reason as V2 and V5). The level sets live in PropertyType.java.
-- =====================================================================================

ALTER TYPE property_type ADD VALUE IF NOT EXISTS 'HOUSING_SOCIETY';
ALTER TYPE property_type ADD VALUE IF NOT EXISTS 'RESIDENTIAL_COLONY';
ALTER TYPE property_type ADD VALUE IF NOT EXISTS 'BUILDER_FLOOR';
ALTER TYPE property_type ADD VALUE IF NOT EXISTS 'MARKET';
ALTER TYPE property_type ADD VALUE IF NOT EXISTS 'INSTITUTIONAL_CAMPUS';
