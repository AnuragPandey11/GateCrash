package com.gatecrash.support;

import com.gatecrash.property.PropertyLevel;
import com.gatecrash.property.PropertyLevelRepository;
import com.gatecrash.property.PropertyNode;
import com.gatecrash.property.PropertyNodeKind;
import com.gatecrash.property.PropertyNodeRepository;
import com.gatecrash.property.PropertyService;
import com.gatecrash.township.Gate;
import com.gatecrash.township.GateRepository;
import com.gatecrash.township.Township;
import com.gatecrash.township.TownshipRepository;
import com.gatecrash.township.TownshipStatus;
import com.gatecrash.user.AppUser;
import com.gatecrash.user.AppUserRepository;
import com.gatecrash.user.UserRole;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.Locale;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Seeds townships, structure and accounts for integration tests.
 *
 * <p>Accounts are created with {@code mustResetPassword = false}, because the forced-reset gate
 * would otherwise block every test at the first business endpoint. The gate itself is covered
 * explicitly in {@code AuthIntegrationTest}.
 *
 * <p>{@link #reset()} leaves exactly one township in place and every no-township-argument factory
 * method below builds into it, so a test that does not care about tenancy reads exactly as it did
 * before multi-tenancy existed. Tests that <em>do</em> care call {@link #township(String)} for a
 * second tenant and pass it explicitly -- see {@code MultiTenancyTest}.
 */
@Component
@RequiredArgsConstructor
public class TestDataFactory {

    public static final String PASSWORD = "TestPassw0rd!";

    private final TownshipRepository townships;
    private final PropertyNodeRepository nodes;
    private final PropertyLevelRepository levels;
    private final GateRepository gates;
    private final AppUserRepository users;
    private final PasswordEncoder passwordEncoder;
    private final JdbcTemplate jdbcTemplate;

    private final AtomicInteger sequence = new AtomicInteger();

    private Township primary;

    /**
     * Wipes every table between test classes and stands up a fresh primary township.
     *
     * <p>{@code TRUNCATE ... CASCADE} in one statement sidesteps foreign-key ordering;
     * {@code RESTART IDENTITY} is harmless here since all keys are UUIDs. {@code township} is
     * truncated too -- it is the root of every other table, so leaving it would leave the migration's
     * DEFAULT township and its bootstrap accounts behind and make the account counts in
     * super-admin tests depend on whether the suite had run before.
     */
    @Transactional
    public void reset() {
        jdbcTemplate.execute("""
                TRUNCATE TABLE audit_log, notification_recipient, notification, community_post,
                               visitor_log, pre_approval, device, refresh_token, app_user,
                               property_node, property_level, gate, township
                RESTART IDENTITY CASCADE
                """);
        primary = township("PRIMARY");
    }

    /** The township every unqualified factory method below builds into. */
    public Township primaryTownship() {
        if (primary == null) {
            primary = township("PRIMARY");
        }
        return primary;
    }

    /** A township of its own, for tests that need a second tenant to prove isolation against. */
    @Transactional
    public Township township(String code) {
        Township township = new Township();
        // Codes are constrained to [A-Z0-9-] by township_code_shape, so the sequence is appended
        // with a dash rather than the underscore the other factories use.
        township.setCode((code + "-" + sequence.incrementAndGet()).toUpperCase(Locale.ROOT));
        township.setName(code + " Township");
        township.setStatus(TownshipStatus.ACTIVE);
        townships.saveAndFlush(township);
        seedLevels(township);
        return township;
    }

    /**
     * Two levels, Block -> Flat, matching what {@code V4__property_tree.sql} seeds for every
     * township that predated the tree. A node cannot exist at a depth its township has not defined
     * ({@code property_node_level_defined}), so this has to run before any structure is created.
     *
     * <p>Deliberately not {@code PropertyType.APARTMENT}'s preset, which is three levels deep --
     * that would put units at depth 2 and every existing test parents its flats straight onto a
     * block. Tests that want floors build the third level themselves.
     */
    private void seedLevels(Township township) {
        levels.saveAndFlush(level(township, 0, PropertyNodeKind.BUILDING, "Block", "Blocks"));
        levels.saveAndFlush(level(township, 1, PropertyNodeKind.UNIT, "Flat", "Flats"));
    }

    private PropertyLevel level(Township township, int depth, PropertyNodeKind kind,
                                String singular, String plural) {
        PropertyLevel level = new PropertyLevel();
        level.setTownship(township);
        level.setDepth(depth);
        level.setKind(kind);
        level.setSingular(singular);
        level.setPlural(plural);
        return level;
    }

    /**
     * Re-seeds a township as a three-level Tower -> Floor -> PropertyNode project, for the tests that prove
     * the tree is not just the old two-level shape wearing a new table.
     */
    @Transactional
    public void useFloorLevels(Township township) {
        levels.deleteAll(levels.findByTownship_IdOrderByDepthAsc(township.getId()));
        levels.flush();
        levels.saveAndFlush(level(township, 0, PropertyNodeKind.BUILDING, "Tower", "Towers"));
        levels.saveAndFlush(level(township, 1, PropertyNodeKind.FLOOR, "Floor", "Floors"));
        levels.saveAndFlush(level(township, 2, PropertyNodeKind.UNIT, "Apartment", "Apartments"));
    }

    /**
     * A depth-0 node. Still called {@code block} because that is what every existing test calls it,
     * and the seeded level set is still Block -> Flat -- the tree can express far more, but the
     * default fixture deliberately stays the shape the tests were written against.
     */
    @Transactional
    public PropertyNode block(String name) {
        return block(primaryTownship(), name);
    }

    @Transactional
    public PropertyNode block(Township township, String name) {
        PropertyNode block = new PropertyNode();
        block.setTownship(township);
        block.setKind(PropertyNodeKind.BUILDING);
        block.setName(name + "-" + sequence.incrementAndGet());
        return nodes.saveAndFlush(block);
    }

    /**
     * The unit inherits its parent's township, exactly as {@code PropertyService} does.
     *
     * <p>The number is used verbatim, with no sequence suffix -- unlike blocks and gates. Resident
     * login ids are derived from it ({@code A-101} -> {@code A-101-1}), so a factory that quietly
     * appended a counter would make every assertion about a login id unwritable. Unit codes are
     * unique per township rather than globally, so two townships can both hold an {@code A-101};
     * two in the same township is a genuine collision and the test wanting one should say so.
     */
    @Transactional
    public PropertyNode flat(PropertyNode block, String number) {
        PropertyNode flat = new PropertyNode();
        flat.setTownship(block.getTownship());
        flat.setParent(block);
        flat.setKind(PropertyNodeKind.UNIT);
        flat.setName(number);
        flat.setCode(number);
        return nodes.saveAndFlush(flat);
    }

    /** A storey, for the tests that exercise a three-level Tower -> Floor -> Unit township. */
    @Transactional
    public PropertyNode floor(PropertyNode building, int storey) {
        PropertyNode floor = new PropertyNode();
        floor.setTownship(building.getTownship());
        floor.setParent(building);
        floor.setKind(PropertyNodeKind.FLOOR);
        floor.setName(storey == 0 ? "Ground" : String.valueOf(storey));
        floor.setLevelNumber(storey);
        return nodes.saveAndFlush(floor);
    }

    @Transactional
    public Gate gate(String name) {
        return gate(primaryTownship(), name);
    }

    @Transactional
    public Gate gate(Township township, String name) {
        Gate gate = new Gate();
        gate.setTownship(township);
        gate.setName(name + "-" + sequence.incrementAndGet());
        return gates.save(gate);
    }

    @Transactional
    public AppUser user(UserRole role, String loginId, PropertyNode flat) {
        return user(primaryTownship(), role, loginId, flat);
    }

    @Transactional
    public AppUser user(Township township, UserRole role, String loginId, PropertyNode flat) {
        AppUser user = new AppUser();
        user.setTownship(township);
        user.setRole(role);
        user.setLoginId(loginId + "-" + sequence.incrementAndGet());
        user.setFullName(role.name().charAt(0) + role.name().substring(1).toLowerCase() + " User");
        user.setPasswordHash(passwordEncoder.encode(PASSWORD));
        user.setMustResetPassword(false);
        user.setActive(true);
        user.setUnit(flat);
        return users.save(user);
    }

    /**
     * A platform operator. Deliberately built here rather than through {@link #user}: the
     * {@code super_admin_is_tenantless} check constraint rejects a SUPER_ADMIN with a township, so
     * this is the one account shape that cannot go through the tenant-bound path.
     */
    @Transactional
    public AppUser superAdmin() {
        AppUser user = new AppUser();
        user.setTownship(null);
        user.setRole(UserRole.SUPER_ADMIN);
        user.setLoginId("superadmin-" + sequence.incrementAndGet());
        user.setFullName("Platform Operator");
        user.setPasswordHash(passwordEncoder.encode(PASSWORD));
        user.setMustResetPassword(false);
        user.setActive(true);
        return users.save(user);
    }

    @Transactional
    public AppUser admin() {
        return user(UserRole.ADMIN, "admin-test", null);
    }

    @Transactional
    public AppUser admin(Township township) {
        return user(township, UserRole.ADMIN, "admin-test", null);
    }

    @Transactional
    public AppUser guard() {
        return user(UserRole.GUARD, "guard", null);
    }

    @Transactional
    public AppUser guard(Township township) {
        return user(township, UserRole.GUARD, "guard", null);
    }

    @Transactional
    public AppUser resident(PropertyNode flat) {
        return user(flat.getTownship(), UserRole.RESIDENT, flat.getCode(), flat);
    }

    @Transactional
    public AppUser salesAgent(boolean onDuty) {
        return salesAgent(primaryTownship(), onDuty);
    }

    @Transactional
    public AppUser salesAgent(Township township, boolean onDuty) {
        AppUser agent = user(township, UserRole.SALES, "sales", null);
        agent.setOnDuty(onDuty);
        return users.save(agent);
    }
}
