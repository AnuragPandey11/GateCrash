package com.gatecrash.config;

import com.gatecrash.user.AppUser;
import com.gatecrash.user.AppUserRepository;
import com.gatecrash.user.PasswordGenerator;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.env.Environment;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;

/**
 * Gives the two seeded bootstrap accounts a usable password.
 *
 * <p>The Flyway seeds deliberately insert a hash that nothing can match, so a freshly migrated
 * database has no way in until this runs. Committing a known bcrypt hash to source control would mean
 * every deployment of this software shipped with the same admin password -- the failure mode behind a
 * large share of real-world breaches of self-hosted systems.
 *
 * <p>There are two accounts because there are two levels of authority:
 * <ul>
 *   <li><b>{@code superadmin}</b> ({@code V3}) -- the platform operator. Belongs to no township, and
 *       is the only account that can create one. On a brand-new install this is the account you sign
 *       in as first; everything else follows from a township it creates.</li>
 *   <li><b>{@code admin}</b> ({@code V1}) -- administrator of the {@code DEFAULT} township, which is
 *       where the multi-tenancy migration adopts any pre-existing single-tenant data. On a fresh
 *       install it is simply a first township that is already usable.</li>
 * </ul>
 *
 * <p>Behaviour is the same for each, and driven by its own environment variable
 * ({@code GATECRASH_BOOTSTRAP_SUPER_ADMIN_PASSWORD}, {@code GATECRASH_BOOTSTRAP_ADMIN_PASSWORD}):
 * <ul>
 *   <li>set -- that password is applied. This is the production path; the value comes from the
 *       secret store.</li>
 *   <li>not set, development profile -- a random password is generated and logged <em>once</em>.</li>
 *   <li>not set, any other profile -- startup fails, rather than leaving an unreachable account or,
 *       worse, a guessable one.</li>
 * </ul>
 *
 * <p>Runs only while an account is still unusable, so restarts never rotate a password an operator
 * has already changed.
 */
@Component
@RequiredArgsConstructor
public class BootstrapAdminInitializer implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(BootstrapAdminInitializer.class);

    /** The placeholder written by the migrations; not a valid bcrypt digest. */
    private static final String UNUSABLE_HASH = "!";

    private final AppUserRepository users;
    private final PasswordEncoder passwordEncoder;
    private final PasswordGenerator passwordGenerator;
    private final AppProperties properties;
    private final Environment environment;

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        AppProperties.Bootstrap bootstrap = properties.bootstrap();

        initialise("super admin", bootstrap.superAdminLoginId(), bootstrap.superAdminPassword(),
                "GATECRASH_BOOTSTRAP_SUPER_ADMIN_PASSWORD",
                users.findByTownshipIsNullAndLoginId(bootstrap.superAdminLoginId()));

        initialise("township admin", bootstrap.adminLoginId(), bootstrap.adminPassword(),
                "GATECRASH_BOOTSTRAP_ADMIN_PASSWORD",
                users.findByTownship_CodeAndLoginId(bootstrap.defaultTownshipCode(),
                        bootstrap.adminLoginId()));
    }

    private void initialise(String label, String loginId, String configuredPassword,
                            String environmentVariable, Optional<AppUser> maybeAccount) {
        if (maybeAccount.isEmpty()) {
            log.debug("No bootstrap {} '{}' present; nothing to initialise", label, loginId);
            return;
        }

        AppUser account = maybeAccount.get();
        if (!UNUSABLE_HASH.equals(account.getPasswordHash())) {
            return;   // already initialised; never rotate a live credential on restart
        }

        if (configuredPassword != null && !configuredPassword.isBlank()) {
            apply(account, configuredPassword);
            log.info("Bootstrap {} '{}' initialised from configuration. "
                    + "It must be changed at first login.", label, loginId);
            return;
        }

        if (!isDevelopmentProfile()) {
            throw new IllegalStateException(
                    "Bootstrap " + label + " '" + loginId + "' has no password and "
                            + environmentVariable + " is not set. Refusing to start.");
        }

        String generated = passwordGenerator.generate();
        apply(account, generated);
        log.warn("""

                ================================================================
                 BOOTSTRAP {} CREATED (development profile only)
                   login id : {}
                   township : {}
                   password : {}
                 This is printed once. Change it immediately after signing in.
                ================================================================""",
                label.toUpperCase(java.util.Locale.ROOT), loginId,
                account.getTownship() == null ? "(none - platform operator)"
                        : account.getTownship().getCode(),
                generated);
    }

    private void apply(AppUser account, String rawPassword) {
        account.setPasswordHash(passwordEncoder.encode(rawPassword));
        account.setMustResetPassword(true);
        users.save(account);
    }

    private boolean isDevelopmentProfile() {
        String[] active = environment.getActiveProfiles();
        return active.length == 0 || List.of(active).stream()
                .anyMatch(profile -> profile.equals("local") || profile.equals("test"));
    }
}
