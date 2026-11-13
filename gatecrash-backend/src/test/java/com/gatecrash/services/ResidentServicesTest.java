package com.gatecrash.services;

import com.fasterxml.jackson.databind.JsonNode;
import com.gatecrash.common.TownshipClock;
import com.gatecrash.property.PropertyNode;
import com.gatecrash.support.AbstractIntegrationTest;
import com.gatecrash.support.TestAuth;
import com.gatecrash.support.TestDataFactory;
import com.gatecrash.user.AppUser;
import com.gatecrash.user.AppUserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

import java.time.LocalDate;
import java.util.HashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Help desk, amenities, move-in/move-out and bills: the flows and their ownership checks. */
@DisplayName("Resident services")
class ResidentServicesTest extends AbstractIntegrationTest {

    @Autowired
    private TestDataFactory data;

    @Autowired
    private TestAuth auth;

    @Autowired
    private TownshipClock clock;

    @Autowired
    private AppUserRepository users;

    private PropertyNode flatA;
    private AppUser admin;
    private AppUser guard;
    private AppUser residentA;
    private AppUser residentB;

    @BeforeEach
    void seed() {
        data.reset();
        PropertyNode block = data.block("Block A");
        flatA = data.flat(block, "A-101");
        PropertyNode flatB = data.flat(block, "A-102");
        admin = data.admin();
        guard = data.guard();
        residentA = data.resident(flatA);
        residentB = data.resident(flatB);
    }

    // ----- help desk -----------------------------------------------------------------------------

    @Test
    @DisplayName("a ticket moves to in progress on the office's first reply, and only its owner can read it")
    void ticketThread() throws Exception {
        JsonNode ticket = body(as(residentA, post("/api/v1/support-tickets"), Map.of(
                "category", "PLUMBING", "subject", "Leaking tap", "description", "Kitchen tap drips."))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("OPEN")));
        String id = ticket.get("id").asText();

