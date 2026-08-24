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
    public static final String TOPIC_ADMIN_INSIDE = "/topic/admin/inside";
    public static final String QUEUE_VISITS = "/queue/visits";
    public static final String QUEUE_NOTIFICATIONS = "/queue/notifications";

    private final SimpMessagingTemplate messaging;

    /** Broadcasts to every guard tablet watching this gate. */
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

    public void toAdminInside(Object event) {
        send(TOPIC_ADMIN_INSIDE, event);
    }

    private void send(String destination, Object event) {
        try {
            messaging.convertAndSend(destination, event);
        } catch (MessagingException ex) {
            log.warn("Failed to publish to {}: {}", destination, ex.getMessage());
        }
    }
}
