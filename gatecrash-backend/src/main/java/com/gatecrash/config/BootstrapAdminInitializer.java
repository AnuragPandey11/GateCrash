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
 * Gives the seeded bootstrap admin a usable password.
 *
 * <p>The Flyway seed deliberately inserts a hash that nothing can match, so a freshly migrated
 * database has no way in until this runs. Committing a known bcrypt hash to source control would mean
 * every deployment of this software shipped with the same admin password -- the failure mode behind a
 * large share of real-world breaches of self-hosted systems.
 *
 * <p>Behaviour by environment:
 * <ul>
 *   <li>{@code GATECRASH_BOOTSTRAP_ADMIN_PASSWORD} set -- that password is applied. This is the
 *       production path; the value comes from the secret store.</li>
 *   <li>Not set, development profile -- a random password is generated and logged <em>once</em>.</li>
 *   <li>Not set, any other profile -- startup fails, rather than leaving an unreachable admin
 *       account or, worse, a guessable one.</li>
 * </ul>
 *
 * <p>Runs only while the account is still unusable, so restarts never rotate a password an operator
 * has already changed.
 */
@Component
@RequiredArgsConstructor
public class BootstrapAdminInitializer implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(BootstrapAdminInitializer.class);

    /** The placeholder written by {@code V1__init.sql}; not a valid bcrypt digest. */
    private static final String UNUSABLE_HASH = "!";

    private final AppUserRepository users;
    private final PasswordEncoder passwordEncoder;
    private final PasswordGenerator passwordGenerator;
    private final AppProperties properties;
    private final Environment environment;

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        String loginId = properties.bootstrap().adminLoginId();
        Optional<AppUser> maybeAdmin = users.findByLoginId(loginId);
        if (maybeAdmin.isEmpty()) {
            log.debug("No bootstrap admin '{}' present; nothing to initialise", loginId);
            return;
        }

        AppUser admin = maybeAdmin.get();
        if (!UNUSABLE_HASH.equals(admin.getPasswordHash())) {
            return;   // already initialised; never rotate a live credential on restart
        }

        String configured = properties.bootstrap().adminPassword();
        if (configured != null && !configured.isBlank()) {
            apply(admin, configured);
            log.info("Bootstrap admin '{}' initialised from configuration. "
                    + "It must be changed at first login.", loginId);
            return;
        }

        if (!isDevelopmentProfile()) {
            throw new IllegalStateException(
                    "Bootstrap admin '" + loginId + "' has no password and "
                            + "GATECRASH_BOOTSTRAP_ADMIN_PASSWORD is not set. Refusing to start.");
        }

        String generated = passwordGenerator.generate();
        apply(admin, generated);
        log.warn("""

                ================================================================
                 BOOTSTRAP ADMIN CREATED (development profile only)
                   login id : {}
                   password : {}
                 This is printed once. Change it immediately after signing in.
                ================================================================""", loginId, generated);
    }

    private void apply(AppUser admin, String rawPassword) {
        admin.setPasswordHash(passwordEncoder.encode(rawPassword));
        admin.setMustResetPassword(true);
        users.save(admin);
    }

    private boolean isDevelopmentProfile() {
        String[] active = environment.getActiveProfiles();
        return active.length == 0 || List.of(active).stream()
                .anyMatch(profile -> profile.equals("local") || profile.equals("test"));
    }
}
