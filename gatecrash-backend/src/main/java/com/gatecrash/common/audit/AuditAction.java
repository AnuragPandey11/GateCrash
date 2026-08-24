package com.gatecrash.common.audit;

/**
 * The closed vocabulary of audited actions. Kept as constants rather than free strings so the trail
 * stays queryable and a typo cannot silently create a new action name.
 */
public final class AuditAction {

    // identity
    public static final String USER_PROVISIONED = "USER_PROVISIONED";
    public static final String USER_PASSWORD_RESET = "USER_PASSWORD_RESET";
    public static final String USER_PASSWORD_CHANGED = "USER_PASSWORD_CHANGED";
    public static final String USER_UPDATED = "USER_UPDATED";
    public static final String USER_DEACTIVATED = "USER_DEACTIVATED";
    public static final String USER_REACTIVATED = "USER_REACTIVATED";
    public static final String LOGIN_SUCCEEDED = "LOGIN_SUCCEEDED";
    public static final String LOGIN_FAILED = "LOGIN_FAILED";
    public static final String LOGIN_LOCKED_OUT = "LOGIN_LOCKED_OUT";
    public static final String REFRESH_ROTATED = "REFRESH_ROTATED";
    public static final String REFRESH_REUSE_DETECTED = "REFRESH_REUSE_DETECTED";
    public static final String LOGOUT = "LOGOUT";

    // township
    public static final String BLOCK_CREATED = "BLOCK_CREATED";
    public static final String BLOCK_DELETED = "BLOCK_DELETED";
    public static final String FLAT_CREATED = "FLAT_CREATED";
    public static final String FLAT_DELETED = "FLAT_DELETED";
    public static final String GATE_CREATED = "GATE_CREATED";
    public static final String GATE_DELETED = "GATE_DELETED";
    public static final String DUTY_CHANGED = "DUTY_CHANGED";

    // devices
    public static final String DEVICE_REGISTERED = "DEVICE_REGISTERED";
    public static final String DEVICE_REMOVED = "DEVICE_REMOVED";

    // visits
    public static final String VISIT_LOGGED = "VISIT_LOGGED";
    public static final String VISIT_APPROVED = "VISIT_APPROVED";
    public static final String VISIT_REJECTED = "VISIT_REJECTED";
    public static final String VISIT_CHECKED_IN = "VISIT_CHECKED_IN";
    public static final String VISIT_CHECKED_OUT = "VISIT_CHECKED_OUT";
    public static final String VISIT_EXPIRED = "VISIT_EXPIRED";

    // passes
    public static final String PASS_CREATED = "PASS_CREATED";
    public static final String PASS_REDEEMED = "PASS_REDEEMED";
    public static final String PASS_REDEEM_FAILED = "PASS_REDEEM_FAILED";
    public static final String PASS_REVOKED = "PASS_REVOKED";
    public static final String PASS_EXPIRED = "PASS_EXPIRED";

    // notifications & community
    public static final String NOTIFICATION_SENT = "NOTIFICATION_SENT";
    public static final String NOTIFICATION_FAILED = "NOTIFICATION_FAILED";
    public static final String POST_CREATED = "POST_CREATED";
    public static final String POST_DELETED = "POST_DELETED";

    private AuditAction() {
    }
}
