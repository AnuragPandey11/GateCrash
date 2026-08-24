package com.gatecrash.config;

import com.gatecrash.township.BuildingBlock;
import com.gatecrash.township.BuildingBlockRepository;
import com.gatecrash.township.Flat;
import com.gatecrash.township.FlatRepository;
import com.gatecrash.township.Gate;
import com.gatecrash.township.GateRepository;
import com.gatecrash.user.AppUser;
import com.gatecrash.user.AppUserRepository;
import com.gatecrash.user.PasswordPolicy;
import com.gatecrash.user.UserRole;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.core.env.Environment;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;

/**
 * Seeds a usable township for local development — one account per role, plus the block, flats and
 * gate they need to be useful.
 *
 * <p>Why this exists: a resident cannot be provisioned without a flat, a flat needs a block, and a
 * guard cannot log a visit without a gate. Standing that up by hand is five API calls before
 * anything can be tested, and it leaves generated passwords scattered through a terminal. Seeding
 * it makes the first run of the admin web app — and later the mobile app — a sign-in rather than a
 * setup exercise.
 *
 * <p><b>This is refused outside the local and test profiles.</b> Every seeded account shares one
 * password that is written to the log and to the README; anywhere real, that is not a convenience,
 * it is a breach. The profile check is deliberate belt-and-braces alongside the
 * {@code app.bootstrap.seed-demo-data} flag, which is only enabled in {@code application-local.yml}
 * — either one alone would be a single point of failure for a mistake nobody would notice until
 * after it mattered.
 *
 * <p>Runs after {@link BootstrapAdminInitializer} so the admin row already has its password set.
 *
 * <p>Everything here is idempotent: existing rows are left exactly as they are, so a restart
 * neither duplicates nor overwrites. In particular an admin who has already chosen their own
 * password is never touched — only one still carrying the bootstrap forced-reset flag is
 * normalised, because that flag is what otherwise blocks the first sign-in.
 */
