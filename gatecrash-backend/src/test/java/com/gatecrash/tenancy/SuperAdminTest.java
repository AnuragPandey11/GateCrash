package com.gatecrash.tenancy;

import com.gatecrash.common.tenant.TenantContextFilter;
import com.gatecrash.support.AbstractIntegrationTest;
import com.gatecrash.support.TestAuth;
import com.gatecrash.support.TestDataFactory;
import com.gatecrash.township.Township;
import com.gatecrash.township.TownshipRepository;
import com.gatecrash.township.TownshipStatus;
import com.gatecrash.user.AppUser;
import com.gatecrash.user.UserRole;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The platform surface: onboarding a township, appointing and removing its administrators,
 * suspending, archiving and restoring it, and acting inside one.
 *
 * <p>Two properties get the most attention here because they are the ones with no recovery path if
 * they are wrong: archiving must lock a township out <em>immediately</em> rather than when tokens
 * happen to expire, and it must not destroy anything -- restoring has to find the township exactly as
 * it was. The rest is the invariant that the platform can never be left with nobody able to
 * administer it, or a township with nobody able to administer that.
 */
@DisplayName("Super admin: township lifecycle and the platform's own accounts")
class SuperAdminTest extends AbstractIntegrationTest {

    @Autowired
    private TestDataFactory data;

    @Autowired
    private TestAuth auth;

    @Autowired
    private TownshipRepository townships;

    private AppUser superAdmin;

    @BeforeEach
    void seed() {
        data.reset();
        superAdmin = data.superAdmin();
    }

    // ----- onboarding -------------------------------------------------------------------------

