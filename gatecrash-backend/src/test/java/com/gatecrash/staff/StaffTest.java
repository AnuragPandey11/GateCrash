package com.gatecrash.staff;

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
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Daily help and society staff: registration, linking, the gate register, ratings and the office. */
@DisplayName("Daily help and staff")
class StaffTest extends AbstractIntegrationTest {

    @Autowired
    private TestDataFactory data;

    @Autowired
    private TestAuth auth;

    @Autowired
    private JdbcTemplate jdbc;

    private Gate gate;
    private AppUser admin;
    private AppUser guard;
    private AppUser residentA;
    private AppUser residentB;

    @BeforeEach
    void seed() {
        data.reset();
        PropertyNode block = data.block("Block A");
        PropertyNode flatA = data.flat(block, "A-101");
        PropertyNode flatB = data.flat(block, "A-102");
        gate = data.gate("Main Gate");
        admin = data.admin();
        guard = data.guard();
        residentA = data.resident(flatA);
        residentB = data.resident(flatB);
    }

    @Test
    @DisplayName("a resident registers a helper; the guard marks them in and out; the home sees the register")
    void dailyHelpLoop() throws Exception {
        JsonNode created = body(as(residentA, post("/api/v1/staff"), Map.of(
                "category", "MAID", "fullName", "Asha", "phone", "9876543210"))
                .andExpect(status().isCreated()));
        String code = created.get("code").asText();
        String staffId = created.at("/staff/id").asText();
        String qrToken = created.at("/staff/qrToken").asText();
        assertThat(code).matches("^[0-9]{6}$");
        assertThat(jdbc.queryForObject("select count(*) from staff_member where code_lookup = ?", Long.class, code))
                .as("the code is never stored in plaintext").isZero();

        as(guard, post("/api/v1/staff/gate/lookup"), Map.of("code", code))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.fullName").value("Asha"))
                .andExpect(jsonPath("$.householdUnits[0]").value("A-101"))
                .andExpect(jsonPath("$.qrToken").doesNotExist());
        as(guard, post("/api/v1/staff/gate/lookup"), Map.of("qrToken", qrToken))
                .andExpect(jsonPath("$.id").value(staffId));

        Map<String, Object> atGate = Map.of("gateId", gate.getId().toString());
        as(residentA, post("/api/v1/staff/" + staffId + "/check-in"), atGate).andExpect(status().isForbidden());
        as(guard, post("/api/v1/staff/" + staffId + "/check-in"), atGate)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.gateName").value(gate.getName()));
        as(guard, post("/api/v1/staff/" + staffId + "/check-in"), atGate)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("ALREADY_INSIDE"));

        as(residentA, get("/api/v1/staff/mine"), null)
                .andExpect(jsonPath("$[0].insideNow").value(true))
                .andExpect(jsonPath("$[0].householdUnits").doesNotExist());
        as(guard, get("/api/v1/staff/inside"), null).andExpect(jsonPath("$.length()").value(1));

