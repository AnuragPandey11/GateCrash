package com.gatecrash.push;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * A push message, built as an FCM <em>data</em> message rather than a notification message.
 *
 * <p>That distinction matters operationally: a notification-only message is rendered by the OS and
 * the app never sees it while backgrounded, so the guard-approval card could not be drawn with its
 * Approve/Reject actions. A data message wakes the app and lets it render its own heads-up.
 *
 * <p>FCM data values must be strings, and the whole payload is capped at 4 KB. Nothing sensitive
 * belongs here -- push payloads traverse Google's infrastructure and land on a possibly locked screen,
 * so this carries identifiers and display text only, never PINs, tokens or contact details.
 */
public record PushPayload(String type, String title, String body, Map<String, String> data) {

    public static final String TYPE_VISIT_REQUESTED = "VISIT_REQUESTED";
    public static final String TYPE_VISIT_DECIDED = "VISIT_DECIDED";
    public static final String TYPE_VISIT_EXPIRED = "VISIT_EXPIRED";
    public static final String TYPE_PASS_REDEEMED = "PASS_REDEEMED";
    public static final String TYPE_ANNOUNCEMENT = "ANNOUNCEMENT";
    public static final String TYPE_OVERSTAY_ALERT = "OVERSTAY_ALERT";
    public static final String TYPE_SERVICE_UPDATE = "SERVICE_UPDATE";

    public PushPayload {
        data = data == null ? Map.of() : Map.copyOf(data);
    }

    /** Flattens the payload into the string map FCM accepts, with type/title/body as reserved keys. */
    public Map<String, String> asDataMap() {
        Map<String, String> map = new LinkedHashMap<>();
        map.put("type", type);
        if (title != null) {
            map.put("title", title);
        }
        if (body != null) {
            map.put("body", body);
        }
        data.forEach((key, value) -> {
            if (value != null) {
                map.put(key, value);
            }
        });
        return map;
    }

    public static PushPayload of(String type, String title, String body, Map<String, String> data) {
        return new PushPayload(type, title, body, data);
    }
}
