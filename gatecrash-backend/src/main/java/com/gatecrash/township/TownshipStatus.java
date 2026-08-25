package com.gatecrash.township;

/**
 * Lifecycle of a tenant. Maps 1:1 to the Postgres {@code township_status} enum.
 *
 * <p>There is no DELETED member on purpose. Archiving is how a township leaves the platform: the
 * visitor log and audit trail are the record of who was let through a gate and who authorised it,
 * and destroying them to tidy up a cancelled customer is not a trade this system makes.
 */
public enum TownshipStatus {

    /** Normal operation. */
    ACTIVE,

    /** Temporarily barred -- nobody in the township can sign in, but nothing is torn down. */
    SUSPENDED,

    /** Retired. Same effect as SUSPENDED for sign-in, plus it drops out of the default listing. */
    ARCHIVED;

    /** Only an ACTIVE township accepts logins and serves requests. */
    public boolean allowsAccess() {
        return this == ACTIVE;
    }
}
