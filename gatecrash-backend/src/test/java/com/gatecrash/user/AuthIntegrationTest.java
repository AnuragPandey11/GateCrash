package com.gatecrash.user;

import com.gatecrash.property.PropertyNode;
import com.gatecrash.support.AbstractIntegrationTest;
import com.gatecrash.support.TestAuth;
import com.gatecrash.support.TestDataFactory;
import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@DisplayName("Authentication: login, refresh rotation, forced reset, revocation")
class AuthIntegrationTest extends AbstractIntegrationTest {

    @Autowired
    private TestDataFactory data;

    @Autowired
    private TestAuth auth;

    @Autowired
    private AppUserRepository users;

    @Autowired
    private RefreshTokenRepository refreshTokens;

    private AppUser resident;
    private PropertyNode flat;

    @BeforeEach
    void seed() {
        data.reset();
        flat = data.flat(data.block("Block A"), "A-101");
        resident = data.resident(flat);
    }

    @Test
    @DisplayName("valid credentials return an access/refresh pair")
    void loginSucceeds() throws Exception {
        mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("townshipCode", data.primaryTownship().getCode(), "loginId", resident.getLoginId(),
                                "password", TestDataFactory.PASSWORD))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken").isNotEmpty())
                .andExpect(jsonPath("$.refreshToken").isNotEmpty())
                .andExpect(jsonPath("$.role").value("RESIDENT"))
                .andExpect(jsonPath("$.mustResetPassword").value(false));
    }

    @Test
    @DisplayName("a wrong password and an unknown account are indistinguishable")
    void loginFailuresAreIndistinguishable() throws Exception {
        String wrongPassword = mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("townshipCode", data.primaryTownship().getCode(), "loginId", resident.getLoginId(), "password", "WrongPassw0rd!"))))
                .andExpect(status().isUnauthorized())
                .andReturn().getResponse().getContentAsString();

        String unknownUser = mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("townshipCode", data.primaryTownship().getCode(), "loginId", "no-such-account", "password", "WrongPassw0rd!"))))
                .andExpect(status().isUnauthorized())
                .andReturn().getResponse().getContentAsString();

        // Same code and same message; only the correlation id and timestamp differ.
        assertThat(field(wrongPassword, "code")).isEqualTo(field(unknownUser, "code"));
        assertThat(field(wrongPassword, "message")).isEqualTo(field(unknownUser, "message"));
    }

    @Test
    @DisplayName("a deactivated account cannot log in")
    void inactiveAccountCannotLogIn() throws Exception {
        resident.setActive(false);
        users.save(resident);

        mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("townshipCode", data.primaryTownship().getCode(), "loginId", resident.getLoginId(),
                                "password", TestDataFactory.PASSWORD))))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("repeated failures trip the lockout")
    void bruteForceIsThrottled() throws Exception {
        for (int attempt = 0; attempt < 5; attempt++) {
            mockMvc.perform(post("/api/v1/auth/login")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(json(Map.of("townshipCode", data.primaryTownship().getCode(), "loginId", resident.getLoginId(), "password", "Wrong" + attempt))))
                    .andExpect(status().isUnauthorized());
        }
        // The next attempt is refused before the password is even checked -- note it uses the
        // *correct* password, and still fails.
        mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("townshipCode", data.primaryTownship().getCode(), "loginId", resident.getLoginId(),
                                "password", TestDataFactory.PASSWORD))))
                .andExpect(status().isTooManyRequests());
    }

    @Test
    @DisplayName("a refresh rotates the token and invalidates the old one")
    void refreshRotates() throws Exception {
        String first = login();

        String body = mockMvc.perform(post("/api/v1/auth/refresh")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("refreshToken", first))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        String second = field(body, "refreshToken");
        assertThat(second).isNotEqualTo(first);

        // Replaying the spent token is refused.
        mockMvc.perform(post("/api/v1/auth/refresh")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("refreshToken", first))))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("REFRESH_TOKEN_REUSED"));
    }

    @Test
    @DisplayName("replaying a spent token burns the whole rotation family")
    void reuseDetectionRevokesFamily() throws Exception {
        String first = login();
        String second = field(mockMvc.perform(post("/api/v1/auth/refresh")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("refreshToken", first))))
                .andReturn().getResponse().getContentAsString(), "refreshToken");

        // Attacker replays the old token...
        mockMvc.perform(post("/api/v1/auth/refresh")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("refreshToken", first))))
                .andExpect(status().isUnauthorized());

        // ...which also invalidates the legitimate holder's current token.
        mockMvc.perform(post("/api/v1/auth/refresh")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("refreshToken", second))))
                .andExpect(status().isUnauthorized());
        assertThat(refreshTokens.countByUserIdAndRevokedFalse(resident.getId())).isZero();
    }

    @Test
    @DisplayName("changing a password revokes refresh tokens and old access tokens")
    void passwordChangeRevokesSessions() throws Exception {
        String staleAccessToken = auth.bearer(resident);
        String refreshToken = login();

        mockMvc.perform(post("/api/v1/auth/password")
                        .header(HttpHeaders.AUTHORIZATION, staleAccessToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("currentPassword", TestDataFactory.PASSWORD,
                                "newPassword", "BrandNewPassw0rd!"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken").isNotEmpty());

        // The token version moved on, so the previously valid access token is now refused.
        mockMvc.perform(get("/api/v1/auth/me").header(HttpHeaders.AUTHORIZATION, staleAccessToken))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("TOKEN_REVOKED"));

        mockMvc.perform(post("/api/v1/auth/refresh")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("refreshToken", refreshToken))))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("a weak new password is rejected")
    void weakPasswordRejected() throws Exception {
        mockMvc.perform(post("/api/v1/auth/password")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(resident))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("currentPassword", TestDataFactory.PASSWORD,
                                "newPassword", "alllowercaseletters"))))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("WEAK_PASSWORD"));
    }

    @Test
    @DisplayName("a pending forced reset blocks every endpoint except the reset itself")
    void forcedResetGatesTheApi() throws Exception {
        resident.setMustResetPassword(true);
        users.save(resident);
        String token = auth.bearer(resident);

        mockMvc.perform(get("/api/v1/visits/pending").header(HttpHeaders.AUTHORIZATION, token))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("PASSWORD_RESET_REQUIRED"));

        // The reset endpoint itself stays reachable, and clears the flag.
        mockMvc.perform(post("/api/v1/auth/password")
                        .header(HttpHeaders.AUTHORIZATION, token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("currentPassword", TestDataFactory.PASSWORD,
                                "newPassword", "ChosenByMe#2026"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.mustResetPassword").value(false));
    }

    private String login() throws Exception {
        String body = mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("townshipCode", data.primaryTownship().getCode(), "loginId", resident.getLoginId(),
                                "password", TestDataFactory.PASSWORD))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return field(body, "refreshToken");
    }

    private String field(String body, String name) throws Exception {
        JsonNode node = objectMapper.readTree(body).get(name);
        return node == null ? null : node.asText();
    }
}
