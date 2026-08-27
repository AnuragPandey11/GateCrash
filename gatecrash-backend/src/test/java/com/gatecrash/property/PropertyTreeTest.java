package com.gatecrash.property;

import com.gatecrash.support.AbstractIntegrationTest;
import com.gatecrash.support.TestAuth;
import com.gatecrash.support.TestDataFactory;
import com.gatecrash.user.AppUser;
import com.gatecrash.user.UserRole;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The property tree: that it can express more than one shape of real-estate project, that the
 * developer's vocabulary is display-only, and that occupancy means what a developer thinks it means.
 *
 * <p>The shape cases are the point of the whole feature. A villa community and a high-rise are built
 * here side by side in the same database, and neither has to pretend to be the other -- which is
 * exactly what the retired {@code building_block} -> {@code flat} pair forced.
 */
@DisplayName("Property tree: per-developer structure, nomenclature and occupancy")
class PropertyTreeTest extends AbstractIntegrationTest {

    @Autowired
    private TestDataFactory data;

    @Autowired
    private TestAuth auth;

    private AppUser admin;
    private AppUser guard;

    @BeforeEach
    void setUp() {
        data.reset();
        data.primaryTownship();
        admin = data.user(UserRole.ADMIN, "admin", null);
        guard = data.user(UserRole.GUARD, "guard", null);
    }

    // ----- shapes ----------------------------------------------------------------------------

    @Nested
    @DisplayName("A township is whatever shape its developer actually built")
    class Shapes {