        as(admin, post("/api/v1/support-tickets/" + id + "/messages"), Map.of("body", "Plumber at 4 pm."))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("IN_PROGRESS"))
                .andExpect(jsonPath("$.messages.length()").value(1))
                .andExpect(jsonPath("$.messages[0].fromStaff").value(true));

        mockMvc.perform(get("/api/v1/support-tickets/" + id)
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(residentB)))
                .andExpect(status().isForbidden());

        as(admin, patch("/api/v1/admin/support-tickets/" + id + "/status"), Map.of("status", "RESOLVED"))
                .andExpect(jsonPath("$.status").value("RESOLVED"));
        mockMvc.perform(post("/api/v1/support-tickets/" + id + "/reopen")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(residentA)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("OPEN"));
    }

    // ----- amenities -----------------------------------------------------------------------------

    @Test
    @DisplayName("a slot with room confirms instantly; a full one is refused")
    void amenityBooking() throws Exception {
        JsonNode amenity = body(as(admin, post("/api/v1/admin/amenities"), Map.of(
                "name", "Badminton Court", "capacity", 1, "openTime", "06:00", "closeTime", "22:00",
                "slotMinutes", 60, "maxSlotsPerBooking", 2))
                .andExpect(status().isCreated()));
        String date = clock.today().plusDays(1).toString();
        Map<String, Object> booking = Map.of("amenityId", amenity.get("id").asText(), "date", date,
                "startTime", "18:00", "slots", 1);

        as(residentA, post("/api/v1/amenity-bookings"), booking)
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("CONFIRMED"));
        as(residentB, post("/api/v1/amenity-bookings"), booking)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("SLOT_FULL"));

        mockMvc.perform(get("/api/v1/amenities/" + amenity.get("id").asText() + "/availability")
                        .param("date", date)
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(residentA)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.slots[12].startTime").value("18:00:00"))
                .andExpect(jsonPath("$.slots[12].available").value(false))
                .andExpect(jsonPath("$.slots[12].mine").value(true));
    }

    @Test
    @DisplayName("a slot that is not on the amenity's grid is refused")
    void misalignedSlot() throws Exception {
        JsonNode amenity = body(as(admin, post("/api/v1/admin/amenities"), Map.of(
                "name", "Clubhouse", "capacity", 1, "openTime", "09:00", "closeTime", "22:00",
                "slotMinutes", 60, "maxSlotsPerBooking", 3)));
        as(residentA, post("/api/v1/amenity-bookings"), Map.of(
                "amenityId", amenity.get("id").asText(), "date", clock.today().plusDays(1).toString(),
                "startTime", "09:30", "slots", 1))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("INVALID_SLOT"));
    }

    // ----- move-in / move-out --------------------------------------------------------------------

    @Test
    @DisplayName("a move-out is approved with dues in view, shows at the gate on the day, and deactivates on completion")
    void moveOutFlow() throws Exception {
        as(admin, post("/api/v1/admin/invoices"), Map.of(
                "unitId", flatA.getId().toString(), "category", "MAINTENANCE", "title", "Maintenance",
                "amountPaise", 250000, "paid", false))
                .andExpect(status().isCreated());

        LocalDate today = clock.today();
        JsonNode move = body(as(residentA, post("/api/v1/move-requests"), Map.of(
                "moveType", "MOVE_OUT", "moveDate", today.toString(), "timeFrom", "10:00", "timeTo", "14:00",
                "vehicleDetails", "Tata 407, MH12XY9999"))
                .andExpect(status().isCreated()));
        String id = move.get("id").asText();

        mockMvc.perform(get("/api/v1/admin/move-requests").param("status", "PENDING")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(admin)))
                .andExpect(jsonPath("$.content[0].unpaidCount").value(1))
                .andExpect(jsonPath("$.content[0].unpaidAmountPaise").value(250000));

        as(admin, post("/api/v1/admin/move-requests/" + id + "/decision"), Map.of("decision", "APPROVED"))
                .andExpect(jsonPath("$.status").value("APPROVED"));

        mockMvc.perform(get("/api/v1/move-requests/today")
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(guard)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].unitCode").value("A-101"));

        as(admin, post("/api/v1/admin/move-requests/" + id + "/complete"), Map.of("deactivateResidents", true))
                .andExpect(jsonPath("$.status").value("COMPLETED"));
        assertThat(users.findById(residentA.getId()).orElseThrow().isActive()).isFalse();
        assertThat(users.findById(residentB.getId()).orElseThrow().isActive()).isTrue();
    }

    @Test
    @DisplayName("a rejection must say why")
    void rejectionNeedsReason() throws Exception {
        JsonNode move = body(as(residentA, post("/api/v1/move-requests"), Map.of(
                "moveType", "MOVE_IN", "moveDate", clock.today().plusDays(3).toString(),
                "timeFrom", "09:00", "timeTo", "12:00")));
        as(admin, post("/api/v1/admin/move-requests/" + move.get("id").asText() + "/decision"),
                Map.of("decision", "REJECTED"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("REASON_REQUIRED"));
    }

    // ----- bills ---------------------------------------------------------------------------------

    @Test
    @DisplayName("a resident sees their own unit's paid bills, with a receipt number, and nobody else's")
    void paidBills() throws Exception {
        Map<String, Object> bill = new HashMap<>();
        bill.put("unitId", flatA.getId().toString());
        bill.put("category", "ELECTRICITY");
        bill.put("title", "Electricity");
        bill.put("periodLabel", "Oct 2026");
        bill.put("amountPaise", 123450);
        bill.put("paid", true);
        bill.put("paymentMethod", "UPI");
        as(admin, post("/api/v1/admin/invoices"), bill)
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.receiptNo").isNotEmpty());

        mockMvc.perform(get("/api/v1/invoices/mine").header(HttpHeaders.AUTHORIZATION, auth.bearer(residentA)))
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.content[0].amountPaise").value(123450));
        mockMvc.perform(get("/api/v1/invoices/mine").header(HttpHeaders.AUTHORIZATION, auth.bearer(residentB)))
                .andExpect(jsonPath("$.content.length()").value(0));
    }

    @Test
    @DisplayName("a resident cannot record a bill")
    void residentCannotRecordBills() throws Exception {
        as(residentA, post("/api/v1/admin/invoices"), Map.of(
                "unitId", flatA.getId().toString(), "category", "OTHER", "title", "x",
                "amountPaise", 100, "paid", true))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("deactivating a resident returns the account, not a 500 from a detached unit")
    void deactivatingAResidentWorks() throws Exception {
        mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .delete("/api/v1/admin/users/" + residentA.getId())
                        .header(HttpHeaders.AUTHORIZATION, auth.bearer(admin)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.active").value(false))
                .andExpect(jsonPath("$.flatNumber").value("A-101"));
    }

    // ----- helpers -------------------------------------------------------------------------------

    private ResultActions as(AppUser actor,
                             org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder request,
                             Object body) throws Exception {
        return mockMvc.perform(request
                .header(HttpHeaders.AUTHORIZATION, auth.bearer(actor))
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(body)));
    }

    private JsonNode body(ResultActions result) throws Exception {
        return objectMapper.readTree(result.andReturn().getResponse().getContentAsString());
    }
}
