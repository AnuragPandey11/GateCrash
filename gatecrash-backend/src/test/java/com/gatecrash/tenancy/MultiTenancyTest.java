package com.gatecrash.tenancy;

import com.gatecrash.property.PropertyNode;
import com.gatecrash.common.tenant.TenantContextFilter;
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

import java.time.OffsetDateTime;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The negative tenancy matrix -- the multi-tenant counterpart to {@code RbacNegativeTest}.
 *
 * <p>Every case here holds a <em>valid</em> token for a <em>real</em> account with the <em>right</em>
 * role, and is refused anyway because the row it reaches for belongs to a different township. That is
 * the whole point: role-based checks pass in all of these, so if the tenant boundary is not enforced
 * independently, every one of them succeeds.
 *
 * <p>Two townships are stood up with deliberately identical internal structure -- the same block
 * name, the same flat number, and therefore the same derived resident login id -- because the
 * collisions that multi-tenancy has to survive are exactly the ones that a single-tenant schema made
 * impossible.
 */
@DisplayName("Tenancy: a valid token for the right role still stops at the township boundary")
class MultiTenancyTest extends AbstractIntegrationTest {

    @Autowired
    private TestDataFactory data;

    @Autowired
    private TestAuth auth;

    private Township alpha;
    private Township beta;

    private Gate alphaGate;
    private Gate betaGate;
    private PropertyNode alphaFlat;
    private PropertyNode betaFlat;
    private AppUser alphaAdmin;
    private AppUser betaAdmin;
    private AppUser alphaGuard;
    private AppUser betaGuard;
    private AppUser alphaResident;
    private AppUser betaResident;

    @BeforeEach
    void seed() {
        data.reset();
        alpha = data.primaryTownship();
        beta = data.township("BETA");

        alphaFlat = data.flat(data.block(alpha, "Block A"), "A-101");
        betaFlat = data.flat(data.block(beta, "Block A"), "A-101");
        alphaGate = data.gate(alpha, "Main Gate");
        betaGate = data.gate(beta, "Main Gate");

        alphaAdmin = data.admin(alpha);
        betaAdmin = data.admin(beta);
        alphaGuard = data.guard(alpha);
        betaGuard = data.guard(beta);
        alphaResident = data.resident(alphaFlat);
        betaResident = data.resident(betaFlat);
    }

    // ----- identity ---------------------------------------------------------------------------

    @Test
    @DisplayName("the same login id in two townships is two different accounts")
    void loginIdIsScopedToItsTownship() throws Exception {
        // Both townships have a block A with flat A-101, so both derive the same resident login id.
        // What separates them is the township code, and nothing else.
        AppUser sharedNameAlpha = data.user(alpha, com.gatecrash.user.UserRole.GUARD, "shared", null);
        String sharedLoginId = sharedNameAlpha.getLoginId();
        data.user(beta, com.gatecrash.user.UserRole.GUARD, "ignored", null)
                .setLoginId(sharedLoginId);

        String alphaBody = login(alpha, sharedLoginId).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        assertThat(objectMapper.readTree(alphaBody).get("userId").asText())
                .isEqualTo(sharedNameAlpha.getId().toString());
        assertThat(objectMapper.readTree(alphaBody).get("townshipCode").asText())
                .isEqualTo(alpha.getCode());
    }

