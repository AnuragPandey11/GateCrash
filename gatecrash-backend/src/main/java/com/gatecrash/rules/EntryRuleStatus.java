package com.gatecrash.rules;

import java.util.EnumSet;
import java.util.Map;
import java.util.Set;

/**
 * Maps 1:1 to the Postgres {@code entry_rule_status} enum (V10), with its transitions alongside.
 *
 * <p>PENDING is the office's to decide. A resident of the home may withdraw a rule that is pending
 * or approved (CANCELLED); the office may revoke one it approved (REVOKED). Only APPROVED ever
 * admits anyone.
 */
public enum EntryRuleStatus {
    PENDING,
    APPROVED,
    REJECTED,
    CANCELLED,
    REVOKED;

    private static final Map<EntryRuleStatus, Set<EntryRuleStatus>> TRANSITIONS = Map.of(
            PENDING, EnumSet.of(APPROVED, REJECTED, CANCELLED),
            APPROVED, EnumSet.of(CANCELLED, REVOKED),
            REJECTED, EnumSet.noneOf(EntryRuleStatus.class),
            CANCELLED, EnumSet.noneOf(EntryRuleStatus.class),
            REVOKED, EnumSet.noneOf(EntryRuleStatus.class));

    public boolean canTransitionTo(EntryRuleStatus target) {
        return TRANSITIONS.getOrDefault(this, Set.of()).contains(target);
    }
}
