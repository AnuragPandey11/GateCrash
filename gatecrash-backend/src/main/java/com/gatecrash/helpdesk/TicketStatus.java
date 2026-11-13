package com.gatecrash.helpdesk;

import java.util.EnumSet;
import java.util.Map;
import java.util.Set;

/**
 * Maps 1:1 to the Postgres {@code ticket_status} enum (V8), with its transitions alongside.
 *
 * <p>OPEN -> IN_PROGRESS -> RESOLVED is the office's path. A resident can reopen a resolved ticket
 * that is not actually fixed, and can close their own ticket at any point. CLOSED is final.
 */
public enum TicketStatus {
    OPEN,
    IN_PROGRESS,
    RESOLVED,
    CLOSED;

    private static final Map<TicketStatus, Set<TicketStatus>> TRANSITIONS = Map.of(
            OPEN, EnumSet.of(IN_PROGRESS, RESOLVED, CLOSED),
            IN_PROGRESS, EnumSet.of(RESOLVED, CLOSED),
            RESOLVED, EnumSet.of(OPEN, CLOSED),
            CLOSED, EnumSet.noneOf(TicketStatus.class));

    public boolean canTransitionTo(TicketStatus target) {
        return TRANSITIONS.getOrDefault(this, Set.of()).contains(target);
    }
}
