-- =====================================================================================
-- V12: a visitor may leave by a different gate than the one they came in by.
--
-- gate_id keeps meaning "the gate they entered at"; exit_gate_id records the gate where the guard
-- checked them out. Same tenancy backstop as every other gate reference: the composite key makes
-- an exit gate from another township unwritable.
-- =====================================================================================

ALTER TABLE visitor_log ADD COLUMN exit_gate_id UUID;

ALTER TABLE visitor_log
    ADD CONSTRAINT visit_exit_gate_same_township
        FOREIGN KEY (exit_gate_id, township_id) REFERENCES gate(id, township_id);
