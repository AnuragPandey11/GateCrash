package com.gatecrash.user;

/** Maps 1:1 to the Postgres {@code user_role} enum. Ordinals are never persisted. */
public enum UserRole {
    ADMIN,
    GUARD,
    RESIDENT,
    SALES
}
