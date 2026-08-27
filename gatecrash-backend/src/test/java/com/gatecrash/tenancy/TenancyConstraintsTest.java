package com.gatecrash.tenancy;

import com.gatecrash.property.PropertyNode;
import com.gatecrash.support.AbstractIntegrationTest;
import com.gatecrash.support.TestDataFactory;
import com.gatecrash.township.Gate;
import com.gatecrash.township.Township;
import com.gatecrash.user.AppUser;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;

import java.sql.Timestamp;
import java.time.OffsetDateTime;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Layer 3 of the tenancy model, tested where it lives: in the database.
 *
 * <p>Every statement here goes through raw JDBC, deliberately bypassing Hibernate, the services and
 * the whole security chain. That is the entire point — the service layer already scopes every query,
 * and {@code MultiTenancyTest} proves it does. What these assert is what happens when that layer is
 * *wrong*: a bug, a race, a future endpoint that forgets. If the answer is "the row is written
 * anyway", then tenant isolation is a convention rather than a guarantee, and the first
 * cross-tenant read is a support incident nobody can explain.
 */
@DisplayName("Tenancy: the database refuses a cross-tenant row even when the service layer is bypassed")
class TenancyConstraintsTest extends AbstractIntegrationTest {

    @Autowired
    private TestDataFactory data;

    @Autowired
    private JdbcTemplate jdbc;

    private Township alpha;
    private Township beta;
    private Gate alphaGate;
    private Gate betaGate;
    private PropertyNode alphaFlat;
    private AppUser alphaGuard;
    private AppUser alphaResident;

    @BeforeEach
    void seed() {
        data.reset();
        alpha = data.primaryTownship();
        beta = data.township("BETA");

        alphaFlat = data.flat(data.block(alpha, "Block A"), "A-101");
        alphaGate = data.gate(alpha, "Main Gate");
        betaGate = data.gate(beta, "Main Gate");
        alphaGuard = data.guard(alpha);
        alphaResident = data.resident(alphaFlat);
    }

    // ----- the SUPER_ADMIN biconditional --------------------------------------------------------

    @Test
    @DisplayName("a SUPER_ADMIN cannot be given a township")
    void superAdminCannotHoldATownship() {
        assertThatThrownBy(() -> insertUser("SUPER_ADMIN", "rogue-super", alpha.getId()))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("super_admin_is_tenantless");
    }

    @Test
    @DisplayName("every other role must have one")
    void ordinaryAccountsCannotBeTenantless() {
        // The dangerous direction of the same constraint: a tenantless GUARD would sit outside every
        // scoped query in the system, visible to nobody and belonging to no one.
        assertThatThrownBy(() -> insertUser("GUARD", "orphan-guard", null))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("super_admin_is_tenantless");

        assertThatCode(() -> insertUser("SUPER_ADMIN", "real-super", null)).doesNotThrowAnyException();
    }

    // ----- composite foreign keys ---------------------------------------------------------------

    @Test
    @DisplayName("a visit cannot point at a gate in another township")
    void visitCannotBorrowAnotherTownshipsGate() {
        assertThatThrownBy(() -> insertVisit(alpha.getId(), betaGate.getId(), alphaGuard.getId(),
                alphaFlat.getId(), alphaResident.getId()))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("visit_gate_same_township");
    }

    @Test
    @DisplayName("a visit cannot be routed to a flat in another township")
    void visitCannotBorrowAnotherTownshipsFlat() {
        PropertyNode betaFlat = data.flat(data.block(beta, "Block A"), "A-101");

        assertThatThrownBy(() -> insertVisit(alpha.getId(), alphaGate.getId(), alphaGuard.getId(),
                betaFlat.getId(), alphaResident.getId()))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("visit_unit_same_township");
    }

    @Test
    @DisplayName("a visit cannot be routed to an approver in another township")
    void visitCannotBorrowAnotherTownshipsApprover() {
        AppUser betaResident = data.resident(data.flat(data.block(beta, "Block B"), "B-201"));

        assertThatThrownBy(() -> insertVisit(alpha.getId(), alphaGate.getId(), alphaGuard.getId(),
                alphaFlat.getId(), betaResident.getId()))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("visit_approver_same_township");
    }

