package com.gatecrash.config;

import com.gatecrash.township.BuildingBlockRepository;
import com.gatecrash.township.FlatRepository;
import com.gatecrash.township.GateRepository;
import com.gatecrash.user.AppUserRepository;
import com.gatecrash.user.PasswordPolicy;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.DefaultApplicationArguments;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;

/**
 * The seeder's refusal to run outside local development.
 *
 * <p>This is the part of {@code DevDataSeeder} most worth testing, because the failure mode is
 * severe and silent: four accounts sharing a password printed into a log, in an environment where
 * somebody assumed that could not happen. The profile check is deliberately redundant with the
 * config flag, and this asserts the redundancy is real -- that turning the flag on is not, by
 * itself, enough to seed.
 */
@DisplayName("Demo data seeding")
class DevDataSeederTest {

    private final AppUserRepository users = mock(AppUserRepository.class);
    private final BuildingBlockRepository blocks = mock(BuildingBlockRepository.class);
    private final FlatRepository flats = mock(FlatRepository.class);
    private final GateRepository gates = mock(GateRepository.class);
    private final PasswordEncoder passwordEncoder = mock(PasswordEncoder.class);

    @Test
    @DisplayName("refuses to start when enabled outside local or test")
    void refusesOutsideDevelopment() {
        DevDataSeeder seeder = seeder(properties(true, "Township#2026"), "prod");

        assertThatThrownBy(() -> seeder.run(new DefaultApplicationArguments()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("must never exist in a real");

        // Nothing was written before the refusal -- it fails closed, not halfway.
        verifyNoInteractions(users, blocks, flats, gates);
    }

    @Test
    @DisplayName("does nothing at all when the flag is off, whatever the profile")
    void noOpWhenDisabled() {
        for (String profile : List.of("prod", "local", "test")) {
            DevDataSeeder seeder = seeder(properties(false, "Township#2026"), profile);
            assertThatCode(() -> seeder.run(new DefaultApplicationArguments()))
                    .doesNotThrowAnyException();
        }
        verifyNoInteractions(users, blocks, flats, gates);
    }

    @Test
    @DisplayName("refuses to seed accounts nobody could sign into")
    void refusesUnusablePassword() {
        // A password containing a seeded account's login id is rejected by PasswordPolicy.
        // Catching that at startup beats creating accounts that cannot authenticate.
        DevDataSeeder seeder = seeder(properties(true, "Guard-01-Secret#9"), "local");

        assertThatThrownBy(() -> seeder.run(new DefaultApplicationArguments()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("seed-password");
    }

    @Test
    @DisplayName("refuses an enabled flag with no password configured")
    void refusesMissingPassword() {
        DevDataSeeder seeder = seeder(properties(true, ""), "local");

        assertThatThrownBy(() -> seeder.run(new DefaultApplicationArguments()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("seed-password is not set");
    }

    @Test
    @DisplayName("the shipped default is off")
    void defaultsToDisabled() {
        // application.yml ships `seed-demo-data: false`; only application-local.yml turns it on.
        assertThat(properties(false, null).bootstrap().seedDemoData()).isFalse();
    }

    private DevDataSeeder seeder(AppProperties properties, String... profiles) {
        MockEnvironment environment = new MockEnvironment();
        environment.setActiveProfiles(profiles);
        return new DevDataSeeder(users, blocks, flats, gates, passwordEncoder,
                new PasswordPolicy(properties), properties, environment);
    }

    private AppProperties properties(boolean seed, String seedPassword) {
        return new AppProperties(
                new AppProperties.Jwt("x".repeat(32), "gatecrash", 30, 30),
                new AppProperties.Firebase(false, null),
                new AppProperties.Visit(10, 200),
                new AppProperties.Password(12, 10, 128),
                new AppProperties.Pass(6, "y".repeat(32), 30, 50),
                new AppProperties.Security(
                        new AppProperties.Security.Cors(List.of("https://example.com")),
                        new AppProperties.Security.Login(5, 15),
                        new AppProperties.Security.Redeem(10, 1)),
                new AppProperties.Bootstrap("admin", "", seed, seedPassword));
    }
}
