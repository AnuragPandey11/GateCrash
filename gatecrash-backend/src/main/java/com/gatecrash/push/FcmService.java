package com.gatecrash.push;

import com.gatecrash.device.DeviceService;
import com.google.firebase.messaging.AndroidConfig;
import com.google.firebase.messaging.ApnsConfig;
import com.google.firebase.messaging.Aps;
import com.google.firebase.messaging.BatchResponse;
import com.google.firebase.messaging.FirebaseMessaging;
import com.google.firebase.messaging.FirebaseMessagingException;
import com.google.firebase.messaging.MessagingErrorCode;
import com.google.firebase.messaging.MulticastMessage;
import com.google.firebase.messaging.SendResponse;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Collection;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Fan-out to Firebase Cloud Messaging.
 *
 * <p>Three properties are load-bearing:
 *
 * <ul>
 *   <li><b>Best effort.</b> A push is a nudge, never the source of truth. Postgres holds the
 *       authoritative state and clients reconcile through {@code GET /visits/pending} and
 *       {@code /notifications/mine} on foreground. Nothing here is allowed to fail a business
 *       transaction -- every path swallows its exception after logging.</li>
 *   <li><b>Asynchronous, and after commit.</b> Callers dispatch from an after-commit hook so a push
 *       is never sent for a transaction that later rolls back, and a slow FCM round trip never holds
 *       the guard's request open.</li>
 *   <li><b>Self-cleaning.</b> FCM reports permanently dead registrations; those rows are deleted
 *       rather than retried forever.</li>
 * </ul>
 */
@Service
@RequiredArgsConstructor
public class FcmService {

    private static final Logger log = LoggerFactory.getLogger(FcmService.class);

    /** FCM's hard limit for a multicast send. */
    private static final int MAX_TOKENS_PER_BATCH = 500;

    /** Error codes that mean "this registration will never work again", as opposed to a transient fault. */
    private static final Set<MessagingErrorCode> PERMANENT_FAILURES = EnumSet.of(
            MessagingErrorCode.UNREGISTERED,
            MessagingErrorCode.INVALID_ARGUMENT,
            MessagingErrorCode.SENDER_ID_MISMATCH);

    private final ObjectProvider<FirebaseMessaging> messagingProvider;
    private final DeviceService devices;

    @Async("pushExecutor")
    public void push(Collection<String> tokens, PushPayload payload) {
        send(tokens, payload);
    }

    /**
     * Synchronous send, for callers that need the delivery counts (the notification fan-out reports
     * them back to the admin).
     *
     * @return how many tokens FCM accepted
     */
    public int send(Collection<String> tokens, PushPayload payload) {
        if (tokens == null || tokens.isEmpty()) {
            return 0;
        }
        FirebaseMessaging messaging = messagingProvider.getIfAvailable();
        if (messaging == null) {
            // Firebase disabled (local/test). Log the intent so the flow is still observable.
            log.debug("FCM disabled; would have pushed {} to {} token(s)", payload.type(), tokens.size());
            return 0;
        }

        List<String> distinct = tokens.stream().filter(token -> token != null && !token.isBlank())
                .distinct().toList();
        Map<String, String> data = payload.asDataMap();
        List<String> deadTokens = new ArrayList<>();
        int delivered = 0;

        for (int start = 0; start < distinct.size(); start += MAX_TOKENS_PER_BATCH) {
            List<String> batch = distinct.subList(start,
                    Math.min(start + MAX_TOKENS_PER_BATCH, distinct.size()));
            try {
                BatchResponse response = messaging.sendEachForMulticast(buildMessage(batch, data));
                delivered += response.getSuccessCount();
                collectDeadTokens(batch, response, deadTokens);
            } catch (FirebaseMessagingException ex) {
                log.error("FCM batch send failed for {} token(s): {}", batch.size(), ex.getMessage());
            } catch (RuntimeException ex) {
                log.error("Unexpected error pushing to FCM", ex);
            }
        }

        if (!deadTokens.isEmpty()) {
            devices.pruneTokens(deadTokens);
        }
        log.debug("FCM push {}: {}/{} delivered, {} pruned", payload.type(), delivered, distinct.size(),
                deadTokens.size());
        return delivered;
    }

    private MulticastMessage buildMessage(List<String> tokens, Map<String, String> data) {
        return MulticastMessage.builder()
                .addAllTokens(tokens)
                .putAllData(data)
                .setAndroidConfig(AndroidConfig.builder()
                        .setPriority(AndroidConfig.Priority.HIGH)
                        .build())
                .setApnsConfig(ApnsConfig.builder()
                        // content-available wakes a backgrounded iOS app for a data-only message;
                        // without it, iOS may hold the payload until the user opens the app.
                        .putHeader("apns-priority", "10")
                        .putHeader("apns-push-type", "background")
                        .setAps(Aps.builder().setContentAvailable(true).build())
                        .build())
                .build();
    }

    private void collectDeadTokens(List<String> batch, BatchResponse response, List<String> deadTokens) {
        List<SendResponse> results = response.getResponses();
        for (int i = 0; i < results.size() && i < batch.size(); i++) {
            SendResponse result = results.get(i);
            if (result.isSuccessful()) {
                continue;
            }
            FirebaseMessagingException error = result.getException();
            MessagingErrorCode code = error == null ? null : error.getMessagingErrorCode();
            if (code != null && PERMANENT_FAILURES.contains(code)) {
                deadTokens.add(batch.get(i));
            } else {
                log.warn("Transient FCM failure for one token: {}", code);
            }
        }
    }
}
