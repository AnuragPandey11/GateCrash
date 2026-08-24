package com.gatecrash.visit;

/** Who a visit or pass is routed to. Maps 1:1 to the Postgres {@code approver_kind} enum. */
public enum ApproverKind {
    RESIDENT,
    SALES
}
