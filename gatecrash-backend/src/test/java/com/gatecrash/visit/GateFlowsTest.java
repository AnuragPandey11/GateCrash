package com.gatecrash.visit;

import com.fasterxml.jackson.databind.JsonNode;
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
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.ResultActions;

import java.time.OffsetDateTime;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The gate flows on top of the basic approval loop: scanning a pass without consuming it,
 * one-time and frequent windows, Leave at Gate with its collection code, and overstay -> extend.
 */
@DisplayName("Gate flows: passes, Leave at Gate, durations and overstay")
class GateFlowsTest extends AbstractIntegrationTest {

    @Autowired
    private TestDataFactory data;

    @Autowired
    private TestAuth auth;

    @Autowired
    private ExpirySweepJob sweeps;

    @Autowired
    private VisitorLogRepository visits;

    @Autowired
    private JdbcTemplate jdbc;

    private Gate gate;
    private PropertyNode flat;
    private AppUser guard;
    private AppUser resident;

    @BeforeEach
    void seed() {
        data.reset();
        flat = data.flat(data.block("Block A"), "A-101");
        gate = data.gate("Main Gate");
        guard = data.guard();
        resident = data.resident(flat);
    }

    // ----- passes -----------------------------------------------------------------------------

    @Test
    @DisplayName("scanning a pass shows its details pre-filled and does not use it up")
    void lookupDoesNotConsume() throws Exception {
        JsonNode pass = mint(oneTime(OffsetDateTime.now().plusMinutes(10), OffsetDateTime.now().plusHours(3)));
        String qr = pass.get("qrToken").asText();

        for (int i = 0; i < 2; i++) {
            lookup(qr).andExpect(status().isOk())
                    .andExpect(jsonPath("$.visitorName").value("Expected Guest"))
                    .andExpect(jsonPath("$.visitorPhone").value("+919811122233"))
                    .andExpect(jsonPath("$.hostUnitCode").value("A-101"))
                    .andExpect(jsonPath("$.redeemable").value(true))
                    .andExpect(jsonPath("$.useCount").value(0));
        }
    }

    @Test
    @DisplayName("a one-time QR works from an hour before arrival, not earlier")
    void oneTimeEarlyWindow() throws Exception {
        JsonNode soon = mint(oneTime(OffsetDateTime.now().plusMinutes(45), OffsetDateTime.now().plusHours(3)));
        lookup(soon.get("qrToken").asText()).andExpect(jsonPath("$.redeemable").value(true));

        JsonNode later = mint(oneTime(OffsetDateTime.now().plusHours(3), OffsetDateTime.now().plusHours(5)));
        lookup(later.get("qrToken").asText())
                .andExpect(jsonPath("$.redeemable").value(false))
                .andExpect(jsonPath("$.problem").value("NOT_YET_VALID"));
    }