        as(guard, post("/api/v1/staff/" + staffId + "/check-out"), atGate).andExpect(status().isOk());
        as(guard, post("/api/v1/staff/" + staffId + "/check-out"), atGate)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("NOT_INSIDE"));

        as(residentA, get("/api/v1/staff/" + staffId + "/attendance"), null)
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].checkedOutAt").exists());
        as(residentB, get("/api/v1/staff/" + staffId + "/attendance"), null).andExpect(status().isForbidden());
        as(admin, get("/api/v1/admin/staff/attendance"), null).andExpect(jsonPath("$.length()").value(1));
    }

    @Test
    @DisplayName("another home adds the same helper by code, not by registering them twice")
    void linkByCode() throws Exception {
        JsonNode created = body(as(residentA, post("/api/v1/staff"), Map.of(
                "category", "COOK", "fullName", "Meena", "phone", "9123456780")));
        String code = created.get("code").asText();
        String staffId = created.at("/staff/id").asText();

        as(residentB, post("/api/v1/staff"), Map.of("category", "COOK", "fullName", "Meena", "phone", "9123456780"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("STAFF_EXISTS"));
        as(residentB, post("/api/v1/staff/link"), Map.of("code", code.equals("000000") ? "111111" : "000000"))
                .andExpect(status().isNotFound());
        as(residentB, post("/api/v1/staff/link"), Map.of("code", code))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.householdCount").value(2));
        as(residentB, post("/api/v1/staff/link"), Map.of("code", code))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("ALREADY_LINKED"));

        as(residentB, put("/api/v1/staff/" + staffId + "/rating"), Map.of("rating", 5))
                .andExpect(jsonPath("$.myRating").value(5));
        as(residentA, put("/api/v1/staff/" + staffId + "/rating"), Map.of("rating", 3, "review", "Often late"))
                .andExpect(jsonPath("$.averageRating").value(4.0))
                .andExpect(jsonPath("$.ratingCount").value(2));

        as(residentB, delete("/api/v1/staff/" + staffId + "/households/mine"), null).andExpect(status().isNoContent());
        as(residentB, put("/api/v1/staff/" + staffId + "/rating"), Map.of("rating", 1))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("only the office adds society staff; a deactivated person cannot be marked in; a reissued code replaces the old")
    void officeStaff() throws Exception {
        Map<String, Object> plumber = Map.of("scope", "SOCIETY_STAFF", "category", "PLUMBER", "fullName", "Ramesh");
        as(residentA, post("/api/v1/admin/staff"), plumber).andExpect(status().isForbidden());
        as(guard, post("/api/v1/admin/staff"), plumber).andExpect(status().isForbidden());
        JsonNode created = body(as(admin, post("/api/v1/admin/staff"), plumber).andExpect(status().isCreated()));
        String code = created.get("code").asText();
        String staffId = created.at("/staff/id").asText();

        as(residentA, post("/api/v1/staff/link"), Map.of("code", code))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("NOT_DAILY_HELP"));

        as(admin, post("/api/v1/admin/staff/" + staffId + "/active"), Map.of("active", false))
                .andExpect(jsonPath("$.active").value(false));
        as(guard, post("/api/v1/staff/" + staffId + "/check-in"), Map.of("gateId", gate.getId().toString()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("STAFF_INACTIVE"));

        String fresh = body(as(admin, post("/api/v1/admin/staff/" + staffId + "/reissue-code"), null)
                .andExpect(status().isOk())).get("code").asText();
        if (!fresh.equals(code)) {
            as(guard, post("/api/v1/staff/gate/lookup"), Map.of("code", code)).andExpect(status().isNotFound());
        }
        as(guard, post("/api/v1/staff/gate/lookup"), Map.of("code", fresh)).andExpect(jsonPath("$.id").value(staffId));
    }

    @Test
    @DisplayName("another township's guard cannot identify this township's staff")
    void tenantIsolation() throws Exception {
        String code = body(as(residentA, post("/api/v1/staff"), Map.of(
                "category", "DRIVER", "fullName", "Kumar", "phone", "9000000001"))).get("code").asText();
        Township other = data.township("OTHER");
        as(data.guard(other), post("/api/v1/staff/gate/lookup"), Map.of("code", code))
                .andExpect(status().isNotFound());
    }

    private ResultActions as(AppUser actor, MockHttpServletRequestBuilder request, Object body) throws Exception {
        MockHttpServletRequestBuilder withAuth = request.header(HttpHeaders.AUTHORIZATION, auth.bearer(actor));
        if (body != null) {
            withAuth = withAuth.contentType(MediaType.APPLICATION_JSON).content(json(body));
        }
        return mockMvc.perform(withAuth);
    }

    private JsonNode body(ResultActions result) throws Exception {
        return objectMapper.readTree(result.andReturn().getResponse().getContentAsString());
    }
}
