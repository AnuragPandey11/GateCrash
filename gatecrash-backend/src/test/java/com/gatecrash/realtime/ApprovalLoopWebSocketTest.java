package com.gatecrash.realtime;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.gatecrash.security.AppUserDetails;
import com.gatecrash.security.JwtService;
import com.gatecrash.support.PostgresTestSupport;
import com.gatecrash.support.TestDataFactory;
import com.gatecrash.township.Flat;
import com.gatecrash.township.Gate;
import com.gatecrash.user.AppUser;
import com.gatecrash.visit.VisitService;
import com.gatecrash.visit.VisitorType;
import com.gatecrash.visit.dto.VisitDtos.CreateVisitRequest;
import com.gatecrash.visit.dto.VisitDtos.Decision;
import com.gatecrash.visit.dto.VisitDtos.VisitResponse;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.lang.NonNull;
import org.springframework.messaging.converter.MappingJackson2MessageConverter;
import org.springframework.messaging.simp.stomp.StompFrameHandler;
import org.springframework.messaging.simp.stomp.StompHeaders;
import org.springframework.messaging.simp.stomp.StompSession;
import org.springframework.messaging.simp.stomp.StompSessionHandlerAdapter;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.messaging.WebSocketStompClient;

import java.lang.reflect.Type;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The end-to-end approval loop over a real WebSocket (BACKEND.md section 12.5).
 *
 * <p>A guard subscribes to its gate topic, a visit is logged and then decided, and the test asserts
 * the {@code VISIT_DECIDED} frame actually lands on the socket. This is the one path that cannot be
 * proved by any HTTP test: it exercises the STOMP handshake, the CONNECT authentication, the
 * subscription authorization, and the after-commit publication together.
 *
 * <p>Also asserts the negative case -- a resident is refused a subscription to the admin occupancy
 * topic -- because an unauthorised subscribe is a silent data leak, not a visible error.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
@DisplayName("End-to-end: the guard's screen flips over WebSocket")
class ApprovalLoopWebSocketTest {

    private static final int TIMEOUT_SECONDS = 10;

    @LocalServerPort
    private int port;

    @Autowired
    private TestDataFactory data;

    @Autowired
    private JwtService jwtService;

    @Autowired
    private VisitService visitService;

    @Autowired
    private ObjectMapper objectMapper;

    private WebSocketStompClient stompClient;
    private Gate gate;
    private Flat flat;
    private AppUser guard;
    private AppUser resident;

    @DynamicPropertySource
    static void datasourceProperties(DynamicPropertyRegistry registry) {
        PostgresTestSupport.Handle handle = PostgresTestSupport.instance();
        registry.add("spring.datasource.url", handle::jdbcUrl);
        registry.add("spring.datasource.username", handle::username);
        registry.add("spring.datasource.password", handle::password);
    }

    @BeforeEach
    void setUp() {
        data.reset();
        flat = data.flat(data.block("Block A"), "A-101");
        gate = data.gate("Main Gate");
        guard = data.guard();
        resident = data.resident(flat);

        stompClient = new WebSocketStompClient(new StandardWebSocketClient());
        stompClient.setMessageConverter(new MappingJackson2MessageConverter(objectMapper));
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
        stompClient.stop();
    }

    @Test
    @DisplayName("a decision reaches the gate topic the guard is watching")
    void decisionReachesTheGateTopic() throws Exception {
        StompSession session = connect(guard);
        CompletableFuture<JsonNode> received = new CompletableFuture<>();
        session.subscribe("/topic/gate/" + gate.getId(), collector(received));

        VisitResponse visit = asUser(guard, () -> visitService.createVisit(new CreateVisitRequest(
                gate.getId(), VisitorType.GUEST, "Ravi Kumar", null, null, null, flat.getId(), null)));

        asUser(resident, () -> visitService.decide(visit.id(), Decision.APPROVED));

        JsonNode frame = received.get(TIMEOUT_SECONDS, TimeUnit.SECONDS);
        assertThat(frame.get("type").asText()).isEqualTo(RealtimeEvents.VISIT_DECIDED);
        assertThat(frame.get("visitId").asText()).isEqualTo(visit.id().toString());
        assertThat(frame.get("status").asText()).isEqualTo("APPROVED");
    }

