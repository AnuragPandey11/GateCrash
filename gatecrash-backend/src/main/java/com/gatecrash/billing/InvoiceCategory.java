package com.gatecrash.billing;

/** Maps 1:1 to the Postgres {@code invoice_category} enum (V8). */
public enum InvoiceCategory {
    MAINTENANCE,
    ELECTRICITY,
    WATER,
    PARKING,
    AMENITY,
    PENALTY,
    OTHER
}