    @Test
    @DisplayName("correct credentials against the wrong township code are rejected")
    void credentialsDoNotCrossTownships() throws Exception {
        login(beta, alphaResident.getLoginId()).andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("omitting the township code does not fall back to searching every township")
    void omittedCodeResolvesOnlyThePlatformNamespace() throws Exception {
        Map<String, Object> body = Map.of(
                "loginId", alphaResident.getLoginId(), "password", TestDataFactory.PASSWORD);
        mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(body)))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("an unknown township code is indistinguishable from a wrong password")
    void unknownTownshipCodeLeaksNothing() throws Exception {
        String unknownTownship = mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("townshipCode", "NO-SUCH-TOWNSHIP",
                                "loginId", alphaResident.getLoginId(),
                                "password", TestDataFactory.PASSWORD))))
                .andExpect(status().isUnauthorized())
                .andReturn().getResponse().getContentAsString();

        String wrongPassword = mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("townshipCode", alpha.getCode(),
                                "loginId", alphaResident.getLoginId(),
                                "password", "WrongPassw0rd!"))))
                .andExpect(status().isUnauthorized())
                .andReturn().getResponse().getContentAsString();

        assertThat(objectMapper.readTree(unknownTownship).get("message").asText())
                .isEqualTo(objectMapper.readTree(wrongPassword).get("message").asText());
    }

    // ----- the tenant header ------------------------------------------------------------------

    @Test
    @DisplayName("an ordinary account cannot assert a different township with the tenant header")
    void tenantHeaderIsRefusedForOrdinaryAccounts() throws Exception {
        mockMvc.perform(get("/api/v1/admin/users")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(alphaAdmin))
                        .header(TenantContextFilter.TOWNSHIP_HEADER, beta.getId().toString()))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("TOWNSHIP_MISMATCH"));
    }

    // ----- accounts ---------------------------------------------------------------------------

    @Test
    @DisplayName("an admin's account listing contains only their own township")
    void userListingIsScoped() throws Exception {
        String body = mockMvc.perform(get("/api/v1/admin/users?size=100")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(alphaAdmin)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        assertThat(body).contains(alphaAdmin.getId().toString(), alphaGuard.getId().toString());
        assertThat(body).doesNotContain(betaAdmin.getId().toString(), betaGuard.getId().toString(),
                betaResident.getId().toString());
    }

    @Test
    @DisplayName("an admin cannot fetch an account from another township")
    void cannotReadAnotherTownshipsUser() throws Exception {
        mockMvc.perform(get("/api/v1/admin/users/" + betaResident.getId())
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(alphaAdmin)))
                // 404, not 403: across a tenant boundary, "not yours" and "does not exist" must be
                // the same answer, or the endpoint becomes an existence oracle.
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("an admin cannot reset a password in another township")
    void cannotResetAnotherTownshipsPassword() throws Exception {
        mockMvc.perform(post("/api/v1/admin/users/" + betaGuard.getId() + "/reset-password")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(alphaAdmin)))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("a township admin cannot appoint another admin")
    void adminCannotAppointAdmin() throws Exception {
        mockMvc.perform(post("/api/v1/admin/users")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(alphaAdmin))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("role", "ADMIN", "loginId", "co-admin",
                                "fullName", "Co Admin"))))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ADMIN_REQUIRES_SUPER_ADMIN"));
    }

    // ----- township structure -----------------------------------------------------------------

    @Test
    @DisplayName("the same block and flat names coexist in two townships")
    void namesCollideAcrossTownshipsWithoutConflict() throws Exception {
        mockMvc.perform(post("/api/v1/admin/property/nodes")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(alphaAdmin))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("name", "Tower 9"))))
                .andExpect(status().isCreated());

        // Same name, other township: allowed, because uniqueness is per tenant.
        mockMvc.perform(post("/api/v1/admin/property/nodes")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(betaAdmin))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("name", "Tower 9"))))
                .andExpect(status().isCreated());

        // Same name, same township: still a conflict.
        mockMvc.perform(post("/api/v1/admin/property/nodes")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(alphaAdmin))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("name", "Tower 9"))))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("NODE_NAME_EXISTS"));
    }

    @Test
    @DisplayName("a gate listing contains only the caller's township")
    void gateListingIsScoped() throws Exception {
        String body = mockMvc.perform(get("/api/v1/admin/gates")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(alphaGuard)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        assertThat(body).contains(alphaGate.getId().toString());
        assertThat(body).doesNotContain(betaGate.getId().toString());
    }

    @Test
    @DisplayName("an admin cannot delete a flat in another township")
    void cannotDeleteAnotherTownshipsFlat() throws Exception {
        mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .delete("/api/v1/admin/property/nodes/" + betaFlat.getId())
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(alphaAdmin)))
                .andExpect(status().isNotFound());
    }

    // ----- visits -----------------------------------------------------------------------------

    @Test
    @DisplayName("a guard cannot log a visit at another township's gate")
    void cannotLogVisitAtForeignGate() throws Exception {
        Map<String, Object> request = new HashMap<>();
        request.put("gateId", betaGate.getId().toString());
        request.put("visitorType", "GUEST");
        request.put("visitorName", "Trespasser");
        request.put("targetFlatId", alphaFlat.getId().toString());

        mockMvc.perform(post("/api/v1/visits")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(alphaGuard))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(request)))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("a guard cannot route a visit to a flat in another township")
    void cannotRouteVisitToForeignFlat() throws Exception {
        Map<String, Object> request = new HashMap<>();
        request.put("gateId", alphaGate.getId().toString());
        request.put("visitorType", "GUEST");
        request.put("visitorName", "Misrouted");
        request.put("targetFlatId", betaFlat.getId().toString());

        mockMvc.perform(post("/api/v1/visits")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(alphaGuard))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(request)))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("a resident cannot see or decide a visit in another township")
    void cannotReachAForeignVisit() throws Exception {
        UUID betaVisit = logWalkIn(betaGuard, betaGate, betaFlat);

        // Beta's own resident can, which is what makes the refusals below about tenancy and not
        // about the visit being unreachable in general.
        mockMvc.perform(get("/api/v1/visits/" + betaVisit)
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(betaResident)))
                .andExpect(status().isOk());

        mockMvc.perform(get("/api/v1/visits/" + betaVisit)
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(alphaResident)))
                .andExpect(status().isNotFound());
        mockMvc.perform(get("/api/v1/visits/" + betaVisit)
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(alphaAdmin)))
                .andExpect(status().isNotFound());
        mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .patch("/api/v1/visits/" + betaVisit + "/decision")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(alphaResident))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("decision", "APPROVED"))))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("a guard cannot check in another township's visit")
    void cannotCheckInAForeignVisit() throws Exception {
        UUID betaVisit = logWalkIn(betaGuard, betaGate, betaFlat);

        mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .patch("/api/v1/visits/" + betaVisit + "/check-in")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(alphaGuard)))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("the occupancy report counts only the caller's township")
    void occupancyIsScoped() throws Exception {
        UUID betaVisit = logWalkIn(betaGuard, betaGate, betaFlat);
        decide(betaResident, betaVisit);
        mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .patch("/api/v1/visits/" + betaVisit + "/check-in")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(betaGuard)))
                .andExpect(status().isOk());

        mockMvc.perform(get("/api/v1/admin/inside")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(betaAdmin)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.insideCount").value(1));

        mockMvc.perform(get("/api/v1/admin/inside")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(alphaAdmin)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.insideCount").value(0));
    }

    // ----- passes -----------------------------------------------------------------------------

    @Test
    @DisplayName("a pass minted in one township is not a key at another township's gate")
    void passDoesNotRedeemAcrossTownships() throws Exception {
        String minted = mockMvc.perform(post("/api/v1/passes")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(betaResident))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(passRequest())))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        String pin = objectMapper.readTree(minted).get("pin").asText();
        String qrToken = objectMapper.readTree(minted).get("qrToken").asText();

        // Alpha's guard, at alpha's gate, holding beta's PIN and beta's QR token.
        mockMvc.perform(post("/api/v1/passes/redeem")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(alphaGuard))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("pin", pin, "gateId", alphaGate.getId().toString()))))
                .andExpect(status().isNotFound());

        mockMvc.perform(post("/api/v1/passes/redeem")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(alphaGuard))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("qrToken", qrToken,
                                "gateId", alphaGate.getId().toString()))))
                .andExpect(status().isNotFound());

        // The same pass still works at home, so the refusals above are about tenancy, not validity.
        mockMvc.perform(post("/api/v1/passes/redeem")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(betaGuard))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("pin", pin, "gateId", betaGate.getId().toString()))))
                .andExpect(status().isOk());
    }

    // ----- broadcasts -------------------------------------------------------------------------

    @Test
    @DisplayName("an ALL notification stops at the township boundary")
    void broadcastDoesNotCrossTownships() throws Exception {
        mockMvc.perform(post("/api/v1/notifications")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(betaAdmin))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("title", "Water shutoff", "body", "Tomorrow 9am",
                                "audienceRule", Map.of("mode", "ALL")))))
                .andExpect(status().isCreated())
                // beta's admin, guard and resident -- and nobody from alpha.
                .andExpect(jsonPath("$.recipientCount").value(3));

        mockMvc.perform(get("/api/v1/notifications/mine")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(alphaResident)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").isEmpty());
    }

    @Test
    @DisplayName("a FLATS rule naming another township's flat resolves to nobody")
    void targetedBroadcastCannotReachAcross() throws Exception {
        mockMvc.perform(post("/api/v1/notifications")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(alphaAdmin))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("title", "Hello", "body", "Body",
                                "audienceRule", Map.of("mode", "FLATS",
                                        "flatIds", java.util.List.of(betaFlat.getId().toString()))))))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("EMPTY_AUDIENCE"));
    }

    @Test
    @DisplayName("the community feed is per township")
    void communityFeedIsScoped() throws Exception {
        mockMvc.perform(post("/api/v1/community/posts")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(betaAdmin))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("title", "Beta only", "body", "Internal notice",
                                "pinned", false))))
                .andExpect(status().isCreated());

        mockMvc.perform(get("/api/v1/community/posts")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(alphaResident)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").isEmpty());

        mockMvc.perform(get("/api/v1/community/posts")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(betaResident)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].title").value("Beta only"));
    }

    // ----- helpers ----------------------------------------------------------------------------

    private ResultActions login(Township township, String loginId) throws Exception {
        return mockMvc.perform(post("/api/v1/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(Map.of("townshipCode", township.getCode(), "loginId", loginId,
                        "password", TestDataFactory.PASSWORD))));
    }

    private UUID logWalkIn(AppUser guard, Gate gate, PropertyNode flat) throws Exception {
        Map<String, Object> request = new HashMap<>();
        request.put("gateId", gate.getId().toString());
        request.put("visitorType", "GUEST");
        request.put("visitorName", "Ravi Kumar");
        request.put("targetFlatId", flat.getId().toString());

        String body = mockMvc.perform(post("/api/v1/visits")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(guard))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(request)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return UUID.fromString(objectMapper.readTree(body).get("id").asText());
    }

    private void decide(AppUser approver, UUID visitId) throws Exception {
        mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .patch("/api/v1/visits/" + visitId + "/decision")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(approver))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("decision", "APPROVED"))))
                .andExpect(status().isOk());
    }

    private Map<String, Object> passRequest() {
        Map<String, Object> request = new HashMap<>();
        request.put("visitorType", "GUEST");
        request.put("visitorName", "Expected Guest");
        request.put("maxUses", 1);
        request.put("validUntil", OffsetDateTime.now().plusHours(4).toString());
        return request;
    }
}
