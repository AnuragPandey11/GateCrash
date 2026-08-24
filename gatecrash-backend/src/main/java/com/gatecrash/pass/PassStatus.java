package com.gatecrash.pass;

import java.util.EnumSet;
import java.util.Map;
import java.util.Set;

/**
 * Pass lifecycle: {@code ACTIVE -> {REDEEMED | EXPIRED | REVOKED}}. Terminal states are final --
 * a revoked pass is never reactivated, it is replaced.
 */
public enum PassStatus {

    ACTIVE,
    REDEEMED,
    EXPIRED,
    REVOKED;

    private static final Map<PassStatus, Set<PassStatus>> TRANSITIONS = Map.of(
            ACTIVE, EnumSet.of(REDEEMED, EXPIRED, REVOKED),
            REDEEMED, EnumSet.noneOf(PassStatus.class),
            EXPIRED, EnumSet.noneOf(PassStatus.class),
            REVOKED, EnumSet.noneOf(PassStatus.class));

    public boolean canTransitionTo(PassStatus target) {
        return TRANSITIONS.getOrDefault(this, Set.of()).contains(target);
    }
}
