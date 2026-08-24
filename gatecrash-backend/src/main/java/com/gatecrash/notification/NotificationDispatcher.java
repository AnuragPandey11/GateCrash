package com.gatecrash.notification;

import com.gatecrash.device.DeviceService;
import com.gatecrash.push.FcmService;
import com.gatecrash.push.PushPayload;
import com.gatecrash.realtime.RealtimeService;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * The post-commit fan-out, kept in its own bean so its transaction boundary is real.
 *
 * <p>If this lived on {@code NotificationService} it would be invoked from a lambda on {@code this},
 * bypassing the Spring proxy -- the {@code @Transactional} would silently do nothing and the
 * delivery-flag updates would fail for want of a transaction. Separating the collaborator is the
 * standard fix, and it also keeps the "what was sent" and "how it was delivered" concerns apart.
 */
@Service
@RequiredArgsConstructor
public class NotificationDispatcher {

    private static final Logger log = LoggerFactory.getLogger(NotificationDispatcher.class);

    /** Matches FCM's multicast ceiling; also bounds each IN clause on the token lookup. */
    private static final int CHUNK_SIZE = 500;

    private final NotificationRecipientRepository recipients;
    private final DeviceService devices;
    private final FcmService fcm;
    private final RealtimeService realtime;

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void dispatch(UUID notificationId, String title, String body, List<UUID> userIds) {
        PushPayload payload = PushPayload.of(PushPayload.TYPE_ANNOUNCEMENT, title, body,
                Map.of("notificationId", notificationId.toString()));

        int delivered = 0;
        for (int start = 0; start < userIds.size(); start += CHUNK_SIZE) {
            List<UUID> chunk = userIds.subList(start, Math.min(start + CHUNK_SIZE, userIds.size()));
            List<String> tokens = devices.tokensFor(chunk);
            if (tokens.isEmpty()) {
                continue;
            }
            int accepted = fcm.send(tokens, payload);
            if (accepted > 0) {
                recipients.markDelivered(notificationId, chunk);
                delivered += accepted;
            }
        }

        // Belt and braces alongside FCM: an app that is already open updates without a push.
        Map<String, String> frame = Map.of(
                "type", PushPayload.TYPE_ANNOUNCEMENT,
                "notificationId", notificationId.toString(),
                "title", title,
                "body", body);
        userIds.forEach(userId -> realtime.toUser(userId, RealtimeService.QUEUE_NOTIFICATIONS, frame));

        log.info("Notification {} dispatched: {} device(s) accepted", notificationId, delivered);
    }
}
