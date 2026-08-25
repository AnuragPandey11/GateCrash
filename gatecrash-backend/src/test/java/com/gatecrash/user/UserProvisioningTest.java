package com.gatecrash.user;

import com.gatecrash.support.AbstractIntegrationTest;
import com.gatecrash.support.TestAuth;
import com.gatecrash.support.TestDataFactory;
import com.gatecrash.township.Flat;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

import java.util.HashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@DisplayName("Admin provisioning: login-id sequencing and one-time passwords")
class UserProvisioningTest extends AbstractIntegrationTest {

    @Autowired
    private TestDataFactory data;

    @Autowired
    private TestAuth auth;

    private AppUser admin;
    private Flat flat;

    @BeforeEach
    void seed() {
        data.reset();
        flat = data.flat(data.block("Block A"), "A-101");
        admin = data.admin();
    }

    @Test
    @DisplayName("resident login ids follow the per-flat sequence A-101-1, A-101-2")
    void residentLoginIdsAreSequential() throws Exception {
        assertThat(createResident("Asha Rao")).isEqualTo("A-101-1");
        assertThat(createResident("Bharat Rao")).isEqualTo("A-101-2");
        assertThat(createResident("Chitra Rao")).isEqualTo("A-101-3");
    }

    @Test
    @DisplayName("the generated password works exactly once, then a reset is forced")
    void generatedPasswordLogsInAndForcesReset() throws Exception {
        Map<String, Object> request = new HashMap<>();
        request.put("role", "RESIDENT");
        request.put("flatId", flat.getId().toString());
        request.put("fullName", "Asha Rao");

        String created = mockMvc.perform(post("/api/v1/admin/users")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(admin))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(request)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.generatedPassword").isNotEmpty())
                .andReturn().getResponse().getContentAsString();

        String loginId = objectMapper.readTree(created).get("loginId").asText();
        String password = objectMapper.readTree(created).get("generatedPassword").asText();

        mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("townshipCode", data.primaryTownship().getCode(), "loginId", loginId, "password", password))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.mustResetPassword").value(true));
    }

    @Test
    @DisplayName("a reset issues a new password and invalidates the old one")
    void resetPasswordInvalidatesTheOldOne() throws Exception {
        AppUser guard = data.guard();
        String oldPassword = TestDataFactory.PASSWORD;

        String reset = mockMvc.perform(post("/api/v1/admin/users/" + guard.getId() + "/reset-password")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(admin)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String newPassword = objectMapper.readTree(reset).get("generatedPassword").asText();

        assertThat(newPassword).isNotEqualTo(oldPassword);
        mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("townshipCode", data.primaryTownship().getCode(), "loginId", guard.getLoginId(), "password", oldPassword))))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("townshipCode", data.primaryTownship().getCode(), "loginId", guard.getLoginId(), "password", newPassword))))
                .andExpect(status().isOk());
    }

    @Test
    @DisplayName("a resident without a flat is rejected")
    void residentRequiresFlat() throws Exception {
        mockMvc.perform(post("/api/v1/admin/users")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(admin))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("role", "RESIDENT", "fullName", "Nobody"))))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("FLAT_REQUIRED"));
    }

    @Test
    @DisplayName("a duplicate staff login id is a conflict, not a second account")
    void duplicateStaffLoginIdConflicts() throws Exception {
        Map<String, Object> request = Map.of("role", "GUARD", "loginId", "gate-staff-1",
                "fullName", "Gate Staff");

        mockMvc.perform(post("/api/v1/admin/users")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(admin))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(request)))
                .andExpect(status().isCreated());

        mockMvc.perform(post("/api/v1/admin/users")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(admin))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(request)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("LOGIN_ID_TAKEN"));
    }

    @Test
    @DisplayName("the password hash never appears in any response")
    void passwordHashIsNeverExposed() throws Exception {
        String body = mockMvc.perform(post("/api/v1/admin/users")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(admin))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("role", "GUARD", "loginId", "no-leak", "fullName", "No Leak"))))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();

        assertThat(body).doesNotContain("passwordHash").doesNotContain("$2a$");
    }

    private String createResident(String fullName) throws Exception {
        Map<String, Object> request = new HashMap<>();
        request.put("role", "RESIDENT");
        request.put("flatId", flat.getId().toString());
        request.put("fullName", fullName);

        String body = mockMvc.perform(post("/api/v1/admin/users")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(admin))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(request)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(body).get("loginId").asText();
    }
}
