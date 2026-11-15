package com.gatecrash.visit;

import com.gatecrash.property.PropertyNode;
import com.gatecrash.support.AbstractIntegrationTest;
import com.gatecrash.support.TestAuth;
import com.gatecrash.support.TestDataFactory;
import com.gatecrash.township.Gate;
import com.gatecrash.user.AppUser;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@DisplayName("Visit FSM: legal transitions, illegal ones, and ownership")
class VisitFsmTest extends AbstractIntegrationTest {

    @Autowired
    private TestDataFactory data;

    @Autowired
    private TestAuth auth;

    @Autowired
    private VisitorLogRepository visits;

    private Gate gate;
    private PropertyNode flatA;
    private PropertyNode flatB;
    private AppUser guard;
    private AppUser residentA;
    private AppUser residentB;
    private AppUser salesOnDuty;

    @BeforeEach
    void seed() {
        data.reset();
        PropertyNode block = data.block("Block A");
        flatA = data.flat(block, "A-101");
        flatB = data.flat(block, "A-102");
        gate = data.gate("Main Gate");
        guard = data.guard();
        residentA = data.resident(flatA);
        residentB = data.resident(flatB);
        salesOnDuty = data.salesAgent(true);
    }

    // ----- happy path -------------------------------------------------------------------------

    @Test
    @DisplayName("the full loop: log, approve (which lets them in and counts them inside), check out")
    void fullApprovalLoop() throws Exception {
        UUID visitId = logWalkIn(flatA.getId());
        assertStatus(visitId, VisitStatus.PENDING);

        // The visitor is at the gate waiting for this answer: approval is entry.
        decide(residentA, visitId, "APPROVED").andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("CHECKED_IN"))
                .andExpect(jsonPath("$.decidedAt").isNotEmpty())
                .andExpect(jsonPath("$.checkedInAt").isNotEmpty());

        // Regression: an approved walk-in used to stay out of live occupancy until the guard
        // also tapped Check in.
        AppUser admin = data.admin();
        mockMvc.perform(get("/api/v1/admin/inside")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(admin)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.insideCount").value(1))
                .andExpect(jsonPath("$.visits[0].id").value(visitId.toString()));

        mockMvc.perform(patch("/api/v1/visits/" + visitId + "/check-out")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(guard)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("CHECKED_OUT"));
    }

    @Test
    @DisplayName("a rejected visit is terminal")
    void rejectionIsTerminal() throws Exception {
        UUID visitId = logWalkIn(flatA.getId());
        decide(residentA, visitId, "REJECTED").andExpect(status().isOk());
        assertStatus(visitId, VisitStatus.REJECTED);
    }

    // ----- illegal transitions ----------------------------------------------------------------