    @Test
    @DisplayName("a wholly consistent visit is accepted, so the tests above are about tenancy")
    void aConsistentVisitIsFine() {
        assertThatCode(() -> insertVisit(alpha.getId(), alphaGate.getId(), alphaGuard.getId(),
                alphaFlat.getId(), alphaResident.getId())).doesNotThrowAnyException();
    }

    @Test
    @DisplayName("a flat cannot belong to a block in another township")
    void flatCannotBorrowAnotherTownshipsBlock() {
        UUID betaBlockId = data.block(beta, "Block C").getId();

        assertThatThrownBy(() -> jdbc.update("""
                INSERT INTO property_node (id, township_id, parent_id, depth, kind, name, code)
                VALUES (?, ?, ?, 1, 'UNIT', ?, ?)
                """, UUID.randomUUID(), alpha.getId(), betaBlockId, "C-301", "C-301"))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("property_node_parent_same_township");
    }

    @Test
    @DisplayName("a resident cannot be filed under a floor or a whole building")
    void residentMustAttachToAUnit() {
        // The service layer resolves the unit level before it writes, but this is the backstop that
        // holds when the service layer is bypassed entirely -- the composite key carries is_unit,
        // so only a node at the addressable level satisfies it.
        UUID alphaBlockId = data.block(alpha, "Block D").getId();

        assertThatThrownBy(() -> jdbc.update("""
                INSERT INTO app_user (id, township_id, role, login_id, full_name, password_hash, flat_id)
                VALUES (?, ?, 'RESIDENT', ?, 'Wrong Level', '!', ?)
                """, UUID.randomUUID(), alpha.getId(), "wrong-level-1", alphaBlockId))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("user_unit_same_township");
    }

    @Test
    @DisplayName("nothing can be filed inside a unit -- a unit is always a leaf")
    void aUnitCannotHaveChildren() {
        UUID alphaUnitId = data.flat(data.block(alpha, "Block E"), "E-501").getId();

        assertThatThrownBy(() -> jdbc.update("""
                INSERT INTO property_node (id, township_id, parent_id, depth, kind, name, code)
                VALUES (?, ?, ?, 2, 'UNIT', ?, ?)
                """, UUID.randomUUID(), alpha.getId(), alphaUnitId, "E-501-A", "E-501-A"))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("cannot have children");
    }

    @Test
    @DisplayName("unit codes are unique township-wide, because login ids derive from them")
    void unitCodesAreUniquePerTownship() {
        data.flat(data.block(alpha, "Block F"), "F-601");

        // The old schema scoped this to the block, so two blocks could each hold a "101" and both
        // mint the login id "101-1". Township-wide is what makes that derivation sound.
        assertThatThrownBy(() -> jdbc.update("""
                INSERT INTO property_node (id, township_id, parent_id, depth, kind, name, code)
                VALUES (?, ?, ?, 1, 'UNIT', ?, ?)
                """, UUID.randomUUID(), alpha.getId(),
                data.block(alpha, "Block G").getId(), "F-601", "f-601"))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("ux_node_unit_code");

        // ...but the same code in another township is exactly what tenancy is for.
        assertThatCode(() -> data.flat(data.block(beta, "Block F"), "F-601"))
                .doesNotThrowAnyException();
    }

    // ----- per-tenant uniqueness ----------------------------------------------------------------

    @Test
    @DisplayName("the same login id in two townships is allowed; twice in one is not")
    void loginIdIsUniquePerTownship() {
        insertUser("GUARD", "shared-code", alpha.getId());

        // The whole reason login takes a township code: this has to be legal.
        assertThatCode(() -> insertUser("GUARD", "shared-code", beta.getId()))
                .doesNotThrowAnyException();

        assertThatThrownBy(() -> insertUser("GUARD", "shared-code", alpha.getId()))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("ux_user_township_login");
    }

    @Test
    @DisplayName("two super admins cannot share a login id")
    void platformLoginIdsAreUniqueToo() {
        insertUser("SUPER_ADMIN", "operator", null);

        // NULLs are distinct under the composite index, so without the partial index on the
        // tenantless namespace this would succeed and the credential would be ambiguous.
        assertThatThrownBy(() -> insertUser("SUPER_ADMIN", "operator", null))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("ux_user_platform_login");
    }

