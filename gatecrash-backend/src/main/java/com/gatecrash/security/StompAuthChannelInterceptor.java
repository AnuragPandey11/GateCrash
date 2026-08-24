package com.gatecrash.security;

import com.gatecrash.realtime.RealtimeService;
import com.gatecrash.user.UserRole;
import io.jsonwebtoken.JwtException;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Set;

/**
 * Authentication and authorization for the STOMP channel.
 *
 * <p>The HTTP handshake at {@code /ws} is deliberately public -- browsers cannot set headers on a
 * WebSocket upgrade, so the credential arrives on the first STOMP frame instead. This interceptor is
 * therefore the <em>only</em> thing standing between an anonymous socket and the live visitor feed,
 * and it enforces two separate checks:
 *
 * <ol>
 *   <li>{@code CONNECT} must carry a valid, unrevoked access token, or the session is refused.</li>
 *   <li>{@code SUBSCRIBE} must name a destination the principal is entitled to. Without this, any
 *       authenticated resident could subscribe to {@code /topic/admin/inside} and watch every
 *       movement in the township -- role checks on REST endpoints do nothing for the broker.</li>
 * </ol>
 *
 * <p>Inbound {@code SEND} is rejected wholesale: the server exposes no {@code @MessageMapping}, so a
 * client has no legitimate reason to publish, and an open broker relay would let one client push
 * forged events to another.
 *
 * <p><b>Known limitation:</b> the schema has no guard-to-gate assignment, so any guard may watch any
 * gate topic. Narrowing that needs a {@code gate_id} on {@code app_user} (or a join table) and a
 * check here; the destination shape already supports it.
 */
@Component
@RequiredArgsConstructor
public class StompAuthChannelInterceptor implements ChannelInterceptor {

    private static final Logger log = LoggerFactory.getLogger(StompAuthChannelInterceptor.class);

    private static final String AUTHORIZATION_HEADER = "Authorization";
    private static final String BEARER_PREFIX = "Bearer ";
    private static final String USER_DESTINATION_PREFIX = "/user/";

    private static final Set<UserRole> GATE_TOPIC_ROLES = Set.of(UserRole.GUARD, UserRole.ADMIN);

    private static final Set<String> USER_DESTINATIONS = Set.of(
            "/user" + RealtimeService.QUEUE_VISITS,
            "/user" + RealtimeService.QUEUE_NOTIFICATIONS);

    private final JwtService jwtService;
    private final AppUserDetailsService userDetailsService;

    @Override
    public Message<?> preSend(Message<?> message, MessageChannel channel) {
        StompHeaderAccessor accessor =
                MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);
        if (accessor == null || accessor.getCommand() == null) {
            return message;
        }

        switch (accessor.getCommand()) {
            case CONNECT -> authenticate(accessor);
            case SUBSCRIBE -> authorizeSubscription(accessor);
            case SEND -> throw denied("Client-to-server STOMP messages are not accepted.");
            default -> { /* DISCONNECT, ACK, heartbeats: nothing to authorise */ }
        }
        return message;
    }

    private void authenticate(StompHeaderAccessor accessor) {
        String token = bearerToken(accessor);
        if (token == null) {
            throw denied("Missing bearer token on STOMP CONNECT.");
        }
        try {
            JwtService.AccessToken claims = jwtService.parseAccessToken(token);
            AppUserDetails user = userDetailsService.loadById(claims.userId());

            if (!user.isEnabled() || user.getTokenVersion() != claims.tokenVersion()) {
                throw denied("Session is no longer valid.");
            }
            // A user who has not yet chosen their own password gets no live feed either.
            if (user.isMustResetPassword()) {
                throw denied("Password reset is required before connecting.");
            }

            accessor.setUser(new StompPrincipal(user));
            log.debug("STOMP session authenticated for user {} ({})", user.getId(), user.getRole());
        } catch (JwtException | IllegalArgumentException | UsernameNotFoundException ex) {
            log.debug("Rejected STOMP CONNECT: {}", ex.getMessage());
            throw denied("Invalid or expired access token.");
        }
    }

    private void authorizeSubscription(StompHeaderAccessor accessor) {
        AppUserDetails user = principal(accessor);
        String destination = accessor.getDestination();
        if (destination == null) {
            throw denied("Subscription destination is required.");
        }

        // Spring rewrites /user/** to the session's own principal, so a client can never reach
        // another user's queue through this prefix. The allowlist keeps it to known destinations.
        if (destination.startsWith(USER_DESTINATION_PREFIX)) {
            if (USER_DESTINATIONS.contains(destination)) {
                return;
            }
            throw denied("Unknown user destination: " + destination);
        }

        if (destination.startsWith(RealtimeService.TOPIC_GATE_PREFIX)) {
            if (!GATE_TOPIC_ROLES.contains(user.getRole())) {
                throw denied("Only guards and admins may watch a gate.");
            }
            return;
        }

        if (destination.equals(RealtimeService.TOPIC_ADMIN_INSIDE)) {
            if (user.getRole() != UserRole.ADMIN) {
                throw denied("Only admins may watch township occupancy.");
            }
            return;
        }

        throw denied("Subscription to " + destination + " is not permitted.");
    }

    private AppUserDetails principal(StompHeaderAccessor accessor) {
        if (accessor.getUser() instanceof StompPrincipal stompPrincipal) {
            return stompPrincipal.user();
        }
        throw denied("Not authenticated.");
    }

    private String bearerToken(StompHeaderAccessor accessor) {
        List<String> values = accessor.getNativeHeader(AUTHORIZATION_HEADER);
        if (values == null || values.isEmpty()) {
            return null;
        }
        String value = values.get(0);
        if (value == null || !value.startsWith(BEARER_PREFIX)) {
            return null;
        }
        String token = value.substring(BEARER_PREFIX.length()).trim();
        return token.isEmpty() ? null : token;
    }

    /**
     * Aborting {@code preSend} with an exception is what stops the frame: returning {@code null}
     * would silently drop it and leave the client waiting on a subscription it never got.
     */
    private AccessDeniedException denied(String reason) {
        log.warn("STOMP frame rejected: {}", reason);
        return new AccessDeniedException(reason);
    }
}
