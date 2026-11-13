package com.gatecrash.user;

/** Maps 1:1 to the Postgres {@code user_role} enum. Ordinals are never persisted. */
public enum UserRole {

    /**
     * Platform operator. The only role that belongs to no township ({@code township_id IS NULL}) and
     * the only one that can create, suspend, archive or restore one. It also carries the ADMIN
     * authority into whichever township it names on the request -- see {@code AppUserDetails}.
     */
    SUPER_ADMIN,

    /** Township administrator. Everything inside one township, nothing outside it. */
    ADMIN,

    GUARD,
    RESIDENT;

    // There is deliberately no SALES role. Selling is a capability a staff account (ADMIN or GUARD)
    // carries through AppUser#sales, not an identity of its own -- see V6 and AppUserDetails.

    /** The only roles that may carry the sales flag ({@code sales_is_staff} in V6). */
    public boolean canBeSales() {
        return this == ADMIN || this == GUARD;
    }

    /** True for the roles that administer a township, whether scoped to one or acting across all. */
    public boolean isAdministrative() {
        return this == ADMIN || this == SUPER_ADMIN;
    }
}
