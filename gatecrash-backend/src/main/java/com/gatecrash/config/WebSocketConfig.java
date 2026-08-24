package com.gatecrash.config;

import com.gatecrash.security.StompAuthChannelInterceptor;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.simp.config.ChannelRegistration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketTransportRegistration;

@Configuration
@EnableWebSocketMessageBroker
@RequiredArgsConstructor
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    private final StompAuthChannelInterceptor stompAuthChannelInterceptor;
    private final AppProperties properties;

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        String[] origins = properties.security().cors().allowedOrigins().toArray(String[]::new);
        // Same allowlist as REST. The Origin header is the only cross-site control a WebSocket
        // handshake has -- it is not subject to the same-origin policy otherwise.
        registry.addEndpoint("/ws")
                .setAllowedOriginPatterns(origins)
                .withSockJS();
    }

    @Override
    public void configureMessageBroker(MessageBrokerRegistry registry) {
        // In-memory broker: correct for the single-node Phase 1 deployment. Scaling horizontally
        // means swapping this for a STOMP relay (RabbitMQ/ActiveMQ) or a Redis bridge -- with the
        // simple broker, two instances do not see each other's subscriptions, so a guard connected
        // to node B would miss a decision published on node A.
        registry.enableSimpleBroker("/topic", "/queue");
        registry.setApplicationDestinationPrefixes("/app");
        registry.setUserDestinationPrefix("/user");
    }

    @Override
    public void configureClientInboundChannel(ChannelRegistration registration) {
        registration.interceptors(stompAuthChannelInterceptor);
    }

    @Override
    public void configureWebSocketTransport(WebSocketTransportRegistration registration) {
        // Bounds on an untrusted socket: without them a client can pin memory by opening a session
        // and never draining it, or by sending one enormous frame.
        registration.setMessageSizeLimit(64 * 1024);
        registration.setSendBufferSizeLimit(512 * 1024);
        registration.setSendTimeLimit(20_000);
    }
}
