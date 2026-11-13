package com.gatecrash.billing;

/** Maps 1:1 to the Postgres {@code invoice_status} enum (V8). */
public enum InvoiceStatus {
    UNPAID,
    PAID
}
