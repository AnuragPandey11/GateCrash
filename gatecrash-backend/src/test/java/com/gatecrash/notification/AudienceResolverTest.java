package com.gatecrash.notification;

import com.gatecrash.property.PropertyNode;
import com.gatecrash.notification.dto.NotificationDtos.AudienceRule;
import com.gatecrash.notification.dto.NotificationDtos.AudienceRule.Mode;
import com.gatecrash.support.AbstractIntegrationTest;
import com.gatecrash.support.TestAuth;
import com.gatecrash.support.TestDataFactory;
import com.gatecrash.user.AppUser;
import com.gatecrash.user.AppUserRepository;
import com.gatecrash.user.UserRole;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@DisplayName("Audience targeting: every mode resolves the exact expected set")
class AudienceResolverTest extends AbstractIntegrationTest {

    @Autowired
    private TestDataFactory data;

    @Autowired
    private TestAuth auth;

    @Autowired
    private AudienceResolver resolver;

    @Autowired
    private AppUserRepository users;

    private AppUser admin;
    private AppUser guard;
    private AppUser sales;
    private AppUser residentA1;
    private AppUser residentA2;
    private AppUser residentB1;
    private PropertyNode flatA1;
    private PropertyNode flatB1;
    private PropertyNode blockA;
    private PropertyNode blockB;

    @BeforeEach
    void seed() {
        data.reset();
        blockA = data.block("Block A");
        blockB = data.block("Block B");
        flatA1 = data.flat(blockA, "A-101");
        PropertyNode flatA2 = data.flat(blockA, "A-102");
        flatB1 = data.flat(blockB, "B-201");

        admin = data.admin();
        guard = data.guard();
        sales = data.salesAgent(true);
        residentA1 = data.resident(flatA1);
        residentA2 = data.resident(flatA2);
        residentB1 = data.resident(flatB1);
    }

    @Test
    @DisplayName("ALL resolves every active account")
    void modeAll() {
        assertThat(resolve(new AudienceRule(Mode.ALL, null, null, null, null, null)))
                .containsExactlyInAnyOrder(admin.getId(), guard.getId(), sales.getId(),
                        residentA1.getId(), residentA2.getId(), residentB1.getId());
    }

    @Test
    @DisplayName("ALL skips deactivated accounts")
    void modeAllSkipsInactive() {
        guard.setActive(false);
        users.save(guard);

        assertThat(resolve(new AudienceRule(Mode.ALL, null, null, null, null, null)))
                .doesNotContain(guard.getId())
                .hasSize(5);
    }

    @Test
    @DisplayName("ALL_EXCEPT removes the listed roles")
    void modeAllExcept() {
        assertThat(resolve(new AudienceRule(Mode.ALL_EXCEPT, List.of(UserRole.GUARD), null, null, null, null)))
                // The sales agent is a GUARD with the sales flag, so excluding guards excludes them too.
                .doesNotContain(guard.getId(), sales.getId())
                .containsExactlyInAnyOrder(admin.getId(), residentA1.getId(),
                        residentA2.getId(), residentB1.getId());
    }

    @Test
    @DisplayName("ROLES keeps only the listed roles")
    void modeRoles() {
        assertThat(resolve(new AudienceRule(Mode.ROLES, List.of(UserRole.ADMIN), null, null, null, null)))
                .containsExactly(admin.getId());
    }

    @Test
    @DisplayName("SALES_TEAM reaches accounts with the sales flag, whatever their role")
    void modeSalesTeam() {
        assertThat(resolve(new AudienceRule(Mode.SALES_TEAM, null, null, null, null, null)))
                .containsExactly(sales.getId());
    }

    @Test
    @DisplayName("NODES mixes levels: a whole block plus one unit of another")
    void modeNodes() {
        assertThat(resolve(new AudienceRule(Mode.NODES, null, null, null,
                List.of(blockA.getId(), flatB1.getId()), null)))
                .containsExactlyInAnyOrder(residentA1.getId(), residentA2.getId(), residentB1.getId());

        assertThat(resolve(new AudienceRule(Mode.NODES, null, null, null, List.of(flatA1.getId()), null)))
                .containsExactly(residentA1.getId());
    }

