package com.gatecrash.pass;

/** Maps 1:1 to the Postgres {@code pass_type} enum (V8). */
public enum PassType {
    /**
     * A single visit: accepted from an hour before the expected arrival until the out time the
     * resident gave, once (or up to {@code max_uses} for a group).
     */
    ONE_TIME,
    /**
     * A regular visitor -- a tutor, a cook, a physiotherapist. Accepted any number of times at any
     * hour inside its date range; each visit carries the pass's expected duration.
     */
    FREQUENT
}
