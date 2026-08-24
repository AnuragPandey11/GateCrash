package com.gatecrash.visit;

import java.util.EnumSet;
import java.util.Map;
import java.util.Set;

/**
 * The visit state machine, with its legal transitions declared alongside it.
 *
 * <p>Keeping the transition table here rather than scattering {@code if (status == ...)} checks
 * through the service means there is exactly one place to read, review and test the machine -- and
 * exactly one place a new state has to be wired into. The DB's {@code visit_status} enum and the
 * service's guard both derive from this; an illegal transition surfaces as 409, never as a silent
 * overwrite.
 */
public enum VisitStatus {

    PENDING,
    APPROVED,
    REJECTED,
    EXPIRED,
    CHECKED_IN,
    CHECKED_OUT;

    private static final Map<VisitStatus, Set<VisitStatus>> TRANSITIONS = Map.of(
            PENDING, EnumSet.of(APPROVED, REJECTED, EXPIRED),
            // A pass redemption creates a visit directly in CHECKED_IN, so APPROVED -> CHECKED_IN is
            // the only forward edge here.
            APPROVED, EnumSet.of(CHECKED_IN, EXPIRED),
            CHECKED_IN, EnumSet.of(CHECKED_OUT),
            REJECTED, EnumSet.noneOf(VisitStatus.class),
            EXPIRED, EnumSet.noneOf(VisitStatus.class),
            CHECKED_OUT, EnumSet.noneOf(VisitStatus.class));

    public boolean canTransitionTo(VisitStatus target) {
        return TRANSITIONS.getOrDefault(this, Set.of()).contains(target);
    }

    /** Terminal states never change again; useful for filtering historical queries. */
    public boolean isTerminal() {
        return TRANSITIONS.getOrDefault(this, Set.of()).isEmpty();
    }
}
