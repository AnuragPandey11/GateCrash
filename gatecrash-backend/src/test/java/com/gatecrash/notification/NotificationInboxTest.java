package com.gatecrash.notification;

import com.fasterxml.jackson.databind.JsonNode;
import com.gatecrash.property.PropertyNode;
import com.gatecrash.support.AbstractIntegrationTest;
import com.gatecrash.support.TestAuth;
import com.gatecrash.support.TestDataFactory;
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

import java.util.List;
import java.util.Map;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** The people-list audience, the inbox order, mark-all-read, and who may read the community feed. */
@DisplayName("Notification inbox and people list")
class NotificationInboxTest extends AbstractIntegrationTest {

    @Autowired
    private TestDataFactory data;

    @Autowired
    private TestAuth auth;

    private AppUser admin;
    private AppUser guard;
    private AppUser residentA;
    private AppUser residentB;

    @BeforeEach
    void seed() {
        data.reset();
        PropertyNode block = data.block("Block A");
        admin = data.admin();
        guard = data.guard();
        residentA = data.resident(data.flat(block, "A-101"));
        residentB = data.resident(data.flat(block, "A-102"));
    }

    @Test
    @DisplayName("the admin sees every account to pick from; nobody else can list them")
    void peopleList() throws Exception {
        as(admin, get("/api/v1/notifications/audience-users"), null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(4))
                .andExpect(jsonPath("$[?(@.role == 'RESIDENT')].unitCode").isNotEmpty());
        as(residentA, get("/api/v1/notifications/audience-users"), null).andExpect(status().isForbidden());
        as(guard, get("/api/v1/notifications/audience-users"), null).andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("a USERS notification reaches exactly the ticked accounts of this township")
    void usersMode() throws Exception {
        Township other = data.township("OTHER");
        AppUser outsider = data.guard(other);
        send("Water tank cleaning", List.of(residentA.getId().toString(), guard.getId().toString(),
                outsider.getId().toString()))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.recipientCount").value(2));

        as(residentA, get("/api/v1/notifications/mine"), null).andExpect(jsonPath("$.content.length()").value(1));
        as(guard, get("/api/v1/notifications/mine"), null).andExpect(jsonPath("$.content.length()").value(1));
        as(residentB, get("/api/v1/notifications/mine"), null).andExpect(jsonPath("$.content.length()").value(0));
    }

    @Test
    @DisplayName("the inbox is newest first, and mark-all-read clears the badge")
    void inboxOrderAndReadAll() throws Exception {
        List<String> only = List.of(residentA.getId().toString());
        send("First", only);
        send("Second", only);
        send("Third", only);

        as(residentA, get("/api/v1/notifications/mine"), null)
                .andExpect(jsonPath("$.content[0].title").value("Third"))
                .andExpect(jsonPath("$.content[2].title").value("First"));
        as(residentA, get("/api/v1/notifications/mine/unread-count"), null).andExpect(jsonPath("$.unread").value(3));
        as(residentA, post("/api/v1/notifications/mine/read-all"), null).andExpect(status().isOk());
        as(residentA, get("/api/v1/notifications/mine/unread-count"), null).andExpect(jsonPath("$.unread").value(0));
    }

    @Test
    @DisplayName("guards can read the community feed")
    void guardsReadCommunity() throws Exception {
        as(guard, get("/api/v1/community/posts"), null).andExpect(status().isOk());
    }

    private ResultActions send(String title, List<String> userIds) throws Exception {
        return as(admin, post("/api/v1/notifications"), Map.of(
                "title", title, "body", "Details inside.",
                "audienceRule", Map.of("mode", "USERS", "userIds", userIds)));
    }

    private ResultActions as(AppUser actor, MockHttpServletRequestBuilder request, Object body) throws Exception {
        MockHttpServletRequestBuilder withAuth = request.header(HttpHeaders.AUTHORIZATION, auth.bearer(actor));
        if (body != null) {
            withAuth = withAuth.contentType(MediaType.APPLICATION_JSON).content(json(body));
        }
        return mockMvc.perform(withAuth);
    }

    @SuppressWarnings("unused")
    private JsonNode body(ResultActions result) throws Exception {
        return objectMapper.readTree(result.andReturn().getResponse().getContentAsString());
    }
}
