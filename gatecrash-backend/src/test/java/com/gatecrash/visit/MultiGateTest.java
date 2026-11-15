package com.gatecrash.visit;

import com.fasterxml.jackson.databind.JsonNode;
import com.gatecrash.property.PropertyNode;
import com.gatecrash.support.AbstractIntegrationTest;
import com.gatecrash.support.TestAuth;
import com.gatecrash.support.TestDataFactory;
import com.gatecrash.township.Gate;
import com.gatecrash.township.Township;
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

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** A township with two gates: in by one, out by the other, and the records stay whole. */
@DisplayName("Several gates")
class MultiGateTest extends AbstractIntegrationTest {

    @Autowired
    private TestDataFactory data;

    @Autowired
    private TestAuth auth;

    private Gate mainGate;
    private Gate serviceGate;
    private PropertyNode flat;
    private AppUser admin;
    private AppUser guard;
    private AppUser resident;

    @BeforeEach
    void seed() {
        data.reset();
        flat = data.flat(data.block("Block A"), "A-101");
        mainGate = data.gate("Main Gate");
        serviceGate = data.gate("Service Gate");
        admin = data.admin();
        guard = data.guard();
        resident = data.resident(flat);
    }

    @Test
    @DisplayName("a visitor who came in at the main gate is on every gate's inside list and checks out at the service gate")
    void inAtOneGateOutAtAnother() throws Exception {
        String visitId = walkIn(mainGate);
        as(resident, patch("/api/v1/visits/" + visitId + "/decision"), Map.of("decision", "APPROVED"))
                .andExpect(jsonPath("$.status").value("CHECKED_IN"));

        // The guard at the service gate sees them, though they did not come in there.
        as(guard, get("/api/v1/admin/inside"), null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.insideCount").value(1))
                .andExpect(jsonPath("$.visits[0].gateName").value(mainGate.getName()));

        as(guard, patch("/api/v1/visits/" + visitId + "/check-out"), Map.of("gateId", serviceGate.getId().toString()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("CHECKED_OUT"))
                .andExpect(jsonPath("$.gateName").value(mainGate.getName()))
                .andExpect(jsonPath("$.exitGateName").value(serviceGate.getName()));

        as(admin, get("/api/v1/admin/inside"), null).andExpect(jsonPath("$.insideCount").value(0));
        // The log keeps both ends of the stay.
        as(admin, get("/api/v1/admin/visits"), null)
                .andExpect(jsonPath("$.content[0].gateName").value(mainGate.getName()))
                .andExpect(jsonPath("$.content[0].exitGateName").value(serviceGate.getName()));
    }

    @Test
    @DisplayName("checking out without naming a gate records the entry gate, as before")
    void checkOutWithoutGateUsesEntryGate() throws Exception {
        String visitId = walkIn(mainGate);
        as(resident, patch("/api/v1/visits/" + visitId + "/decision"), Map.of("decision", "APPROVED"));

        as(guard, patch("/api/v1/visits/" + visitId + "/check-out"), null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.exitGateName").value(mainGate.getName()));
    }

    @Test
    @DisplayName("another township's gate is not an exit: 404, and the visitor stays inside")
    void foreignExitGateRefused() throws Exception {
        Township other = data.township("OTHER");
        Gate foreignGate = data.gate(other, "Their Gate");
        String visitId = walkIn(mainGate);
        as(resident, patch("/api/v1/visits/" + visitId + "/decision"), Map.of("decision", "APPROVED"));

        as(guard, patch("/api/v1/visits/" + visitId + "/check-out"), Map.of("gateId", foreignGate.getId().toString()))
                .andExpect(status().isNotFound());
        as(admin, get("/api/v1/admin/inside"), null).andExpect(jsonPath("$.insideCount").value(1));
    }

    @Test
    @DisplayName("a resident still cannot read who is inside")
    void residentCannotReadInsideList() throws Exception {
        as(resident, get("/api/v1/admin/inside"), null).andExpect(status().isForbidden());
    }

    private String walkIn(Gate gate) throws Exception {
        Map<String, Object> request = new HashMap<>();
        request.put("gateId", gate.getId().toString());
        request.put("visitorType", "GUEST");
        request.put("visitorName", "Ravi Kumar");
        request.put("targetFlatId", flat.getId().toString());
        JsonNode body = objectMapper.readTree(as(guard, post("/api/v1/visits"), request)
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString());
        return body.get("id").asText();
    }

    private ResultActions as(AppUser actor, MockHttpServletRequestBuilder request, Object body) throws Exception {
        MockHttpServletRequestBuilder withAuth = request.header(HttpHeaders.AUTHORIZATION, auth.bearer(actor));
        if (body != null) {
            withAuth = withAuth.contentType(MediaType.APPLICATION_JSON).content(json(body));
        }
        return mockMvc.perform(withAuth);
    }
}
