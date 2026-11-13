package com.gatecrash.push;

import com.gatecrash.device.DeviceService;
import com.gatecrash.realtime.RealtimeEvents;
import com.gatecrash.realtime.RealtimeService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.Collection;
import java.util.Map;
import java.util.UUID;

/**
 * Tells specific people that something they care about changed -- a reply on their ticket, a
 * decision on their move, a cancelled booking.
 *
 * <p>Two channels, as everywhere else in the product: a WebSocket frame on the person's private
 * queue so an open screen refreshes at once, and an FCM push so a phone in a pocket buzzes. Callers
 * invoke this through {@code AfterCommitExecutor}, so nobody is told about a change that rolled back.
 */
@Service
@RequiredArgsConstructor
public class UserNotifier {

    private final DeviceService devices;
    private final FcmService fcm;
    private final RealtimeService realtime;

    public void notify(Collection<UUID> userIds, String kind, UUID entityId, String title, String body) {
        if (userIds.isEmpty()) {
            return;
        }
        RealtimeEvents.ServiceUpdateEvent event =
                RealtimeEvents.ServiceUpdateEvent.of(kind, entityId, title, body);
        userIds.forEach(userId -> realtime.toUser(userId, RealtimeService.QUEUE_NOTIFICATIONS, event));
        fcm.push(devices.tokensFor(userIds), PushPayload.of(
                PushPayload.TYPE_SERVICE_UPDATE, title, body,
                Map.of("kind", kind, "id", entityId.toString())));
    }
}
