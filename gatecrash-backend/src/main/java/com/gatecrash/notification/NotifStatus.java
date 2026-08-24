package com.gatecrash.notification;

/** Maps 1:1 to the Postgres {@code notif_status} enum. */
public enum NotifStatus {
    QUEUED,
    SENT,
    FAILED
}
