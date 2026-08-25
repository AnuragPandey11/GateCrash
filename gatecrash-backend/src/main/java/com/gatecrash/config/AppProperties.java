package com.gatecrash.config;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

import java.util.List;

/**
 * Strongly typed binding for the {@code app.*} configuration tree. Validation runs at startup, so a
 * misconfigured environment fails fast at boot rather than at the first request that needs the value.
 */
@Validated
@ConfigurationProperties(prefix = "app")
public record AppProperties(
        @Valid @NotNull Jwt jwt,
        @Valid @NotNull Firebase firebase,
        @Valid @NotNull Visit visit,
        @Valid @NotNull Password password,
        @Valid @NotNull Pass pass,
        @Valid @NotNull Security security,
        @Valid @NotNull Bootstrap bootstrap) {

    public record Jwt(
            @NotBlank String secret,
            @NotBlank String issuer,
            @Min(1) @Max(1440) int accessTtlMin,
            @Min(1) @Max(365) int refreshTtlDays) {
    }

    public record Firebase(boolean enabled, String credentials) {
    }

    public record Visit(
            @Min(1) @Max(1440) int pendingTtlMinutes,
            @Min(1) @Max(1000) int gateFeedMaxSize) {
    }

    public record Password(
            @Min(8) @Max(64) int generatedLength,
            @Min(8) int minLength,
            @Max(256) int maxLength) {
    }

    public record Pass(
            @Min(4) @Max(10) int pinLength,
            @NotBlank String pinPepper,
            @Min(1) @Max(365) int maxValidityDays,
            @Min(1) @Max(1000) int maxUsesLimit) {
    }

    public record Security(
            @Valid @NotNull Cors cors,
            @Valid @NotNull Login login,
            @Valid @NotNull Redeem redeem) {

        public record Cors(@NotNull List<String> allowedOrigins) {
        }

        public record Login(@Min(1) int maxAttempts, @Min(1) int lockoutMinutes) {
        }

        public record Redeem(@Min(1) int maxAttempts, @Min(1) int windowMinutes) {
        }
    }

    /**
     * Bootstrap and local-development seeding.
     *
     * <p>Two bootstrap accounts, because there are two levels of authority. {@code superAdminLoginId}
     * is the platform operator, belongs to no township, and is the account that creates townships in
     * the first place. {@code adminLoginId} is the administrator of the {@code DEFAULT} township that
     * {@code V3__multi_tenancy.sql} adopts any pre-multi-tenancy data into -- on a fresh install it
     * is simply the first township, ready to use. Both passwords are blank unless supplied by the
     * environment.
     *
     * <p>{@code seedDemoData} fills that default township out — a block, flats, a gate and one
     * account per role — so a developer or a frontend can be exercised end to end without
     * provisioning five accounts by hand. It is refused outside the local/test profiles by
     * {@code DevDataSeeder}, because accounts sharing a known password are a breach waiting to
     * happen anywhere real.
     */
    public record Bootstrap(
            @NotBlank String superAdminLoginId,
            String superAdminPassword,
            @NotBlank String adminLoginId,
            String adminPassword,
            @NotBlank String defaultTownshipCode,
            boolean seedDemoData,
            String seedPassword) {
    }
}
