package com.gatecrash.pass;

import com.gatecrash.support.AbstractIntegrationTest;
import com.gatecrash.support.TestAuth;
import com.gatecrash.support.TestDataFactory;
import com.gatecrash.township.Flat;
import com.gatecrash.township.Gate;
import com.gatecrash.user.AppUser;
import com.gatecrash.visit.VisitStatus;
import com.gatecrash.visit.VisitorLogRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

import java.time.OffsetDateTime;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@DisplayName("Passes: minting, PIN/QR redemption, reuse and revocation")
class PassRedemptionTest extends AbstractIntegrationTest {

    @Autowired
    private TestDataFactory data;

    @Autowired
    private TestAuth auth;

    @Autowired
    private PreApprovalRepository passes;

    @Autowired
    private VisitorLogRepository visits;

    private Gate gate;
    private Flat flat;
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

    @Test
    @DisplayName("a minted pass returns its PIN once and stores only hashes")
    void mintReturnsPinOnceAndStoresHashes() throws Exception {
        Minted minted = mintPass(1, OffsetDateTime.now().plusHours(4));

        assertThat(minted.pin()).hasSize(6).containsOnlyDigits();

        PreApproval stored = passes.findById(minted.id()).orElseThrow();
        assertThat(stored.getPinHash()).isNotEqualTo(minted.pin()).startsWith("$2");
        assertThat(stored.getPinLookup()).isNotNull().isNotEqualTo(minted.pin());
        // The plaintext must not be recoverable from anything persisted.
        assertThat(stored.getPinHash()).doesNotContain(minted.pin());
    }