        @Test
        @DisplayName("a villa community has clusters and villas, and no floors at all")
        void villaCommunity() throws Exception {
            defineLevels(List.of(
                    level("GROUP", "Cluster", "Clusters"),
                    level("UNIT", "Villa", "Villas")));

            String cluster = createNode(null, "Rose Cluster", null, null);
            createNode(cluster, "Villa 12", "V-12", null);

            asAdmin(get("/api/v1/admin/property/profile"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.hasFloors").value(false))
                    .andExpect(jsonPath("$.levels[0].singular").value("Cluster"))
                    .andExpect(jsonPath("$.levels[1].singular").value("Villa"));

            asAdmin(get("/api/v1/admin/property/nodes?depth=1"))
                    .andExpect(jsonPath("$[0].code").value("V-12"))
                    .andExpect(jsonPath("$[0].kind").value("UNIT"))
                    .andExpect(jsonPath("$[0].levelNumber").doesNotExist());
        }

        @Test
        @DisplayName("a high-rise has towers of floors of flats, basements included")
        void highRise() throws Exception {
            defineLevels(List.of(
                    level("BUILDING", "Tower", "Towers"),
                    level("FLOOR", "Floor", "Floors"),
                    level("UNIT", "Apartment", "Apartments")));

            String tower = createNode(null, "Tower A", null, null);
            createNode(tower, "Basement 1", null, -1);
            String fourteen = createNode(tower, "14", null, 14);
            createNode(fourteen, "A-1401", "A-1401", null);

            asAdmin(get("/api/v1/admin/property/profile"))
                    .andExpect(jsonPath("$.hasFloors").value(true));

            // Floors come back ordered by storey, so "Basement 1" precedes "14" rather than
            // sorting alphabetically as its name would.
            asAdmin(get("/api/v1/admin/property/nodes?parentId=" + tower))
                    .andExpect(jsonPath("$[0].levelNumber").value(-1))
                    .andExpect(jsonPath("$[1].levelNumber").value(14));

            asAdmin(get("/api/v1/admin/property/nodes?parentId=" + fourteen))
                    .andExpect(jsonPath("$[0].code").value("A-1401"))
                    .andExpect(jsonPath("$[0].depth").value(2));
        }

        @Test
        @DisplayName("a level set with no addressable unit level is refused")
        void unitLevelIsMandatory() throws Exception {
            asAdmin(put("/api/v1/admin/property/levels")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(json(Map.of("levels", List.of(
                            level("BUILDING", "Tower", "Towers"),
                            level("FLOOR", "Floor", "Floors"))))))
                    .andExpect(status().isUnprocessableEntity())
                    .andExpect(jsonPath("$.code").value("UNIT_LEVEL_REQUIRED"));
        }

        @Test
        @DisplayName("the unit level must be the deepest -- nothing lives inside a home")
        void unitLevelMustBeLast() throws Exception {
            asAdmin(put("/api/v1/admin/property/levels")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(json(Map.of("levels", List.of(
                            level("UNIT", "Flat", "Flats"),
                            level("BUILDING", "Tower", "Towers"))))))
                    .andExpect(status().isUnprocessableEntity())
                    .andExpect(jsonPath("$.code").value("UNIT_LEVEL_MUST_BE_LAST"));
        }

        @Test
        @DisplayName("a floor must sit inside a building, not inside a phase")
        void floorNeedsABuilding() throws Exception {
            asAdmin(put("/api/v1/admin/property/levels")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(json(Map.of("levels", List.of(
                            level("GROUP", "Phase", "Phases"),
                            level("FLOOR", "Floor", "Floors"),
                            level("UNIT", "Flat", "Flats"))))))
                    .andExpect(status().isUnprocessableEntity())
                    .andExpect(jsonPath("$.code").value("FLOOR_NEEDS_BUILDING"));
        }

        @Test
        @DisplayName("reshaping a populated township is refused; renaming a level is not")
        void reshapingIsRefusedOncePopulated() throws Exception {
            String block = createNode(null, "Block A", null, null);
            createNode(block, "A-101", "A-101", null);

            asAdmin(put("/api/v1/admin/property/levels")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(json(Map.of("levels", List.of(
                            level("GROUP", "Cluster", "Clusters"),
                            level("UNIT", "Villa", "Villas"))))))
                    .andExpect(status().isConflict())
                    .andExpect(jsonPath("$.code").value("PROPERTY_TREE_NOT_EMPTY"));

            // Renaming stays available, because it changes nothing structural -- and it is
            // precisely when the tree is populated that a developer notices the wording is wrong.
            String levelId = readLevelId(0);
            asAdmin(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                    .patch("/api/v1/admin/property/levels/" + levelId)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(json(Map.of("singular", "Tower", "plural", "Towers"))))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.levels[0].singular").value("Tower"));

            // Renaming the level did not move any row: the block is still there, still a BUILDING.
            asAdmin(get("/api/v1/admin/property/nodes?depth=0"))
                    .andExpect(jsonPath("$[0].name").value("Block A"))
                    .andExpect(jsonPath("$[0].kind").value("BUILDING"));
        }
    }

    // ----- structural rules -------------------------------------------------------------------

    @Nested
    @DisplayName("Structural rules")
    class Structure {

        @Test
        @DisplayName("a unit reports the building it sits in, walking past the floor")
        void unitsReportTheirContainer() throws Exception {
            defineLevels(List.of(
                    level("BUILDING", "Tower", "Towers"),
                    level("FLOOR", "Floor", "Floors"),
                    level("UNIT", "Flat", "Flats")));
            String tower = createNode(null, "Tower A", null, null);
            String floor = createNode(tower, "14", null, 14);
            createNode(floor, "A-1401", "A-1401", null);

            // "14" is the parent, but it is not a useful answer to "which building?" -- the three
            // screens that group units by building want "Tower A".
            asAdmin(get("/api/v1/admin/property/nodes?depth=2"))
                    .andExpect(jsonPath("$[0].containerName").value("Tower A"));
        }

        @Test
        @DisplayName("nothing can be filed inside a unit")
        void unitIsALeaf() throws Exception {
            String block = createNode(null, "Block A", null, null);
            String flat = createNode(block, "A-101", "A-101", null);

            asAdmin(post("/api/v1/admin/property/nodes")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(json(nodeBody(flat, "A-101-A", "A-101-A", null))))
                    .andExpect(status().isConflict())
                    .andExpect(jsonPath("$.code").value("UNIT_IS_A_LEAF"));
        }

        @Test
        @DisplayName("unit codes are unique township-wide, because login ids derive from them")
        void unitCodesAreUniqueTownshipWide() throws Exception {
            String blockA = createNode(null, "Block A", null, null);
            String blockB = createNode(null, "Block B", null, null);
            createNode(blockA, "101", "101", null);

            // Legal under the old per-block rule, and the reason two residents could both be
            // handed the login id "101-1".
            asAdmin(post("/api/v1/admin/property/nodes")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(json(nodeBody(blockB, "101", "101", null))))
                    .andExpect(status().isConflict())
                    .andExpect(jsonPath("$.code").value("UNIT_CODE_EXISTS"));
        }

        @Test
        @DisplayName("a node with anything inside it cannot be deleted")
        void deletionRequiresEmptiness() throws Exception {
            String block = createNode(null, "Block A", null, null);
            createNode(block, "A-101", "A-101", null);

            asAdmin(delete("/api/v1/admin/property/nodes/" + block))
                    .andExpect(status().isConflict())
                    .andExpect(jsonPath("$.code").value("NODE_NOT_EMPTY"));
        }
    }

    // ----- bulk creation ----------------------------------------------------------------------

    @Nested
    @DisplayName("Bulk creation")
    class Bulk {

        @Test
        @DisplayName("generates a tower's floors and units in one call")
        void generatesFloorsAndUnits() throws Exception {
            defineLevels(List.of(
                    level("BUILDING", "Tower", "Towers"),
                    level("FLOOR", "Floor", "Floors"),
                    level("UNIT", "Flat", "Flats")));
            String tower = createNode(null, "Tower A", null, null);

            asAdmin(post("/api/v1/admin/property/nodes/bulk")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(json(bulkBody(tower, 1, 3, 2, "A-{floor}{unit}", 2))))
                    .andExpect(status().isCreated())
                    .andExpect(jsonPath("$.floorsCreated").value(3))
                    .andExpect(jsonPath("$.unitsCreated").value(6))
                    .andExpect(jsonPath("$.codes[0]").value("A-101"))
                    .andExpect(jsonPath("$.codes[5]").value("A-302"));
        }

        @Test
        @DisplayName("{building} expands to the parent's name, and {floor} to nothing without floors")
        void codePatternPlaceholders() throws Exception {
            defineLevels(List.of(
                    level("GROUP", "Cluster", "Clusters"),
                    level("UNIT", "Villa", "Villas")));
            String cluster = createNode(null, "Rose", null, null);

            // The console advertises all three placeholders in its hint, so all three are pinned
            // here -- including {floor} collapsing to nothing in a project that has no storeys.
            asAdmin(post("/api/v1/admin/property/nodes/bulk")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(json(bulkBody(cluster, null, null, 2, "{building}-{floor}{unit}", 2))))
                    .andExpect(status().isCreated())
                    .andExpect(jsonPath("$.codes[0]").value("Rose-01"))
                    .andExpect(jsonPath("$.codes[1]").value("Rose-02"));
        }

        @Test
        @DisplayName("a project with no floor level cannot be given a floor range")
        void refusesFloorRangeWithoutAFloorLevel() throws Exception {
            defineLevels(List.of(
                    level("GROUP", "Cluster", "Clusters"),
                    level("UNIT", "Villa", "Villas")));
            String cluster = createNode(null, "Rose Cluster", null, null);

            asAdmin(post("/api/v1/admin/property/nodes/bulk")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(json(bulkBody(cluster, 1, 3, 2, "V-{unit}", 2))))
                    .andExpect(status().isUnprocessableEntity())
                    .andExpect(jsonPath("$.code").value("NO_FLOOR_LEVEL"));

            // Without the range it generates the villas directly under the cluster.
            asAdmin(post("/api/v1/admin/property/nodes/bulk")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(json(bulkBody(cluster, null, null, 4, "V-{unit}", 2))))
                    .andExpect(status().isCreated())
                    .andExpect(jsonPath("$.floorsCreated").value(0))
                    .andExpect(jsonPath("$.unitsCreated").value(4))
                    .andExpect(jsonPath("$.codes[3]").value("V-04"));
        }
    }

    // ----- occupancy --------------------------------------------------------------------------

    @Nested
    @DisplayName("Occupancy means what a developer thinks it means")
    class Occupancy {

        @Test
        @DisplayName("a four-person household with one login counts as four residents")
        void headcountCountsPeopleNotAccounts() throws Exception {
            String block = createNode(null, "Block A", null, null);
            String flat = createNode(block, "A-101", "A-101", null);
            createNode(block, "A-102", "A-102", null);

            asAdmin(put("/api/v1/admin/property/nodes/" + flat + "/occupancy")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(json(Map.of("declaredOccupancy", 4))))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.declaredOccupancy").value(4));

            asAdmin(get("/api/v1/admin/property/occupancy"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.totalUnits").value(2))
                    // Only A-101 has anyone in it; A-102 is built but empty.
                    .andExpect(jsonPath("$.occupiedUnits").value(1))
                    .andExpect(jsonPath("$.vacantUnits").value(1))
                    .andExpect(jsonPath("$.occupancyRate").value(0.5))
                    .andExpect(jsonPath("$.residentHeadcount").value(4))
                    // ...and none of those four can sign in yet. The gap is the point.
                    .andExpect(jsonPath("$.registeredResidentAccounts").value(0));
        }

        @Test
        @DisplayName("provisioning a resident raises the declared occupancy to match")
        void provisioningKeepsOccupancyConsistent() throws Exception {
            String block = createNode(null, "Block A", null, null);
            String flat = createNode(block, "A-101", "A-101", null);

            provisionResident(flat);
            asAdmin(get("/api/v1/admin/property/nodes?depth=1"))
                    .andExpect(jsonPath("$[0].declaredOccupancy").value(1))
                    .andExpect(jsonPath("$[0].residentAccounts").value(1));

            provisionResident(flat);
            asAdmin(get("/api/v1/admin/property/nodes?depth=1"))
                    .andExpect(jsonPath("$[0].declaredOccupancy").value(2))
                    .andExpect(jsonPath("$[0].residentAccounts").value(2));
        }

        @Test
        @DisplayName("occupancy cannot be declared below the accounts already issued")
        void cannotDeclareFewerPeopleThanLogins() throws Exception {
            String block = createNode(null, "Block A", null, null);
            String flat = createNode(block, "A-101", "A-101", null);
            provisionResident(flat);
            provisionResident(flat);

            asAdmin(put("/api/v1/admin/property/nodes/" + flat + "/occupancy")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(json(Map.of("declaredOccupancy", 1))))
                    .andExpect(status().isConflict())
                    .andExpect(jsonPath("$.code").value("OCCUPANCY_BELOW_RESIDENTS"));

            // Above the account count is always fine -- that is the family with no logins.
            asAdmin(put("/api/v1/admin/property/nodes/" + flat + "/occupancy")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(json(Map.of("declaredOccupancy", 5))))
                    .andExpect(status().isOk());
        }

        @Test
        @DisplayName("a building has no occupancy of its own -- it is the sum of its units")
        void occupancyIsAUnitLevelFact() throws Exception {
            String block = createNode(null, "Block A", null, null);

            asAdmin(put("/api/v1/admin/property/nodes/" + block + "/occupancy")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(json(Map.of("declaredOccupancy", 20))))
                    .andExpect(status().isUnprocessableEntity())
                    .andExpect(jsonPath("$.code").value("OCCUPANCY_NOT_A_UNIT"));
        }

        @Test
        @DisplayName("a township with no units yet is 0% occupied, not a division by zero")
        void emptyTownshipReportsZero() throws Exception {
            asAdmin(get("/api/v1/admin/property/occupancy"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.totalUnits").value(0))
                    .andExpect(jsonPath("$.occupancyRate").value(0.0));
        }
    }

    // ----- authorization ----------------------------------------------------------------------

    @Nested
    @DisplayName("Authorization")
    class Rbac {

        @Test
        @DisplayName("a guard may read the structure but may not change it")
        void guardsReadButDoNotWrite() throws Exception {
            // Guards need the structure to route a walk-in.
            mockMvc.perform(get("/api/v1/admin/property/profile")
                            .header(HttpHeaders.AUTHORIZATION, auth.bearer(guard)))
                    .andExpect(status().isOk());

            mockMvc.perform(post("/api/v1/admin/property/nodes")
                            .header(HttpHeaders.AUTHORIZATION, auth.bearer(guard))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(json(nodeBody(null, "Rogue Tower", null, null))))
                    .andExpect(status().isForbidden());
        }

        @Test
        @DisplayName("occupancy reporting is admin-only -- a guard does not get a rent roll")
        void occupancySummaryIsAdminOnly() throws Exception {
            mockMvc.perform(get("/api/v1/admin/property/occupancy")
                            .header(HttpHeaders.AUTHORIZATION, auth.bearer(guard)))
                    .andExpect(status().isForbidden());
        }
    }

    // ----- helpers ------------------------------------------------------------------------------

    private org.springframework.test.web.servlet.ResultActions asAdmin(
            org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder request)
            throws Exception {
        return mockMvc.perform(request.header(HttpHeaders.AUTHORIZATION, auth.bearer(admin)));
    }

    private Map<String, Object> level(String kind, String singular, String plural) {
        return Map.of("kind", kind, "singular", singular, "plural", plural);
    }

    private void defineLevels(List<Map<String, Object>> levels) throws Exception {
        asAdmin(put("/api/v1/admin/property/levels")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(Map.of("levels", levels))))
                .andExpect(status().isOk());
    }

    /** Records with null members need a null-tolerant map, which {@code Map.of} is not. */
    private Map<String, Object> nodeBody(String parentId, String name, String code, Integer storey) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("parentId", parentId);
        body.put("name", name);
        body.put("code", code);
        body.put("levelNumber", storey);
        return body;
    }

    private Map<String, Object> bulkBody(String buildingId, Integer from, Integer to, int perFloor,
                                         String pattern, int digits) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("buildingId", buildingId);
        body.put("fromFloor", from);
        body.put("toFloor", to);
        body.put("unitsPerFloor", perFloor);
        body.put("codePattern", pattern);
        body.put("unitDigits", digits);
        return body;
    }

    private String createNode(String parentId, String name, String code, Integer storey)
            throws Exception {
        String body = asAdmin(post("/api/v1/admin/property/nodes")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(nodeBody(parentId, name, code, storey))))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return readString(body, "id");
    }

    private String readLevelId(int depth) throws Exception {
        String body = asAdmin(get("/api/v1/admin/property/profile"))
                .andReturn().getResponse().getContentAsString();
        return objectMapper.readTree(body).get("levels").get(depth).get("id").asText();
    }

    private String readString(String body, String field) throws Exception {
        return objectMapper.readTree(body).get(field).asText();
    }

    private void provisionResident(String flatId) throws Exception {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("role", "RESIDENT");
        body.put("flatId", flatId);
        body.put("fullName", "Resident Person");
        asAdmin(post("/api/v1/admin/users")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json(body)))
                .andExpect(status().isCreated());
    }
}