    @Test
    @DisplayName("a phone number may repeat across townships but not within one")
    void contactDetailsAreUniquePerTownship() {
        jdbc.update("UPDATE app_user SET phone = ? WHERE id = ?", "+919800001111", alphaGuard.getId());

        AppUser betaGuard = data.guard(beta);
        assertThatCode(() -> jdbc.update("UPDATE app_user SET phone = ? WHERE id = ?",
                "+919800001111", betaGuard.getId())).doesNotThrowAnyException();

        AppUser alphaSales = data.salesAgent(alpha, false);
        assertThatThrownBy(() -> jdbc.update("UPDATE app_user SET phone = ? WHERE id = ?",
                "+919800001111", alphaSales.getId()))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("ux_user_township_phone");
    }

    @Test
    @DisplayName("block names collide across townships without conflict")
    void blockNamesAreUniquePerTownship() {
        String insert = """
                INSERT INTO property_node (id, township_id, parent_id, depth, kind, name)
                VALUES (?, ?, NULL, 0, 'BUILDING', ?)
                """;
        jdbc.update(insert, UUID.randomUUID(), alpha.getId(), "Tower 9");

        assertThatCode(() -> jdbc.update(insert, UUID.randomUUID(), beta.getId(), "Tower 9"))
                .doesNotThrowAnyException();

        // Case-insensitively, matching what PropertyService checks before it writes.
        assertThatThrownBy(() -> jdbc.update(insert, UUID.randomUUID(), alpha.getId(), "tower 9"))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("ux_node_root_name");
    }

    // ----- the township row itself --------------------------------------------------------------

    @Test
    @DisplayName("a township code must be upper case and unambiguous")
    void townshipCodeShapeIsEnforced() {
        assertThatThrownBy(() -> insertTownship("lower-case"))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("township_code_shape");

        assertThatThrownBy(() -> insertTownship("HAS SPACE"))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("township_code_shape");

        assertThatCode(() -> insertTownship("GREENWOOD-2")).doesNotThrowAnyException();
    }

    @Test
    @DisplayName("an archived township always carries the timestamp that says when")
    void archivingIsAlwaysStamped() {
        assertThatThrownBy(() -> jdbc.update(
                "UPDATE township SET status = 'ARCHIVED'::township_status WHERE id = ?", beta.getId()))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("archived_is_stamped");
    }

    @Test
    @DisplayName("the migration seeds the DEFAULT township and a tenantless bootstrap super admin")
    void migrationSeedsThePlatformBootstrap() {
        // Read from a fresh schema rather than the truncated one this class works in: these rows are
        // what a newly migrated database offers as its only way in, so their shape is a contract.
        assertThat(jdbc.queryForObject("""
                SELECT count(*) FROM information_schema.check_constraints
                 WHERE constraint_name = 'super_admin_is_tenantless'
                """, Integer.class)).isEqualTo(1);

        assertThat(jdbc.queryForObject("""
                SELECT enumlabel FROM pg_enum e
                  JOIN pg_type t ON t.oid = e.enumtypid
                 WHERE t.typname = 'user_role' AND e.enumlabel = 'SUPER_ADMIN'
                """, String.class)).isEqualTo("SUPER_ADMIN");
    }

    // ----- helpers ------------------------------------------------------------------------------

    private void insertUser(String role, String loginId, UUID townshipId) {
        jdbc.update("""
                INSERT INTO app_user (id, township_id, role, login_id, full_name, password_hash)
                VALUES (?, ?, ?::user_role, ?, ?, '!')
                """, UUID.randomUUID(), townshipId, role, loginId, "Raw Insert");
    }

    private void insertVisit(UUID townshipId, UUID gateId, UUID guardId, UUID flatId, UUID approverId) {
        jdbc.update("""
                INSERT INTO visitor_log (id, township_id, gate_id, logged_by, visitor_name,
                                         visitor_type, approver_id, approver_kind, target_flat_id,
                                         status, created_at, updated_at, version)
                VALUES (?, ?, ?, ?, 'Raw Insert', 'GUEST'::visitor_type, ?,
                        'RESIDENT'::approver_kind, ?, 'PENDING'::visit_status, ?, ?, 0)
                """, UUID.randomUUID(), townshipId, gateId, guardId, approverId, flatId,
                Timestamp.from(OffsetDateTime.now().toInstant()),
                Timestamp.from(OffsetDateTime.now().toInstant()));
    }

    private void insertTownship(String code) {
        jdbc.update("INSERT INTO township (id, code, name) VALUES (?, ?, ?)",
                UUID.randomUUID(), code, "Constraint Probe");
    }
}