@Component
@RequiredArgsConstructor
@Order(Ordered.LOWEST_PRECEDENCE)
public class DevDataSeeder implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(DevDataSeeder.class);

    private static final String BLOCK_NAME = "Block A";
    private static final String GATE_NAME = "Main Gate";
    private static final List<String> FLAT_NUMBERS = List.of("A-101", "A-102", "A-103", "A-104");

    private final AppUserRepository users;
    private final BuildingBlockRepository blocks;
    private final FlatRepository flats;
    private final GateRepository gates;
    private final PasswordEncoder passwordEncoder;
    private final PasswordPolicy passwordPolicy;
    private final AppProperties properties;
    private final Environment environment;

    /** One account per role. The resident is attached to the first seeded flat. */
    private record SeedAccount(UserRole role, String loginId, String fullName, String phone) {
    }

    private static final List<SeedAccount> STAFF = List.of(
            new SeedAccount(UserRole.GUARD, "guard-01", "Gate Guard One", "+919800000001"),
            new SeedAccount(UserRole.SALES, "sales-01", "Meera Shah", "+919800000002"));

    private static final SeedAccount RESIDENT =
            new SeedAccount(UserRole.RESIDENT, null, "Ravi Kumar", "+919800000003");

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        if (!properties.bootstrap().seedDemoData()) {
            return;
        }
        if (!isDevelopmentProfile()) {
            // Loud, and fatal. Silently ignoring the flag would let a misconfigured deploy look
            // healthy while a reviewer assumed the seeding had happened -- or worse, assumed it
            // had not.
            throw new IllegalStateException(
                    "app.bootstrap.seed-demo-data is enabled outside the local/test profiles. "
                            + "Demo accounts share a known password and must never exist in a real "
                            + "environment. Refusing to start.");
        }

        String password = properties.bootstrap().seedPassword();
        if (password == null || password.isBlank()) {
            throw new IllegalStateException(
                    "app.bootstrap.seed-demo-data is enabled but app.bootstrap.seed-password is not set.");
        }

        // Validated against every account *before* anything is written. The policy rejects a
        // password containing the holder's login id or name, so one value can be legal for three
        // accounts and illegal for the fourth -- and discovering that halfway through leaves a
        // half-built township behind (the transaction rolls it back, but the error then points at
        // a null block rather than at the actual misconfiguration).
        validateSeedPassword(password);

        BuildingBlock block = seedBlock();
        List<Flat> seededFlats = seedFlats(block);
        seedGate();

        List<String> created = new ArrayList<>();
        for (SeedAccount staff : STAFF) {
            if (seedStaff(staff, password)) {
                created.add(staff.role() + " " + staff.loginId());
            }
        }

        // The resident's login id is derived from the flat exactly as UserProvisioningService
        // derives it (A-101-1, A-101-2, ...), so a seeded resident is indistinguishable from a
        // provisioned one.
        Flat firstFlat = seededFlats.isEmpty() ? null : seededFlats.get(0);
        if (firstFlat != null) {
            String residentLoginId = firstFlat.getNumber() + "-1";
            if (seedResident(residentLoginId, firstFlat, password)) {
                created.add("RESIDENT " + residentLoginId);
            }
        }

        String adminLoginId = properties.bootstrap().adminLoginId();
        boolean adminReady = normaliseBootstrapAdmin(adminLoginId, password);

        if (created.isEmpty() && !adminReady) {
            log.info("Demo data already present; nothing to seed.");
            return;
        }

        // Mirrors BootstrapAdminInitializer's dev-only banner. The guardrail against logging
        // credentials is about *generated* secrets in real environments; this is a configured
        // fixture on a developer's laptop, and printing it is the point.
        log.warn("""

                ================================================================
                 DEMO DATA SEEDED (local/test profiles only)
                   township : {} / {} flats / {}
                   accounts : {}{}
                   password : {}
                 Every seeded account uses that one password. Never enable
                 app.bootstrap.seed-demo-data outside local development.
                ================================================================""",
                BLOCK_NAME, FLAT_NUMBERS.size(), GATE_NAME,
                created.isEmpty() ? "(none new)" : String.join(", ", created),
                adminReady ? ", ADMIN " + adminLoginId : "",
                password);
    }

    /**
     * Check the configured password against every account this seeder could create, including the
     * bootstrap admin and the derived resident login id, before touching the database.
     */
    private void validateSeedPassword(String password) {
        List<SeedAccount> candidates = new ArrayList<>(STAFF);
        candidates.add(new SeedAccount(UserRole.ADMIN, properties.bootstrap().adminLoginId(),
                "Bootstrap Admin", null));
        // Matches what UserProvisioningService would derive for the first resident of the first flat.
        candidates.add(new SeedAccount(UserRole.RESIDENT, FLAT_NUMBERS.get(0) + "-1",
                RESIDENT.fullName(), null));

        for (SeedAccount candidate : candidates) {
            try {
                passwordPolicy.validate(password, candidate.loginId(), candidate.fullName());
            } catch (RuntimeException ex) {
                throw new IllegalStateException(
                        "app.bootstrap.seed-password is not usable for the seeded account '"
                                + candidate.loginId() + "': " + ex.getMessage(), ex);
            }
        }
    }

    private BuildingBlock seedBlock() {
        return blocks.findAll().stream()
                .filter(existing -> existing.getName().equalsIgnoreCase(BLOCK_NAME))
                .findFirst()
                .orElseGet(() -> {
                    BuildingBlock block = new BuildingBlock();
                    block.setName(BLOCK_NAME);
                    return blocks.save(block);
                });
    }

    private List<Flat> seedFlats(BuildingBlock block) {
        List<Flat> result = new ArrayList<>();
        for (String number : FLAT_NUMBERS) {
            if (flats.existsByBlock_IdAndNumberIgnoreCase(block.getId(), number)) {
                flats.findByBlock_IdOrderByNumberAsc(block.getId()).stream()
                        .filter(flat -> flat.getNumber().equalsIgnoreCase(number))
                        .findFirst()
                        .ifPresent(result::add);
                continue;
            }
            Flat flat = new Flat();
            flat.setBlock(block);
            flat.setNumber(number);
            result.add(flats.save(flat));
        }
        return result;
    }

    private void seedGate() {
        if (gates.existsByNameIgnoreCase(GATE_NAME)) {
            return;
        }
        Gate gate = new Gate();
        gate.setName(GATE_NAME);
        gates.save(gate);
    }

    private boolean seedStaff(SeedAccount account, String password) {
        if (users.existsByLoginId(account.loginId())) {
            return false;
        }
        AppUser user = newUser(account.role(), account.loginId(), account.fullName(),
                account.phone(), password);
        users.save(user);
        return true;
    }

    private boolean seedResident(String loginId, Flat flat, String password) {
        if (users.existsByLoginId(loginId)) {
            return false;
        }
        AppUser user = newUser(UserRole.RESIDENT, loginId, RESIDENT.fullName(), RESIDENT.phone(),
                password);
        user.setFlat(flat);
        users.save(user);
        return true;
    }

    private AppUser newUser(UserRole role, String loginId, String fullName, String phone,
                            String password) {
        // The password was already validated for every candidate account in validateSeedPassword.
        AppUser user = new AppUser();
        user.setRole(role);
        user.setLoginId(loginId);
        user.setFullName(fullName);
        user.setPhone(phone == null || users.existsByPhone(phone) ? null : phone);
        user.setPasswordHash(passwordEncoder.encode(password));
        // The whole point of a seeded account is that it is ready to use. A forced reset on four
        // fixtures is four password changes before any testing can start.
        user.setMustResetPassword(false);
        user.setActive(true);
        return user;
    }

    /**
     * Give the bootstrap admin the same known password, but only while it still carries the
     * forced-reset flag it was created with.
     *
     * <p>An admin who has already chosen their own password is left completely alone — silently
     * resetting a credential on every restart is exactly the kind of surprise that makes a
     * developer distrust their environment.
     */
    private boolean normaliseBootstrapAdmin(String adminLoginId, String password) {
        return users.findByLoginId(adminLoginId)
                .filter(AppUser::isMustResetPassword)
                .map(admin -> {
                    admin.setPasswordHash(passwordEncoder.encode(password));
                    admin.setMustResetPassword(false);
                    admin.bumpTokenVersion();
                    users.save(admin);
                    return true;
                })
                .orElse(false);
    }

    private boolean isDevelopmentProfile() {
        String[] active = environment.getActiveProfiles();
        return active.length == 0 || List.of(active).stream()
                .anyMatch(profile -> profile.equals("local") || profile.equals("test"));
    }
}
