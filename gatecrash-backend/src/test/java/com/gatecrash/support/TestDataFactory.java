package com.gatecrash.support;

import com.gatecrash.township.BuildingBlock;
import com.gatecrash.township.BuildingBlockRepository;
import com.gatecrash.township.Flat;
import com.gatecrash.township.FlatRepository;
import com.gatecrash.township.Gate;
import com.gatecrash.township.GateRepository;
import com.gatecrash.user.AppUser;
import com.gatecrash.user.AppUserRepository;
import com.gatecrash.user.UserRole;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.concurrent.atomic.AtomicInteger;

/**
 * Seeds township structure and accounts for integration tests.
 *
 * <p>Accounts are created with {@code mustResetPassword = false}, because the forced-reset gate
 * would otherwise block every test at the first business endpoint. The gate itself is covered
 * explicitly in {@code AuthIntegrationTest}.
 */
@Component
@RequiredArgsConstructor
public class TestDataFactory {

    public static final String PASSWORD = "TestPassw0rd!";

    private final BuildingBlockRepository blocks;
    private final FlatRepository flats;
    private final GateRepository gates;
    private final AppUserRepository users;
    private final PasswordEncoder passwordEncoder;
    private final JdbcTemplate jdbcTemplate;

    private final AtomicInteger sequence = new AtomicInteger();

    /**
     * Wipes every table between test classes. {@code TRUNCATE ... CASCADE} in one statement sidesteps
     * foreign-key ordering; {@code RESTART IDENTITY} is harmless here since all keys are UUIDs.
     */
    @Transactional
    public void reset() {
        jdbcTemplate.execute("""
                TRUNCATE TABLE audit_log, notification_recipient, notification, community_post,
                               visitor_log, pre_approval, device, refresh_token, app_user,
                               flat, building_block, gate
                RESTART IDENTITY CASCADE
                """);
    }

    @Transactional
    public BuildingBlock block(String name) {
        BuildingBlock block = new BuildingBlock();
        block.setName(name + "-" + sequence.incrementAndGet());
        return blocks.save(block);
    }

    @Transactional
    public Flat flat(BuildingBlock block, String number) {
        Flat flat = new Flat();
        flat.setBlock(block);
        flat.setNumber(number);
        return flats.save(flat);
    }

    @Transactional
    public Gate gate(String name) {
        Gate gate = new Gate();
        gate.setName(name + "-" + sequence.incrementAndGet());
        return gates.save(gate);
    }

    @Transactional
    public AppUser user(UserRole role, String loginId, Flat flat) {
        AppUser user = new AppUser();
        user.setRole(role);
        user.setLoginId(loginId + "-" + sequence.incrementAndGet());
        user.setFullName(role.name().charAt(0) + role.name().substring(1).toLowerCase() + " User");
        user.setPasswordHash(passwordEncoder.encode(PASSWORD));
        user.setMustResetPassword(false);
        user.setActive(true);
        user.setFlat(flat);
        return users.save(user);
    }

    @Transactional
    public AppUser admin() {
        return user(UserRole.ADMIN, "admin-test", null);
    }

    @Transactional
    public AppUser guard() {
        return user(UserRole.GUARD, "guard", null);
    }

    @Transactional
    public AppUser resident(Flat flat) {
        return user(UserRole.RESIDENT, flat.getNumber(), flat);
    }

    @Transactional
    public AppUser salesAgent(boolean onDuty) {
        AppUser agent = user(UserRole.SALES, "sales", null);
        agent.setOnDuty(onDuty);
        return users.save(agent);
    }
}