    @Test
    @DisplayName("redeeming by PIN creates a CHECKED_IN visit with no approval round trip")
    void redeemByPinChecksInImmediately() throws Exception {
        Minted minted = mintPass(1, OffsetDateTime.now().plusHours(4));

        String body = redeem(Map.of("pin", minted.pin(), "gateId", gate.getId().toString()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.visit.status").value("CHECKED_IN"))
                .andExpect(jsonPath("$.remainingUses").value(0))
                .andReturn().getResponse().getContentAsString();

        UUID visitId = UUID.fromString(objectMapper.readTree(body).get("visit").get("id").asText());
        assertThat(visits.findById(visitId)).get()
                .satisfies(visit -> {
                    assertThat(visit.getStatus()).isEqualTo(VisitStatus.CHECKED_IN);
                    assertThat(visit.getCheckedInAt()).isNotNull();
                    assertThat(visit.getPreApproval()).isNotNull();
                });
        assertThat(passes.findById(minted.id()).orElseThrow().getStatus()).isEqualTo(PassStatus.REDEEMED);
    }

    @Test
    @DisplayName("redeeming by QR token works the same way")
    void redeemByQrToken() throws Exception {
        Minted minted = mintPass(1, OffsetDateTime.now().plusHours(4));

        redeem(Map.of("qrToken", minted.qrToken().toString(), "gateId", gate.getId().toString()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.visit.status").value("CHECKED_IN"));
    }

    @Test
    @DisplayName("a single-use pass cannot be redeemed twice")
    void singleUsePassCannotBeReused() throws Exception {
        Minted minted = mintPass(1, OffsetDateTime.now().plusHours(4));
        redeem(Map.of("pin", minted.pin(), "gateId", gate.getId().toString()))
                .andExpect(status().isOk());

        // The pass is REDEEMED, so the PIN no longer resolves to an ACTIVE row at all.
        redeem(Map.of("pin", minted.pin(), "gateId", gate.getId().toString()))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("a multi-use pass decrements its remaining uses")
    void multiUsePassCountsDown() throws Exception {
        Minted minted = mintPass(3, OffsetDateTime.now().plusHours(4));

        redeem(Map.of("pin", minted.pin(), "gateId", gate.getId().toString()))
                .andExpect(jsonPath("$.remainingUses").value(2));
        redeem(Map.of("pin", minted.pin(), "gateId", gate.getId().toString()))
                .andExpect(jsonPath("$.remainingUses").value(1));
        redeem(Map.of("pin", minted.pin(), "gateId", gate.getId().toString()))
                .andExpect(jsonPath("$.remainingUses").value(0));

        assertThat(passes.findById(minted.id()).orElseThrow().getUseCount()).isEqualTo(3);
    }

    @Test
    @DisplayName("an expired pass is refused")
    void expiredPassIsRefused() throws Exception {
        Minted minted = mintPass(1, OffsetDateTime.now().plusHours(4));

        // Wind the window back rather than waiting for it.
        PreApproval stored = passes.findById(minted.id()).orElseThrow();
        stored.setValidFrom(OffsetDateTime.now().minusHours(3));
        stored.setValidUntil(OffsetDateTime.now().minusHours(1));
        passes.save(stored);

        redeem(Map.of("pin", minted.pin(), "gateId", gate.getId().toString()))
                .andExpect(status().isGone())
                .andExpect(jsonPath("$.code").value("PASS_EXPIRED"));
    }

    @Test
    @DisplayName("a wrong PIN is refused and looks identical to an unknown one")
    void wrongPinIsRefused() throws Exception {
        mintPass(1, OffsetDateTime.now().plusHours(4));

        redeem(Map.of("pin", "000000", "gateId", gate.getId().toString()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.message").value("This pass is not valid for entry."));
    }

    @Test
    @DisplayName("supplying both a PIN and a QR token is rejected")
    void ambiguousRedemptionIsRejected() throws Exception {
        Minted minted = mintPass(1, OffsetDateTime.now().plusHours(4));

        redeem(Map.of("pin", minted.pin(), "qrToken", minted.qrToken().toString(),
                "gateId", gate.getId().toString()))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("AMBIGUOUS_REDEMPTION"));
    }

    @Test
    @DisplayName("PIN guessing is rate limited")
    void pinGuessingIsThrottled() throws Exception {
        mintPass(1, OffsetDateTime.now().plusHours(4));

        for (int attempt = 0; attempt < 10; attempt++) {
            redeem(Map.of("pin", String.format("%06d", attempt), "gateId", gate.getId().toString()))
                    .andExpect(status().isNotFound());
        }
        redeem(Map.of("pin", "999999", "gateId", gate.getId().toString()))
                .andExpect(status().isTooManyRequests());
    }

    @Test
    @DisplayName("a revoked pass cannot be redeemed")
    void revokedPassIsRefused() throws Exception {
        Minted minted = mintPass(1, OffsetDateTime.now().plusHours(4));

        mockMvc.perform(delete("/api/v1/passes/" + minted.id())
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(resident)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("REVOKED"));

        redeem(Map.of("pin", minted.pin(), "gateId", gate.getId().toString()))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("a resident cannot revoke someone else's pass")
    void cannotRevokeAnotherUsersPass() throws Exception {
        Minted minted = mintPass(1, OffsetDateTime.now().plusHours(4));
        AppUser otherResident = data.resident(data.flat(data.block("Block B"), "B-201"));

        mockMvc.perform(delete("/api/v1/passes/" + minted.id())
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(otherResident)))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("a validity window beyond policy is refused")
    void oversizedWindowIsRefused() throws Exception {
        Map<String, Object> request = new HashMap<>();
        request.put("visitorType", "GUEST");
        request.put("visitorName", "Long Stay");
        request.put("maxUses", 1);
        request.put("validUntil", OffsetDateTime.now().plusDays(400).toString());

        mockMvc.perform(post("/api/v1/passes")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(resident))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(request)))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("WINDOW_TOO_LONG"));
    }

    // ----- helpers ----------------------------------------------------------------------------

    private Minted mintPass(int maxUses, OffsetDateTime validUntil) throws Exception {
        Map<String, Object> request = new HashMap<>();
        request.put("visitorType", "GUEST");
        request.put("visitorName", "Expected Guest");
        request.put("maxUses", maxUses);
        request.put("validUntil", validUntil.toString());

        String body = mockMvc.perform(post("/api/v1/passes")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(resident))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(request)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();

        return new Minted(
                UUID.fromString(objectMapper.readTree(body).get("id").asText()),
                objectMapper.readTree(body).get("pin").asText(),
                UUID.fromString(objectMapper.readTree(body).get("qrToken").asText()));
    }

    private org.springframework.test.web.servlet.ResultActions redeem(Map<String, Object> request)
            throws Exception {
        return mockMvc.perform(post("/api/v1/passes/redeem")
                .header(HttpHeaders.AUTHORIZATION, auth.bearer(guard))
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(request)));
    }

    private record Minted(UUID id, String pin, UUID qrToken) {
    }
}
