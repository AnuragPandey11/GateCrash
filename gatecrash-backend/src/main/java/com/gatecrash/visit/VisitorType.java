package com.gatecrash.visit;

/** Maps 1:1 to the Postgres {@code visitor_type} enum. */
public enum VisitorType {
    GUEST,
    DELIVERY,
    MAINTENANCE,
    /** Always routed to a sales agent; enforced by the {@code client_routes_to_sales} constraint. */
    CLIENT
}