    @Test
    @DisplayName("FLATS resolves the residents of the given flats")
    void modeFlats() {
        assertThat(resolve(new AudienceRule(Mode.FLATS, null, List.of(flatA1.getId()), null, null, null)))
                .containsExactly(residentA1.getId());
    }

    @Test
    @DisplayName("BLOCKS resolves every resident in the given blocks")
    void modeBlocks() {
        assertThat(resolve(new AudienceRule(Mode.BLOCKS, null, null, List.of(blockA.getId()), null, null)))
                .containsExactlyInAnyOrder(residentA1.getId(), residentA2.getId())
                .doesNotContain(residentB1.getId());
    }

    @Test
    @DisplayName("an empty selector list is rejected, never treated as 'everyone'")
    void emptySelectorIsRejected() throws Exception {
        mockMvc.perform(post("/api/v1/notifications/preview")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(admin))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("mode", "ROLES", "roles", List.of()))))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("ROLES_REQUIRED"));
    }

    @Test
    @DisplayName("the preview count matches what a send actually materialises")
    void previewMatchesSend() throws Exception {
        Map<String, Object> rule = Map.of("mode", "ROLES", "roles", List.of("RESIDENT"));

        String preview = mockMvc.perform(post("/api/v1/notifications/preview")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(admin))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(rule)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        int previewCount = objectMapper.readTree(preview).get("recipientCount").asInt();

        mockMvc.perform(post("/api/v1/notifications")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(admin))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("title", "Water supply", "body", "Off 10am-2pm",
                                "audienceRule", rule))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.recipientCount").value(previewCount))
                .andExpect(jsonPath("$.status").value("SENT"));

        assertThat(previewCount).isEqualTo(3);
    }

    @Test
    @DisplayName("recipients see the broadcast in their inbox and can mark it read")
    void inboxDeliversAndTracksReads() throws Exception {
        mockMvc.perform(post("/api/v1/notifications")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(admin))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("title", "Lift maintenance", "body", "Tower 3 lift down",
                                "audienceRule", Map.of("mode", "FLATS",
                                        "flatIds", List.of(flatA1.getId().toString()))))))
                .andExpect(status().isCreated());

        String inbox = mockMvc.perform(get("/api/v1/notifications/mine")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(residentA1)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.content[0].title").value("Lift maintenance"))
                .andExpect(jsonPath("$.content[0].read").value(false))
                .andReturn().getResponse().getContentAsString();

        // A resident of a different flat was not targeted and sees nothing.
        mockMvc.perform(get("/api/v1/notifications/mine")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(residentB1)))
                .andExpect(jsonPath("$.content.length()").value(0));

        UUID itemId = UUID.fromString(
                objectMapper.readTree(inbox).get("content").get(0).get("id").asText());

        mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .patch("/api/v1/notifications/mine/" + itemId + "/read")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(residentA1)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.read").value(true));

        mockMvc.perform(get("/api/v1/notifications/mine/unread-count")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(residentA1)))
                .andExpect(jsonPath("$.unread").value(0));
    }

    @Test
    @DisplayName("one recipient cannot mark another's inbox row read")
    void cannotMarkAnotherUsersRowRead() throws Exception {
        mockMvc.perform(post("/api/v1/notifications")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(admin))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(Map.of("title", "Notice", "body", "Body",
                                "audienceRule", Map.of("mode", "FLATS",
                                        "flatIds", List.of(flatA1.getId().toString()))))))
                .andExpect(status().isCreated());

        String inbox = mockMvc.perform(get("/api/v1/notifications/mine")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(residentA1)))
                .andReturn().getResponse().getContentAsString();
        UUID itemId = UUID.fromString(
                objectMapper.readTree(inbox).get("content").get(0).get("id").asText());

        mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .patch("/api/v1/notifications/mine/" + itemId + "/read")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(residentB1)))
                .andExpect(status().isNotFound());
    }

    /**
     * The resolver reads its township from {@code TenantContext}, which a filter establishes on a
     * real request. These cases call it directly, so the context is supplied here -- the same way
     * {@code TownshipLifecycleService} supplies one when provisioning a new township's first admin.
     */
    private List<UUID> resolve(AudienceRule rule) {
        return com.gatecrash.common.tenant.TenantContext.callAs(
                data.primaryTownship().getId(), () -> resolver.resolve(rule));
    }
}
