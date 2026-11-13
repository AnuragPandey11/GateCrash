package com.gatecrash.visit;

/**
 * Maps 1:1 to the Postgres {@code visitor_type} enum.
 *
 * <p>There is no CLIENT type any more (V6). Whether a visitor came to meet the sales team is the
 * {@code meetSalesAgent} tick-box on the visit, independent of what kind of visitor they are.
 */
public enum VisitorType {
    GUEST,
    DELIVERY,
    MAINTENANCE
}