    @Test
    @DisplayName("a decided visit cannot be decided again")
    void doubleDecisionIsConflict() throws Exception {
        UUID visitId = logWalkIn(flatA.getId());
        decide(residentA, visitId, "APPROVED").andExpect(status().isOk());

        decide(residentA, visitId, "REJECTED")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("ILLEGAL_TRANSITION"));
    }

    @Test
    @DisplayName("a pending visit cannot be checked in before it is approved")
    void checkInBeforeApprovalIsConflict() throws Exception {
        UUID visitId = logWalkIn(flatA.getId());

        mockMvc.perform(patch("/api/v1/visits/" + visitId + "/check-in")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(guard)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("ILLEGAL_TRANSITION"));
    }

    @Test
    @DisplayName("a visit still waiting for a decision cannot be checked out")
    void checkOutBeforeCheckInIsConflict() throws Exception {
        UUID visitId = logWalkIn(flatA.getId());

        mockMvc.perform(patch("/api/v1/visits/" + visitId + "/check-out")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(guard)))
                .andExpect(status().isConflict());
    }

    @Test
    @DisplayName("a rejected visit cannot be checked in")
    void rejectedCannotBeCheckedIn() throws Exception {
        UUID visitId = logWalkIn(flatA.getId());
        decide(residentA, visitId, "REJECTED").andExpect(status().isOk());

        mockMvc.perform(patch("/api/v1/visits/" + visitId + "/check-in")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(guard)))
                .andExpect(status().isConflict());
    }

    // ----- ownership --------------------------------------------------------------------------

    @Test
    @DisplayName("a resident of another flat cannot decide the visit")
    void wrongFlatResidentIsForbidden() throws Exception {
        UUID visitId = logWalkIn(flatA.getId());

        decide(residentB, visitId, "APPROVED")
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("FORBIDDEN"));
        assertStatus(visitId, VisitStatus.PENDING);
    }

    @Test
    @DisplayName("any resident of the target flat may decide -- the household shares it")
    void anyResidentOfTheFlatMayDecide() throws Exception {
        AppUser spouse = data.resident(flatA);
        UUID visitId = logWalkIn(flatA.getId());

        decide(spouse, visitId, "APPROVED").andExpect(status().isOk());
    }

    @Test
    @DisplayName("a sales agent cannot decide a resident-routed visit")
    void salesCannotDecideResidentVisit() throws Exception {
        UUID visitId = logWalkIn(flatA.getId());
        decide(salesOnDuty, visitId, "APPROVED").andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("a resident of another flat cannot even read the visit")
    void wrongFlatResidentCannotReadVisit() throws Exception {
        UUID visitId = logWalkIn(flatA.getId());

        mockMvc.perform(get("/api/v1/visits/" + visitId)
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(residentB)))
                .andExpect(status().isForbidden());
    }

    // ----- routing rules ----------------------------------------------------------------------

    @Test
    @DisplayName("a meet-sales-agent visit without a sales agent is unprocessable")
    void salesMeetingRequiresSalesAgent() throws Exception {
        Map<String, Object> request = new HashMap<>();
        request.put("gateId", gate.getId().toString());
        request.put("visitorType", "GUEST");
        request.put("meetSalesAgent", true);
        request.put("visitorName", "Prospective Buyer");

        mockMvc.perform(post("/api/v1/visits")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(guard))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(request)))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("SALES_AGENT_REQUIRED"));
    }

    @Test
    @DisplayName("a meet-sales-agent visit routes to the chosen on-duty sales agent")
    void salesMeetingRoutesToSales() throws Exception {
        Map<String, Object> request = new HashMap<>();
        request.put("gateId", gate.getId().toString());
        request.put("visitorType", "GUEST");
        request.put("meetSalesAgent", true);
        request.put("visitorName", "Prospective Buyer");
        request.put("salesAgentId", salesOnDuty.getId().toString());

        String body = mockMvc.perform(post("/api/v1/visits")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(guard))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(request)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.approverKind").value("SALES"))
                .andExpect(jsonPath("$.meetSalesAgent").value(true))
                .andReturn().getResponse().getContentAsString();

        UUID visitId = UUID.fromString(objectMapper.readTree(body).get("id").asText());
        decide(salesOnDuty, visitId, "APPROVED").andExpect(status().isOk());
    }

    @Test
    @DisplayName("an off-duty sales agent cannot be the routing target")
    void offDutyAgentIsRejected() throws Exception {
        AppUser offDuty = data.salesAgent(false);
        Map<String, Object> request = new HashMap<>();
        request.put("gateId", gate.getId().toString());
        request.put("visitorType", "GUEST");
        request.put("meetSalesAgent", true);
        request.put("visitorName", "Prospective Buyer");
        request.put("salesAgentId", offDuty.getId().toString());

        mockMvc.perform(post("/api/v1/visits")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(guard))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(request)))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("AGENT_OFF_DUTY"));
    }

    @Test
    @DisplayName("an account without the sales flag cannot be the sales routing target")
    void nonSalesAccountIsNotASalesAgent() throws Exception {
        Map<String, Object> request = new HashMap<>();
        request.put("gateId", gate.getId().toString());
        request.put("visitorType", "GUEST");
        request.put("meetSalesAgent", true);
        request.put("visitorName", "Prospective Buyer");
        request.put("salesAgentId", guard.getId().toString());

        mockMvc.perform(post("/api/v1/visits")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(guard))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(request)))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("NOT_A_SALES_AGENT"));
    }

    @Test
    @DisplayName("a non-https photo URL is refused")
    void hostilePhotoUrlIsRefused() throws Exception {
        Map<String, Object> request = new HashMap<>();
        request.put("gateId", gate.getId().toString());
        request.put("visitorType", "GUEST");
        request.put("visitorName", "Visitor");
        request.put("targetFlatId", flatA.getId().toString());
        request.put("photoUrl", "javascript:alert(document.cookie)");

        mockMvc.perform(post("/api/v1/visits")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(guard))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(request)))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("INVALID_URL"));
    }

    @Test
    @DisplayName("a visit to a flat with no resident account is refused at the gate")
    void flatWithNoResidentIsRefused() throws Exception {
        PropertyNode empty = data.flat(data.block("Block B"), "B-201");

        mockMvc.perform(post("/api/v1/visits")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(guard))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("gateId", gate.getId().toString(),
                                "visitorType", "GUEST", "visitorName", "Visitor",
                                "targetFlatId", empty.getId().toString()))))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("NO_RESIDENT"));
    }

    // ----- inbox ------------------------------------------------------------------------------

    @Test
    @DisplayName("the pending inbox is scoped to the caller's own flat")
    void pendingInboxIsScoped() throws Exception {
        logWalkIn(flatA.getId());

        mockMvc.perform(get("/api/v1/visits/pending")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(residentA)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1));

        mockMvc.perform(get("/api/v1/visits/pending")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(residentB)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }

    // ----- helpers ----------------------------------------------------------------------------

    private UUID logWalkIn(UUID flatId) throws Exception {
        Map<String, Object> request = new HashMap<>();
        request.put("gateId", gate.getId().toString());
        request.put("visitorType", "GUEST");
        request.put("visitorName", "Ravi Kumar");
        request.put("targetFlatId", flatId.toString());

        String body = mockMvc.perform(post("/api/v1/visits")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(guard))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(request)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("PENDING"))
                .andReturn().getResponse().getContentAsString();
        return UUID.fromString(objectMapper.readTree(body).get("id").asText());
    }

    private org.springframework.test.web.servlet.ResultActions decide(AppUser actor, UUID visitId,
                                                                      String decision) throws Exception {
        return mockMvc.perform(patch("/api/v1/visits/" + visitId + "/decision")
                .header(HttpHeaders.AUTHORIZATION, auth.bearer(actor))
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(Map.of("decision", decision))));
    }

    private void assertStatus(UUID visitId, VisitStatus expected) {
        assertThat(visits.findById(visitId)).get()
                .extracting(VisitorLog::getStatus)
                .isEqualTo(expected);
    }
}
