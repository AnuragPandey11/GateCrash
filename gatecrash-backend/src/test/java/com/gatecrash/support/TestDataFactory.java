package com.gatecrash.support;

import com.gatecrash.township.BuildingBlock;
import com.gatecrash.township.BuildingBlockRepository;
import com.gatecrash.township.Flat;
import com.gatecrash.township.FlatRepository;
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
    private final BuildingBlockRepository blocks;
    private final FlatRepository flats;
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
                               flat, building_block, gate, township
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
        return townships.save(township);
    }

    @Transactional
    public BuildingBlock block(String name) {
        return block(primaryTownship(), name);
    }

    @Transactional
    public BuildingBlock block(Township township, String name) {
        BuildingBlock block = new BuildingBlock();
        block.setTownship(township);
        block.setName(name + "-" + sequence.incrementAndGet());
        return blocks.save(block);
    }

    /** The flat inherits its block's township, exactly as {@code TownshipService} does. */
    @Transactional
    public Flat flat(BuildingBlock block, String number) {
        Flat flat = new Flat();
        flat.setTownship(block.getTownship());
        flat.setBlock(block);
        flat.setNumber(number);
        return flats.save(flat);
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
    public AppUser user(UserRole role, String loginId, Flat flat) {
        return user(primaryTownship(), role, loginId, flat);
    }

    @Transactional
    public AppUser user(Township township, UserRole role, String loginId, Flat flat) {
        AppUser user = new AppUser();
        user.setTownship(township);
        user.setRole(role);
        user.setLoginId(loginId + "-" + sequence.incrementAndGet());
        user.setFullName(role.name().charAt(0) + role.name().substring(1).toLowerCase() + " User");
        user.setPasswordHash(passwordEncoder.encode(PASSWORD));
        user.setMustResetPassword(false);
        user.setActive(true);
        user.setFlat(flat);
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
    public AppUser resident(Flat flat) {
        return user(flat.getTownship(), UserRole.RESIDENT, flat.getNumber(), flat);
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