    @Test
    @DisplayName("a one-time pass longer than a day is refused")
    void oneTimeIsAtMostADay() throws Exception {
        mintRaw(oneTime(OffsetDateTime.now().plusMinutes(5), OffsetDateTime.now().plusDays(2)))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("WINDOW_TOO_LONG"));
    }

    @Test
    @DisplayName("a one-time redemption carries the guard's corrections and the out time as expected exit")
    void oneTimeRedemptionSetsExpectedOut() throws Exception {
        OffsetDateTime out = OffsetDateTime.now().plusHours(2);
        JsonNode pass = mint(oneTime(OffsetDateTime.now(), out));

        Map<String, Object> redeem = new HashMap<>();
        redeem.put("qrToken", pass.get("qrToken").asText());
        redeem.put("gateId", gate.getId().toString());
        redeem.put("vehicleNo", "MH12AB1234");
        mockMvc.perform(post("/api/v1/passes/redeem")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(guard))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(redeem)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.visit.status").value("CHECKED_IN"))
                .andExpect(jsonPath("$.visit.vehicleNo").value("MH12AB1234"))
                .andExpect(jsonPath("$.visit.expectedOutAt").isNotEmpty())
                .andExpect(jsonPath("$.remainingUses").value(0));
    }

    @Test
    @DisplayName("a frequent pass lets the same visitor in repeatedly, each visit with its own exit time")
    void frequentPassIsReusable() throws Exception {
        Map<String, Object> request = base();
        request.put("passType", "FREQUENT");
        request.put("visitorName", "Maths Tutor");
        request.put("validFrom", OffsetDateTime.now().minusMinutes(1).toString());
        request.put("validUntil", OffsetDateTime.now().plusDays(60).toString());
        request.put("expectedDurationMinutes", 90);
        JsonNode pass = mint(request);
        // Unlimited: the server omits maxUses entirely rather than sending null.
        assertThat(pass.has("maxUses")).isFalse();

        for (int i = 0; i < 3; i++) {
            String body = redeemByQr(pass.get("qrToken").asText())
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.visit.expectedDurationMinutes").value(90))
                    .andReturn().getResponse().getContentAsString();
            assertThat(objectMapper.readTree(body).has("remainingUses")).isFalse();
        }
    }

    @Test
    @DisplayName("a frequent pass must say how long each visit lasts")
    void frequentNeedsDuration() throws Exception {
        Map<String, Object> request = base();
        request.put("passType", "FREQUENT");
        request.put("validUntil", OffsetDateTime.now().plusDays(10).toString());
        mintRaw(request)
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("DURATION_REQUIRED"));
    }

    // ----- Leave at Gate ---------------------------------------------------------------------

    @Test
    @DisplayName("Leave at Gate issues a code once, and the parcel is handed over only against it")
    void leaveAtGateWithCode() throws Exception {
        UUID visitId = walkIn("DELIVERY", null);
        String body = decide(visitId, Map.of("decision", "LEAVE_AT_GATE"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("LEFT_AT_GATE"))
                .andReturn().getResponse().getContentAsString();
        String code = objectMapper.readTree(body).get("collectionCode").asText();
        assertThat(code).matches("[0-9]{6}");

        String wrong = code.equals("000000") ? "111111" : "000000";
        collect(visitId, wrong).andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("WRONG_COLLECTION_CODE"));
        collect(visitId, code).andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("COLLECTED"));
    }

    @Test
    @DisplayName("a reissued code replaces the old one")
    void reissuedCodeReplacesOld() throws Exception {
        UUID visitId = walkIn("DELIVERY", null);
        String first = objectMapper.readTree(decide(visitId, Map.of("decision", "LEAVE_AT_GATE"))
                .andReturn().getResponse().getContentAsString()).get("collectionCode").asText();
        String second = objectMapper.readTree(mockMvc.perform(
                        post("/api/v1/visits/" + visitId + "/collection-code")
                                .header(HttpHeaders.AUTHORIZATION, auth.bearer(resident)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString()).get("code").asText();

        if (!first.equals(second)) {
            collect(visitId, first).andExpect(status().isUnprocessableEntity());
        }
        collect(visitId, second).andExpect(status().isOk());
    }

    @Test
    @DisplayName("only a delivery can be left at the gate")
    void leaveAtGateIsForDeliveries() throws Exception {
        UUID visitId = walkIn("GUEST", null);
        decide(visitId, Map.of("decision", "LEAVE_AT_GATE"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("LEAVE_AT_GATE_DELIVERY_ONLY"));
    }

    // ----- duration and overstay -------------------------------------------------------------

    @Test
    @DisplayName("the resident's duration on approval sets the exit time, since approval lets them in")
    void residentSetsDurationOnApproval() throws Exception {
        UUID visitId = walkIn("GUEST", null);
        decide(visitId, Map.of("decision", "APPROVED", "expectedDurationMinutes", 45))
                .andExpect(jsonPath("$.status").value("CHECKED_IN"))
                .andExpect(jsonPath("$.expectedDurationMinutes").value(45))
                .andExpect(jsonPath("$.expectedOutAt").isNotEmpty());
    }

    @Test
    @DisplayName("an overstay is flagged once, and extending the stay clears it")
    void overstayThenExtend() throws Exception {
        UUID visitId = walkIn("GUEST", 30);
        decide(visitId, Map.of("decision", "APPROVED")).andExpect(status().isOk());

        // Move the expected exit into the past, as if the 30 minutes had elapsed.
        jdbc.update("UPDATE visitor_log SET expected_out_at = now() - interval '5 minutes' WHERE id = ?", visitId);
        sweeps.flagOverstays();
        assertThat(visits.findById(visitId).orElseThrow().getOverstayAlertedAt()).isNotNull();

        mockMvc.perform(patch("/api/v1/visits/" + visitId + "/stay")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(resident))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("extendMinutes", 60))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.overstaying").value(false));
        VisitorLog after = visits.findById(visitId).orElseThrow();
        assertThat(after.getOverstayAlertedAt()).isNull();
        assertThat(after.getExpectedOutAt()).isAfter(OffsetDateTime.now().plusMinutes(55));
    }

    @Test
    @DisplayName("a resident of another flat cannot extend someone else's guest")
    void strangerCannotExtend() throws Exception {
        AppUser stranger = data.resident(data.flat(data.block("Block B"), "B-201"));
        UUID visitId = walkIn("GUEST", 30);
        decide(visitId, Map.of("decision", "APPROVED")).andExpect(status().isOk());
        mockMvc.perform(patch("/api/v1/visits/" + visitId + "/stay")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(stranger))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("extendMinutes", 60))))
                .andExpect(status().isForbidden());
    }

    // ----- helpers ----------------------------------------------------------------------------

    private Map<String, Object> base() {
        Map<String, Object> request = new HashMap<>();
        request.put("visitorType", "GUEST");
        request.put("visitorName", "Expected Guest");
        request.put("visitorPhone", "+919811122233");
        return request;
    }

    private Map<String, Object> oneTime(OffsetDateTime arrival, OffsetDateTime out) {
        Map<String, Object> request = base();
        request.put("passType", "ONE_TIME");
        request.put("validFrom", arrival.toString());
        request.put("validUntil", out.toString());
        return request;
    }

    private ResultActions mintRaw(Map<String, Object> request) throws Exception {
        return mockMvc.perform(post("/api/v1/passes")
                .header(HttpHeaders.AUTHORIZATION, auth.bearer(resident))
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(request)));
    }

    private JsonNode mint(Map<String, Object> request) throws Exception {
        String body = mintRaw(request).andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(body);
    }

    private ResultActions lookup(String qrToken) throws Exception {
        return mockMvc.perform(post("/api/v1/passes/lookup")
                .header(HttpHeaders.AUTHORIZATION, auth.bearer(guard))
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(Map.of("qrToken", qrToken, "gateId", gate.getId().toString()))));
    }

    private ResultActions redeemByQr(String qrToken) throws Exception {
        return mockMvc.perform(post("/api/v1/passes/redeem")
                .header(HttpHeaders.AUTHORIZATION, auth.bearer(guard))
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(Map.of("qrToken", qrToken, "gateId", gate.getId().toString()))));
    }

    private UUID walkIn(String type, Integer durationMinutes) throws Exception {
        Map<String, Object> request = new HashMap<>();
        request.put("gateId", gate.getId().toString());
        request.put("visitorType", type);
        request.put("visitorName", "Walk In");
        request.put("targetFlatId", flat.getId().toString());
        if (durationMinutes != null) {
            request.put("expectedDurationMinutes", durationMinutes);
        }
        String body = mockMvc.perform(post("/api/v1/visits")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(guard))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(request)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return UUID.fromString(objectMapper.readTree(body).get("id").asText());
    }

    private ResultActions decide(UUID visitId, Map<String, Object> body) throws Exception {
        return mockMvc.perform(patch("/api/v1/visits/" + visitId + "/decision")
                .header(HttpHeaders.AUTHORIZATION, auth.bearer(resident))
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(body)));
    }

    private ResultActions collect(UUID visitId, String code) throws Exception {
        return mockMvc.perform(post("/api/v1/visits/" + visitId + "/collect")
                .header(HttpHeaders.AUTHORIZATION, auth.bearer(guard))
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(Map.of("code", code))));
    }
}