    @Test
    @DisplayName("creating a township returns its first admin's password exactly once, and it works")
    void createTownshipProvisionsAWorkingAdmin() throws Exception {
        String body = createTownship("GREENWOOD", "greenwood-admin")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.township.code").value("GREENWOOD"))
                .andExpect(jsonPath("$.township.status").value("ACTIVE"))
                .andExpect(jsonPath("$.township.activeAdminCount").value(1))
                .andExpect(jsonPath("$.admin.generatedPassword").isNotEmpty())
                .andReturn().getResponse().getContentAsString();

        String password = objectMapper.readTree(body).get("admin").get("generatedPassword").asText();

        // The credential is the pair: the code identifies the namespace, the login id the account.
        mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("townshipCode", "GREENWOOD",
                                "loginId", "greenwood-admin", "password", password))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.role").value("ADMIN"))
                .andExpect(jsonPath("$.townshipCode").value("GREENWOOD"))
                // Provisioned accounts always start behind the forced-reset gate.
                .andExpect(jsonPath("$.mustResetPassword").value(true));
    }

    @Test
    @DisplayName("a lower-case code is normalised, and the code is unique across the platform")
    void townshipCodesAreNormalisedAndUnique() throws Exception {
        createTownship("riverside", "riverside-admin")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.township.code").value("RIVERSIDE"));

        createTownship("RIVERSIDE", "another-admin")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("TOWNSHIP_CODE_TAKEN"));
    }

    // ----- reach ------------------------------------------------------------------------------

    @Test
    @DisplayName("a super admin acts inside a township by naming it in the tenant header")
    void superAdminActsInsideANamedTownship() throws Exception {
        UUID townshipId = createdTownshipId("HILLVIEW", "hillview-admin");

        mockMvc.perform(post("/api/v1/admin/property/nodes")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(superAdmin))
                        .header(TenantContextFilter.TOWNSHIP_HEADER, townshipId.toString())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("name", "Tower 1"))))
                .andExpect(status().isCreated());

        mockMvc.perform(get("/api/v1/admin/property/nodes")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(superAdmin))
                        .header(TenantContextFilter.TOWNSHIP_HEADER, townshipId.toString()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].name").value("Tower 1"));
    }

    // ----- onboarding: the developer's project shape ------------------------------------------

    @Test
    @DisplayName("the project-type catalogue is readable before any township exists")
    void projectTypeCatalogueNeedsNoTownship() throws Exception {
        // The whole point: this is the first screen of onboarding, when there is no township to
        // name in X-Township-Id. The tenant-scoped /admin/property/types cannot serve it.
        mockMvc.perform(get("/api/v1/super/property-types")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(superAdmin)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[?(@.value == 'VILLA')].label").value(
                        org.hamcrest.Matchers.hasItem("Villa community")))
                .andExpect(jsonPath("$[?(@.value == 'RETAIL')].categoryLabel").value(
                        org.hamcrest.Matchers.hasItem("Commercial")))
                // The level set each preset would seed comes with it, so the console can show the
                // resulting structure before the township is created -- and the level set is the
                // one thing that cannot be reshaped afterwards.
                .andExpect(jsonPath("$[?(@.value == 'RETAIL')].defaultLevels[2].singular").value(
                        org.hamcrest.Matchers.hasItem("Shop")));
    }

    @Test
    @DisplayName("onboarding with a project type seeds that developer's vocabulary")
    void onboardingSeedsTheChosenVocabulary() throws Exception {
        UUID townshipId = createdTownshipWithType("PALMGROVE", "palm-admin", "VILLA");

        mockMvc.perform(get("/api/v1/admin/property/profile")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(superAdmin))
                        .header(TenantContextFilter.TOWNSHIP_HEADER, townshipId.toString()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.propertyType").value("VILLA"))
                .andExpect(jsonPath("$.hasFloors").value(false))
                .andExpect(jsonPath("$.levels[0].singular").value("Cluster"))
                .andExpect(jsonPath("$.levels[1].singular").value("Villa"));
    }

    @Test
    @DisplayName("a mall is onboarded as levels of shops, not blocks of flats")
    void onboardingACommercialProject() throws Exception {
        UUID townshipId = createdTownshipWithType("CITYMALL", "mall-admin", "RETAIL");

        mockMvc.perform(get("/api/v1/admin/property/profile")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(superAdmin))
                        .header(TenantContextFilter.TOWNSHIP_HEADER, townshipId.toString()))
                .andExpect(jsonPath("$.hasFloors").value(true))
                .andExpect(jsonPath("$.levels[1].plural").value("Levels"))
                .andExpect(jsonPath("$.levels[2].plural").value("Shops"));
    }

    @Test
    @DisplayName("a super admin can describe a structure no preset covers")
    void onboardingWithACustomStructure() throws Exception {
        Map<String, Object> body = new java.util.HashMap<>();
        body.put("code", "BESPOKE");
        body.put("name", "Bespoke Estate");
        body.put("propertyType", "MIXED_USE");
        body.put("levels", List.of(
                Map.of("kind", "GROUP", "singular", "Precinct", "plural", "Precincts"),
                Map.of("kind", "BUILDING", "singular", "Pod", "plural", "Pods"),
                Map.of("kind", "UNIT", "singular", "Residence", "plural", "Residences")));
        body.put("admin", Map.of("loginId", "bespoke-admin", "fullName", "Bespoke Admin"));

        String response = mockMvc.perform(post("/api/v1/super/townships")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(superAdmin))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(body)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        UUID townshipId = UUID.fromString(
                objectMapper.readTree(response).get("township").get("id").asText());

        // The explicit levels win over the type's preset, while the type is still recorded.
        mockMvc.perform(get("/api/v1/admin/property/profile")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(superAdmin))
                        .header(TenantContextFilter.TOWNSHIP_HEADER, townshipId.toString()))
                .andExpect(jsonPath("$.propertyType").value("MIXED_USE"))
                .andExpect(jsonPath("$.levels.length()").value(3))
                .andExpect(jsonPath("$.levels[0].singular").value("Precinct"))
                .andExpect(jsonPath("$.levels[1].singular").value("Pod"))
                .andExpect(jsonPath("$.levels[2].singular").value("Residence"));
    }

    @Test
    @DisplayName("a custom structure is validated at onboarding, not after handover")
    void customStructureIsValidatedUpFront() throws Exception {
        Map<String, Object> body = new java.util.HashMap<>();
        body.put("code", "BADSHAPE");
        body.put("name", "Bad Shape");
        // A floor inside a phase is not a thing, and catching it now beats discovering it once
        // the tree is populated and the level set can no longer be reshaped.
        body.put("levels", List.of(
                Map.of("kind", "GROUP", "singular", "Phase", "plural", "Phases"),
                Map.of("kind", "FLOOR", "singular", "Floor", "plural", "Floors"),
                Map.of("kind", "UNIT", "singular", "Flat", "plural", "Flats")));
        body.put("admin", Map.of("loginId", "bad-admin", "fullName", "Bad Admin"));

        mockMvc.perform(post("/api/v1/super/townships")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(superAdmin))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(body)))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("FLOOR_NEEDS_BUILDING"));
    }

    @Test
    @DisplayName("omitting the project type still yields a usable township")
    void onboardingWithoutATypeFallsBackToApartment() throws Exception {
        UUID townshipId = createdTownshipId("PLAINVIEW", "plain-admin");

        mockMvc.perform(get("/api/v1/admin/property/profile")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(superAdmin))
                        .header(TenantContextFilter.TOWNSHIP_HEADER, townshipId.toString()))
                .andExpect(jsonPath("$.propertyType").value("APARTMENT"))
                .andExpect(jsonPath("$.levels[0].singular").value("Tower"));
    }

    /** Onboards a township of a named project type and returns its id. */
    private UUID createdTownshipWithType(String code, String adminLoginId, String propertyType)
            throws Exception {
        String response = mockMvc.perform(post("/api/v1/super/townships")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(superAdmin))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of(
                                "code", code,
                                "name", code + " Project",
                                "propertyType", propertyType,
                                "admin", Map.of("loginId", adminLoginId, "fullName", "An Admin")))))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return UUID.fromString(objectMapper.readTree(response).get("township").get("id").asText());
    }

    @Test
    @DisplayName("a township-scoped endpoint without the tenant header says so plainly")
    void superAdminMustNameATownshipForScopedWork() throws Exception {
        mockMvc.perform(get("/api/v1/admin/property/nodes")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(superAdmin)))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("TOWNSHIP_CONTEXT_REQUIRED"));
    }

    @Test
    @DisplayName("a tenant header naming no township is a 404, and a malformed one a 400")
    void tenantHeaderIsValidated() throws Exception {
        mockMvc.perform(get("/api/v1/admin/property/nodes")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(superAdmin))
                        .header(TenantContextFilter.TOWNSHIP_HEADER, UUID.randomUUID().toString()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("TOWNSHIP_NOT_FOUND"));

        mockMvc.perform(get("/api/v1/admin/property/nodes")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(superAdmin))
                        .header(TenantContextFilter.TOWNSHIP_HEADER, "not-a-uuid"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_TOWNSHIP_HEADER"));
    }

    @Test
    @DisplayName("a super admin is not a guard, a resident or a sales agent")
    void superAdminDoesNotInheritOperationalRoles() throws Exception {
        UUID townshipId = createdTownshipId("PARKSIDE", "parkside-admin");

        // ADMIN authority is inherited; GUARD is not. Standing in for the person physically at the
        // gate would make the visitor log a record of something that did not happen.
        mockMvc.perform(post("/api/v1/visits")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(superAdmin))
                        .header(TenantContextFilter.TOWNSHIP_HEADER, townshipId.toString())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("gateId", UUID.randomUUID().toString(),
                                "visitorType", "GUEST", "visitorName", "Nobody"))))
                .andExpect(status().isForbidden());

        mockMvc.perform(get("/api/v1/visits/pending")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(superAdmin))
                        .header(TenantContextFilter.TOWNSHIP_HEADER, townshipId.toString()))
                .andExpect(status().isForbidden());
    }

    // ----- lifecycle --------------------------------------------------------------------------

    @Test
    @DisplayName("archiving requires the township's own code as confirmation")
    void archiveRequiresConfirmation() throws Exception {
        UUID townshipId = createdTownshipId("OAKFIELD", "oakfield-admin");

        mockMvc.perform(delete("/api/v1/super/townships/" + townshipId)
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(superAdmin))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("confirmCode", "WRONG"))))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("CONFIRMATION_MISMATCH"));

        assertThat(townships.findById(townshipId).orElseThrow().getStatus())
                .isEqualTo(TownshipStatus.ACTIVE);
    }

    @Test
    @DisplayName("archiving locks the township out immediately and restoring brings it back intact")
    void archiveLocksOutAndRestoreReturns() throws Exception {
        String body = createTownship("MEADOWS", "meadows-admin")
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        UUID townshipId = UUID.fromString(
                objectMapper.readTree(body).get("township").get("id").asText());
        AppUser admin = data.user(townships.findById(townshipId).orElseThrow(),
                UserRole.GUARD, "meadows-guard", null);
        String liveToken = auth.bearer(admin);

        // The token verifies right now.
        mockMvc.perform(get("/api/v1/admin/gates").header(HttpHeaders.AUTHORIZATION, liveToken))
                .andExpect(status().isOk());

        mockMvc.perform(delete("/api/v1/super/townships/" + townshipId)
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(superAdmin))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("confirmCode", "meadows"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ARCHIVED"))
                .andExpect(jsonPath("$.archivedAt").isNotEmpty());

        // The same token, still inside its TTL, is refused on the very next request.
        mockMvc.perform(get("/api/v1/admin/gates").header(HttpHeaders.AUTHORIZATION, liveToken))
                .andExpect(status().isUnauthorized());

        // And a fresh sign-in is refused too -- with a clear reason, since the credentials verified.
        mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("townshipCode", "MEADOWS",
                                "loginId", admin.getLoginId(),
                                "password", TestDataFactory.PASSWORD))))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("TOWNSHIP_INACTIVE"));

        mockMvc.perform(post("/api/v1/super/townships/" + townshipId + "/restore")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(superAdmin)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ACTIVE"));

        // Nothing was destroyed: the account is still there and signs straight back in.
        mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("townshipCode", "MEADOWS",
                                "loginId", admin.getLoginId(),
                                "password", TestDataFactory.PASSWORD))))
                .andExpect(status().isOk());
    }

    @Test
    @DisplayName("an archived township is hidden from the listing but never deleted")
    void archivedTownshipIsRetainedNotDeleted() throws Exception {
        UUID townshipId = createdTownshipId("WESTGATE", "westgate-admin");
        archive(townshipId, "WESTGATE").andExpect(status().isOk());

        String hidden = mockMvc.perform(get("/api/v1/super/townships")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(superAdmin)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertThat(hidden).doesNotContain("WESTGATE");

        String shown = mockMvc.perform(get("/api/v1/super/townships?includeArchived=true")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(superAdmin)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertThat(shown).contains("WESTGATE");

        // The row -- and everything hanging off it -- is still in the database.
        assertThat(townships.findById(townshipId)).isPresent();
    }

    @Test
    @DisplayName("a super admin cannot act inside an archived township")
    void archivedTownshipIsReadOnlyHistory() throws Exception {
        UUID townshipId = createdTownshipId("EASTGATE", "eastgate-admin");
        archive(townshipId, "EASTGATE").andExpect(status().isOk());

        mockMvc.perform(post("/api/v1/admin/property/nodes")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(superAdmin))
                        .header(TenantContextFilter.TOWNSHIP_HEADER, townshipId.toString())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("name", "Tower 1"))))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("TOWNSHIP_ARCHIVED"));
    }

    @Test
    @DisplayName("suspension is reversible and does not archive")
    void suspensionIsDistinctFromArchival() throws Exception {
        UUID townshipId = createdTownshipId("NORTHFIELD", "northfield-admin");

        mockMvc.perform(post("/api/v1/super/townships/" + townshipId + "/suspend")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(superAdmin)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("SUSPENDED"))
                .andExpect(jsonPath("$.archivedAt").doesNotExist());

        // Unlike an archived one, a suspended township is still reachable by the operator who has to
        // go in and fix whatever caused the suspension.
        mockMvc.perform(get("/api/v1/admin/property/nodes")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(superAdmin))
                        .header(TenantContextFilter.TOWNSHIP_HEADER, townshipId.toString()))
                .andExpect(status().isOk());
    }

    // ----- administrators ---------------------------------------------------------------------

    @Test
    @DisplayName("the last administrator of a township cannot be removed")
    void lastTownshipAdminIsProtected() throws Exception {
        String body = createTownship("SOUTHBANK", "southbank-admin")
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        UUID townshipId = UUID.fromString(
                objectMapper.readTree(body).get("township").get("id").asText());
        UUID adminId = UUID.fromString(objectMapper.readTree(body).get("admin").get("id").asText());

        mockMvc.perform(delete("/api/v1/super/townships/" + townshipId + "/admins/" + adminId)
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(superAdmin)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("LAST_TOWNSHIP_ADMIN"));

        // Appoint a successor, and the original can then be stood down.
        mockMvc.perform(post("/api/v1/super/townships/" + townshipId + "/admins")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(superAdmin))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("loginId", "successor", "fullName", "New Admin"))))
                .andExpect(status().isCreated());

        mockMvc.perform(delete("/api/v1/super/townships/" + townshipId + "/admins/" + adminId)
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(superAdmin)))
                .andExpect(status().isOk())
                // Deactivated, not deleted: their name still has to resolve on past decisions.
                .andExpect(jsonPath("$.active").value(false));
    }

    @Test
    @DisplayName("the platform always keeps one active super admin, and never deactivates you")
    void platformCannotLockItselfOut() throws Exception {
        mockMvc.perform(delete("/api/v1/super/admins/" + superAdmin.getId())
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(superAdmin)))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("CANNOT_DEACTIVATE_SELF"));

        String created = mockMvc.perform(post("/api/v1/super/admins")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(superAdmin))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("loginId", "second-operator", "fullName", "Second"))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.generatedPassword").isNotEmpty())
                .andReturn().getResponse().getContentAsString();
        UUID peerId = UUID.fromString(objectMapper.readTree(created).get("id").asText());

        // A peer can be stood down while another remains.
        mockMvc.perform(delete("/api/v1/super/admins/" + peerId)
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(superAdmin)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.active").value(false));
    }

    @Test
    @DisplayName("a super admin signs in with no township code at all")
    void superAdminSignsInWithoutATownship() throws Exception {
        String created = mockMvc.perform(post("/api/v1/super/admins")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(superAdmin))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("loginId", "operator-two", "fullName", "Operator Two"))))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        String password = objectMapper.readTree(created).get("generatedPassword").asText();

        mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("loginId", "operator-two", "password", password))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.role").value("SUPER_ADMIN"))
                .andExpect(jsonPath("$.townshipId").doesNotExist());
    }

    // ----- the boundary the other direction ---------------------------------------------------

    @Test
    @DisplayName("no township role reaches the platform surface")
    void townshipRolesCannotReachThePlatform() throws Exception {
        Township township = data.primaryTownship();
        AppUser admin = data.admin(township);
        AppUser guard = data.guard(township);

        for (AppUser caller : java.util.List.of(admin, guard)) {
            mockMvc.perform(get("/api/v1/super/townships")
                            .header(HttpHeaders.AUTHORIZATION, auth.bearer(caller)))
                    .andExpect(status().isForbidden());

            mockMvc.perform(post("/api/v1/super/townships")
                            .header(HttpHeaders.AUTHORIZATION, auth.bearer(caller))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(json(Map.of("code", "SNEAKY", "name", "Sneaky",
                                    "admin", Map.of("loginId", "sneaky", "fullName", "Sneaky")))))
                    .andExpect(status().isForbidden());

            mockMvc.perform(get("/api/v1/super/admins")
                            .header(HttpHeaders.AUTHORIZATION, auth.bearer(caller)))
                    .andExpect(status().isForbidden());
        }
    }

    @Test
    @DisplayName("a SUPER_ADMIN cannot be provisioned through a township's own endpoint")
    void superAdminCannotBeMintedFromInsideATownship() throws Exception {
        UUID townshipId = createdTownshipId("BRIDGEND", "bridgend-admin");

        mockMvc.perform(post("/api/v1/admin/users")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(superAdmin))
                        .header(TenantContextFilter.TOWNSHIP_HEADER, townshipId.toString())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("role", "SUPER_ADMIN", "loginId", "escalated",
                                "fullName", "Escalated"))))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("ROLE_NOT_PROVISIONABLE"));
    }

    // ----- helpers ----------------------------------------------------------------------------

    private ResultActions createTownship(String code, String adminLoginId) throws Exception {
        return mockMvc.perform(post("/api/v1/super/townships")
                .header(HttpHeaders.AUTHORIZATION, auth.bearer(superAdmin))
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(Map.of(
                        "code", code,
                        "name", code + " Township",
                        "admin", Map.of("loginId", adminLoginId, "fullName", "Township Admin")))));
    }

    private UUID createdTownshipId(String code, String adminLoginId) throws Exception {
        String body = createTownship(code, adminLoginId)
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return UUID.fromString(objectMapper.readTree(body).get("township").get("id").asText());
    }

    private ResultActions archive(UUID townshipId, String confirmCode) throws Exception {
        return mockMvc.perform(delete("/api/v1/super/townships/" + townshipId)
                .header(HttpHeaders.AUTHORIZATION, auth.bearer(superAdmin))
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(Map.of("confirmCode", confirmCode))));
    }
}
