package com.gatecrash.realtime;

import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.messaging.MessagingException;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;

import java.util.UUID;

/**
 * Thin wrapper over {@link SimpMessagingTemplate} that owns the destination naming.
 *
 * <p>Centralising the destination strings is what lets {@code StompAuthChannelInterceptor} enforce
 * subscription authorization against the same shapes the publisher uses -- if the two drifted apart,
 * a topic could quietly become world-readable.
 *
 * <p>Delivery is best effort, exactly like FCM: a broker failure must never roll back the business
 * transaction that produced the event, so every send is guarded.
 */
@Service
@RequiredArgsConstructor
public class RealtimeService {

    private static final Logger log = LoggerFactory.getLogger(RealtimeService.class);

    public static final String TOPIC_GATE_PREFIX = "/topic/gate/";
    /**
     * Occupancy is per township, so the tenant id is part of the destination rather than a field in
     * the payload. A single shared {@code /topic/admin/inside} would deliver every township's
     * movements to every township's dashboard, and no amount of client-side filtering makes that
     * safe -- the frame has already left the server.
     */
    public static final String TOPIC_ADMIN_INSIDE_PREFIX = "/topic/admin/inside/";
    public static final String QUEUE_VISITS = "/queue/visits";
    public static final String QUEUE_NOTIFICATIONS = "/queue/notifications";

    private final SimpMessagingTemplate messaging;

    /**
     * Broadcasts to every guard tablet watching this gate. Gate ids are UUIDs and tenant-unique, so
     * the destination is already tenant-private; {@code StompAuthChannelInterceptor} is what stops a
     * guard subscribing to a gate id belonging to another township.
     */
    public void toGate(UUID gateId, Object event) {
        send(TOPIC_GATE_PREFIX + gateId, event);
    }

    /** Delivers to one user's private queue across all of their live sessions. */
    public void toUser(UUID userId, String destination, Object event) {
        try {
            messaging.convertAndSendToUser(userId.toString(), destination, event);
        } catch (MessagingException ex) {
            log.warn("Failed to deliver {} to user {}: {}", destination, userId, ex.getMessage());
        }
    }

    /** Broadcasts to the admin dashboards of one township only. */
    public void toAdminInside(UUID townshipId, Object event) {
        send(TOPIC_ADMIN_INSIDE_PREFIX + townshipId, event);
    }

    private void send(String destination, Object event) {
        try {
            messaging.convertAndSend(destination, event);
        } catch (MessagingException ex) {
            log.warn("Failed to publish to {}: {}", destination, ex.getMessage());
        }
    }
}
