package com.gatecrash.security;

import com.gatecrash.property.PropertyNode;
import com.gatecrash.support.AbstractIntegrationTest;
import com.gatecrash.support.TestAuth;
import com.gatecrash.support.TestDataFactory;
import com.gatecrash.user.AppUser;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

import java.util.Map;
import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The mandatory negative RBAC matrix (BACKEND.md section 12.1).
 *
 * <p>These are the tests that matter most in this codebase. Positive tests prove a feature works;
 * these prove that holding a valid token for the wrong role gets you nothing. Each case uses a real
 * signed token for a real account, so a regression anywhere in the chain -- filter, method security,
 * or a stray permitAll -- fails here rather than in production.
 */
@DisplayName("RBAC: every role is refused every endpoint it does not own")
class RbacNegativeTest extends AbstractIntegrationTest {

    @Autowired
    private TestDataFactory data;

    @Autowired
    private TestAuth auth;

    private AppUser admin;
    private AppUser guard;
    private AppUser resident;
    private AppUser sales;
    private PropertyNode flat;

    @BeforeEach
    void seed() {
        data.reset();
        flat = data.flat(data.block("Block A"), "A-101");
        admin = data.admin();
        guard = data.guard();
        resident = data.resident(flat);
        sales = data.salesAgent(true);
    }

    // ----- admin-only surface -----------------------------------------------------------------

    @Test
    @DisplayName("a guard cannot provision accounts")
    void guardCannotProvisionUsers() throws Exception {
        mockMvc.perform(post("/api/v1/admin/users")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(guard))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("role", "GUARD", "loginId", "sneaky", "fullName", "Sneaky"))))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("FORBIDDEN"));
    }

    @Test
    @DisplayName("a resident cannot provision accounts")
    void residentCannotProvisionUsers() throws Exception {
        mockMvc.perform(post("/api/v1/admin/users")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(resident))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("role", "ADMIN", "loginId", "escalate", "fullName", "Escalate"))))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("a guard cannot broadcast notifications")
    void guardCannotSendNotifications() throws Exception {
        mockMvc.perform(post("/api/v1/notifications")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(guard))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("title", "Hi", "body", "There",
                                "audienceRule", Map.of("mode", "ALL")))))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("a sales agent cannot preview a notification audience")
    void salesCannotPreviewAudience() throws Exception {
        mockMvc.perform(post("/api/v1/notifications/preview")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(sales))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("mode", "ALL"))))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("a resident cannot read the live occupancy feed")
    void residentCannotSeeWhoIsInside() throws Exception {
        mockMvc.perform(get("/api/v1/admin/inside")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(resident)))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("a guard cannot export the visitor log")
    void guardCannotExportVisits() throws Exception {
        mockMvc.perform(get("/api/v1/admin/visits")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(guard)))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("a guard cannot publish community posts")
    void guardCannotPublishPosts() throws Exception {
        mockMvc.perform(post("/api/v1/community/posts")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(guard))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("title", "T", "body", "B", "pinned", false))))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("a guard cannot read the community feed")
    void guardCannotReadFeed() throws Exception {
        mockMvc.perform(get("/api/v1/community/posts")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(guard)))
                .andExpect(status().isForbidden());
    }

    // ----- guard-only surface -----------------------------------------------------------------

    @Test
    @DisplayName("a resident cannot log a walk-in")
    void residentCannotLogVisits() throws Exception {
        mockMvc.perform(post("/api/v1/visits")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(resident))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("gateId", UUID.randomUUID(), "visitorType", "GUEST",
                                "visitorName", "Nobody", "targetFlatId", flat.getId()))))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("a resident cannot redeem a pass at the gate")
    void residentCannotRedeemPasses() throws Exception {
        mockMvc.perform(post("/api/v1/passes/redeem")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(resident))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("pin", "123456", "gateId", UUID.randomUUID()))))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("an admin cannot check a visitor in -- that is the guard's physical act")
    void adminCannotCheckIn() throws Exception {
        mockMvc.perform(patch("/api/v1/visits/" + UUID.randomUUID() + "/check-in")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(admin)))
                .andExpect(status().isForbidden());
    }

    // ----- approver-only surface --------------------------------------------------------------

    @Test
    @DisplayName("a guard cannot decide a visit they logged")
    void guardCannotDecideVisits() throws Exception {
        mockMvc.perform(patch("/api/v1/visits/" + UUID.randomUUID() + "/decision")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(guard))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("decision", "APPROVED"))))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("an admin cannot decide a visit on a resident's behalf")
    void adminCannotDecideVisits() throws Exception {
        mockMvc.perform(patch("/api/v1/visits/" + UUID.randomUUID() + "/decision")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(admin))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("decision", "APPROVED"))))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("a guard cannot mint a pass")
    void guardCannotMintPasses() throws Exception {
        mockMvc.perform(post("/api/v1/passes")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(guard))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("visitorType", "GUEST", "maxUses", 1,
                                "validUntil", java.time.OffsetDateTime.now().plusHours(4).toString()))))
                .andExpect(status().isForbidden());
    }

    // ----- sales-only surface -----------------------------------------------------------------

    @Test
    @DisplayName("a resident cannot flip the sales duty toggle")
    void residentCannotToggleDuty() throws Exception {
        mockMvc.perform(patch("/api/v1/sales/me/duty")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(resident))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("onDuty", true))))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("a resident cannot enumerate on-duty sales agents")
    void residentCannotListOnDutyAgents() throws Exception {
        mockMvc.perform(get("/api/v1/sales/on-duty")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(resident)))
                .andExpect(status().isForbidden());
    }

    // ----- unauthenticated --------------------------------------------------------------------

    @Test
    @DisplayName("no token is 401, not 403")
    void anonymousIsUnauthorized() throws Exception {
        mockMvc.perform(get("/api/v1/visits/pending"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
    }

    @Test
    @DisplayName("a garbage bearer token is rejected")
    void malformedTokenIsUnauthorized() throws Exception {
        mockMvc.perform(get("/api/v1/visits/pending")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer not-a-real-token"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("INVALID_TOKEN"));
    }
}
