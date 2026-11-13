package com.gatecrash.move;

import java.util.EnumSet;
import java.util.Map;
import java.util.Set;

/**
 * Maps 1:1 to the Postgres {@code move_status} enum (V8), with its transitions alongside.
 *
 * <p>PENDING is decided by the office (APPROVED or REJECTED). The resident may cancel while it is
 * pending or approved. An approved move is marked COMPLETED by the office once it has happened.
 */
public enum MoveStatus {
    PENDING,
    APPROVED,
    REJECTED,
    CANCELLED,
    COMPLETED;

    private static final Map<MoveStatus, Set<MoveStatus>> TRANSITIONS = Map.of(
            PENDING, EnumSet.of(APPROVED, REJECTED, CANCELLED),
            APPROVED, EnumSet.of(COMPLETED, CANCELLED),
            REJECTED, EnumSet.noneOf(MoveStatus.class),
            CANCELLED, EnumSet.noneOf(MoveStatus.class),
            COMPLETED, EnumSet.noneOf(MoveStatus.class));

    public boolean canTransitionTo(MoveStatus target) {
        return TRANSITIONS.getOrDefault(this, Set.of()).contains(target);
    }
}
