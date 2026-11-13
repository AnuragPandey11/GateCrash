package com.gatecrash.helpdesk;

/** Maps 1:1 to the Postgres {@code ticket_category} enum (V8). */
public enum TicketCategory {
    MAINTENANCE,
    PLUMBING,
    ELECTRICAL,
    HOUSEKEEPING,
    SECURITY,
    PARKING,
    BILLING,
    OTHER
}
