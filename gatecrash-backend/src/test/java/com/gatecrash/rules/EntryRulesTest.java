package com.gatecrash.rules;

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
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.util.HashMap;
import java.util.Map;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Society rules: request → office decision → the gate lets matching walk-ins straight in. */
@DisplayName("Society rules")
class EntryRulesTest extends AbstractIntegrationTest {

    @Autowired
    private TestDataFactory data;

    @Autowired
    private TestAuth auth;

    private Gate gate;
    private PropertyNode flatA;
    private PropertyNode flatB;
    private AppUser admin;
    private AppUser guard;
    private AppUser residentA;
    private AppUser residentB;

    @BeforeEach
    void seed() {
        data.reset();
        PropertyNode block = data.block("Block A");
        flatA = data.flat(block, "A-101");
        flatB = data.flat(block, "A-102");
        gate = data.gate("Main Gate");
        admin = data.admin();
        guard = data.guard();
        residentA = data.resident(flatA);
        residentB = data.resident(flatB);
    }

    @Test
    @DisplayName("an approved rule lets a matching walk-in straight in; anything else still asks")
    void approvedRuleAutoApproves() throws Exception {
        String ruleId = body(as(residentA, post("/api/v1/entry-rules"), Map.of(
                "visitorType", "DELIVERY", "label", "Amazon parcels", "matchText", "amazon"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("PENDING"))
                .andExpect(jsonPath("$.unitCode").value("A-101"))).get("id").asText();

        // Pending rules are not applied.
        walkIn(flatA, "DELIVERY", "Ravi", "Amazon")
                .andExpect(jsonPath("$.status").value("PENDING"))
                .andExpect(jsonPath("$.autoApproved").value(false));

        as(admin, post("/api/v1/admin/entry-rules/" + ruleId + "/decision"), Map.of("decision", "APPROVED"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("APPROVED"));

        walkIn(flatA, "DELIVERY", "Ravi", "Amazon order")
                .andExpect(jsonPath("$.status").value("CHECKED_IN"))
                .andExpect(jsonPath("$.autoApproved").value(true));
        walkIn(flatA, "DELIVERY", "Sunil", "Flipkart")
                .andExpect(jsonPath("$.status").value("PENDING"));
        walkIn(flatA, "GUEST", "Amazon Prime fan", null)
                .andExpect(jsonPath("$.status").value("PENDING"));
        walkIn(flatB, "DELIVERY", "Ravi", "Amazon")
                .andExpect(jsonPath("$.status").value("PENDING"));

        as(admin, post("/api/v1/admin/entry-rules/" + ruleId + "/revoke"), Map.of("note", "Parcel theft"))
                .andExpect(jsonPath("$.status").value("REVOKED"));
        walkIn(flatA, "DELIVERY", "Ravi", "Amazon")
                .andExpect(jsonPath("$.status").value("PENDING"));
    }

    @Test
    @DisplayName("a rule for guests or technicians must name the person or give their phone")
    void broadRulesRefused() throws Exception {
        as(residentA, post("/api/v1/entry-rules"), Map.of("visitorType", "GUEST", "label", "Any guest"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("RULE_TOO_BROAD"));
        as(residentA, post("/api/v1/entry-rules"), Map.of(
                "visitorType", "MAINTENANCE", "label", "AC repair", "visitorPhone", "+919876543210"))
                .andExpect(status().isCreated());
    }

    @Test
    @DisplayName("a phone-bound rule matches the number however it is typed")
    void phoneMatch() throws Exception {
        String ruleId = body(as(residentA, post("/api/v1/entry-rules"), Map.of(
                "visitorType", "GUEST", "label", "My sister", "visitorPhone", "+919876543210"))).get("id").asText();
        as(admin, post("/api/v1/admin/entry-rules/" + ruleId + "/decision"), Map.of("decision", "APPROVED"))
                .andExpect(status().isOk());

        Map<String, Object> visit = walkInRequest(flatA, "GUEST", "Priya", null);
        visit.put("visitorPhone", "9876543210");
        as(guard, post("/api/v1/visits"), visit)
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.autoApproved").value(true));
        walkIn(flatA, "GUEST", "Priya", null)
                .andExpect(jsonPath("$.autoApproved").value(false));
    }

    @Test
    @DisplayName("only the office decides, a rejection needs a reason, and only the home can withdraw")
    void ownership() throws Exception {
        String ruleId = body(as(residentA, post("/api/v1/entry-rules"), Map.of(
                "visitorType", "GUEST", "label", "Priya", "matchText", "Priya"))).get("id").asText();

        as(residentA, post("/api/v1/admin/entry-rules/" + ruleId + "/decision"), Map.of("decision", "APPROVED"))
                .andExpect(status().isForbidden());
        as(guard, post("/api/v1/admin/entry-rules/" + ruleId + "/decision"), Map.of("decision", "APPROVED"))
                .andExpect(status().isForbidden());
        as(residentB, post("/api/v1/entry-rules/" + ruleId + "/cancel"), Map.of())
                .andExpect(status().isForbidden());
        as(admin, post("/api/v1/admin/entry-rules/" + ruleId + "/decision"), Map.of("decision", "REJECTED"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("REASON_REQUIRED"));

        as(residentA, post("/api/v1/entry-rules/" + ruleId + "/cancel"), Map.of())
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("CANCELLED"));
        as(admin, post("/api/v1/admin/entry-rules/" + ruleId + "/decision"), Map.of("decision", "APPROVED"))
                .andExpect(status().isConflict());
    }

    private ResultActions walkIn(PropertyNode flat, String type, String name, String purpose) throws Exception {
        return as(guard, post("/api/v1/visits"), walkInRequest(flat, type, name, purpose))
                .andExpect(status().isCreated());
    }

    private Map<String, Object> walkInRequest(PropertyNode flat, String type, String name, String purpose) {
        Map<String, Object> request = new HashMap<>();
        request.put("gateId", gate.getId().toString());
        request.put("visitorType", type);
        request.put("visitorName", name);
        request.put("targetFlatId", flat.getId().toString());
        if (purpose != null) {
            request.put("purpose", purpose);
        }
        return request;
    }

    private ResultActions as(AppUser actor, MockHttpServletRequestBuilder request, Object body) throws Exception {
        return mockMvc.perform(request
                .header(HttpHeaders.AUTHORIZATION, auth.bearer(actor))
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(body)));
    }

    private JsonNode body(ResultActions result) throws Exception {
        return objectMapper.readTree(result.andReturn().getResponse().getContentAsString());
    }
}
