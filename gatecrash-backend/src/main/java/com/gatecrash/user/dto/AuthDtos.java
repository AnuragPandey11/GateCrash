package com.gatecrash.user.dto;

import com.gatecrash.user.UserRole;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.util.UUID;

/**
 * Authentication payloads.
 *
 * <p>Request records carry length bounds as well as presence checks: an unbounded {@code @NotBlank}
 * string is an invitation to send a 10 MB password and make the server spend CPU bcrypting it.
 */
public final class AuthDtos {

    private AuthDtos() {
    }

    /**
     * Login is {@code (townshipCode, loginId, password)}.
     *
     * <p>{@code townshipCode} identifies the namespace the login id lives in, because login ids are
     * only unique within a township -- every township with a block A has an {@code A-101-1}. It is
     * optional for exactly one reason: a {@code SUPER_ADMIN} belongs to no township, so it signs in
     * with the code omitted.
     */
    public record LoginRequest(
            @Size(max = 32) String townshipCode,
            @NotBlank @Size(max = 64) String loginId,
            @NotBlank @Size(max = 128) String password) {
    }

    public record LoginResponse(
            String accessToken,
            String refreshToken,
            String tokenType,
            long expiresInSeconds,
            boolean mustResetPassword,
            UserRole role,
            boolean sales,
            UUID userId,
            String fullName,
            /** Null for a SUPER_ADMIN; the tenant every other session is bound to. */
            UUID townshipId,
            String townshipCode,
            String townshipName) {
    }

    public record RefreshRequest(@NotBlank @Size(max = 512) String refreshToken) {
    }

    public record ChangePasswordRequest(
            @NotBlank @Size(max = 128) String currentPassword,
            @NotBlank @Size(min = 10, max = 128) String newPassword) {
    }

    public record LogoutRequest(@Size(max = 512) String refreshToken) {
    }

    /** {@code GET /auth/me} -- lets a client rehydrate its session without decoding the JWT itself. */
    public record MeResponse(
            UUID id,
            String loginId,
            String fullName,
            UserRole role,
            boolean sales,
            boolean mustResetPassword,
            boolean onDuty,
            UUID flatId,
            String flatNumber,
            String blockName,
            UUID townshipId,
            String townshipCode,
            String townshipName) {
    }
}