    @Test
    @DisplayName("the approver's private queue receives the incoming request")
    void approverReceivesVisitRequest() throws Exception {
        StompSession session = connect(resident);
        CompletableFuture<JsonNode> received = new CompletableFuture<>();
        session.subscribe("/user/queue/visits", collector(received));

        VisitResponse visit = asUser(guard, () -> visitService.createVisit(new CreateVisitRequest(
                gate.getId(), VisitorType.GUEST, "Ravi Kumar", null, null, null, flat.getId(), null)));

        JsonNode frame = received.get(TIMEOUT_SECONDS, TimeUnit.SECONDS);
        assertThat(frame.get("type").asText()).isEqualTo(RealtimeEvents.VISIT_REQUESTED);
        assertThat(frame.get("visitId").asText()).isEqualTo(visit.id().toString());
    }

    @Test
    @DisplayName("a connection without a token is refused")
    void connectWithoutTokenIsRefused() {
        StompHeaders headers = new StompHeaders();
        assertThatThrownBy(() -> stompClient
                .connectAsync(url(), new org.springframework.web.socket.WebSocketHttpHeaders(), headers,
                        new StompSessionHandlerAdapter() {
                        })
                .get(TIMEOUT_SECONDS, TimeUnit.SECONDS))
                .isInstanceOfAny(ExecutionException.class, TimeoutException.class);
    }

    @Test
    @DisplayName("a resident cannot subscribe to the admin occupancy topic")
    void residentCannotWatchOccupancy() throws Exception {
        StompSession session = connect(resident);
        assertThat(session.isConnected()).isTrue();

        session.subscribe("/topic/admin/inside", collector(new CompletableFuture<>()));

        // The interceptor aborts the frame; the broker responds with ERROR and closes the session.
        // Asserting on teardown is stronger than asserting on a missing message -- it proves the
        // subscription was actively refused rather than merely idle.
        assertThat(awaitDisconnect(session))
                .as("session should be closed after an unauthorised SUBSCRIBE")
                .isTrue();
    }

    @Test
    @DisplayName("an admin may subscribe to the admin occupancy topic")
    void adminMayWatchOccupancy() throws Exception {
        AppUser admin = data.admin();
        StompSession session = connect(admin);

        session.subscribe("/topic/admin/inside", collector(new CompletableFuture<>()));

        // Still connected a moment later: the subscription was accepted.
        Thread.sleep(500);
        assertThat(session.isConnected()).isTrue();
    }

    private boolean awaitDisconnect(StompSession session) throws InterruptedException {
        long deadline = System.currentTimeMillis() + TIMEOUT_SECONDS * 1000L;
        while (System.currentTimeMillis() < deadline) {
            if (!session.isConnected()) {
                return true;
            }
            Thread.sleep(50);
        }
        return false;
    }

    // ----- helpers ----------------------------------------------------------------------------

    private StompSession connect(AppUser user) throws Exception {
        StompHeaders headers = new StompHeaders();
        headers.add("Authorization", "Bearer " + jwtService.generateAccessToken(AppUserDetails.from(user)));
        return stompClient
                .connectAsync(url(), new org.springframework.web.socket.WebSocketHttpHeaders(), headers,
                        new StompSessionHandlerAdapter() {
                        })
                .get(TIMEOUT_SECONDS, TimeUnit.SECONDS);
    }

    /**
     * The endpoint is registered {@code withSockJS()}, so a native WebSocket client connects to the
     * SockJS raw-websocket transport at {@code /ws/websocket} rather than to {@code /ws} itself.
     * Browser clients using sockjs-client target {@code /ws} and negotiate their own transport.
     */
    private String url() {
        return "ws://localhost:" + port + "/ws/websocket";
    }

    private StompFrameHandler collector(CompletableFuture<JsonNode> target) {
        return new StompFrameHandler() {
            @Override
            @NonNull
            public Type getPayloadType(@NonNull StompHeaders headers) {
                return JsonNode.class;
            }

            @Override
            public void handleFrame(@NonNull StompHeaders headers, Object payload) {
                target.complete((JsonNode) payload);
            }
        };
    }

    /**
     * Runs a service call under a real {@code SecurityContext}, so {@code @PreAuthorize} and the
     * ownership re-checks execute exactly as they would behind a controller.
     */
    private <T> T asUser(AppUser user, java.util.function.Supplier<T> action) {
        AppUserDetails principal = AppUserDetails.from(user);
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(principal, null, principal.getAuthorities()));
        try {
            return action.get();
        } finally {
            SecurityContextHolder.clearContext();
        }
    }
}
