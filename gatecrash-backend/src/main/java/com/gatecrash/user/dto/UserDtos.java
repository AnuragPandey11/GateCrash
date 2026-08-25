package com.gatecrash.user.dto;

import com.gatecrash.user.UserRole;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * Account provisioning and management payloads.
 *
 * <p>Free-text fields are bounded and, where the value ends up in a URL, an index or a login form,
 * constrained by pattern as well. That is what keeps an unexpected shape from reaching the database
 * in the first place, rather than relying on the constraint to reject it later.
 */
public final class UserDtos {

    /** Login ids appear in URLs and logs; restrict them to an unambiguous, printable subset. */
    public static final String LOGIN_ID_PATTERN = "^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$";
    public static final String PHONE_PATTERN = "^\\+?[0-9]{7,15}$";

    private UserDtos() {
    }

    public record CreateUserRequest(
            @NotNull UserRole role,
            /** Required for RESIDENT; the login id is derived from the flat number. */
            UUID flatId,
            /** Required for SALES/GUARD/ADMIN; ignored for RESIDENT. */
            @Pattern(regexp = LOGIN_ID_PATTERN, message = "must be 2-64 characters of letters, digits, dot, dash or underscore")
            String loginId,
            @NotBlank @Size(max = 120) String fullName,
            @Pattern(regexp = PHONE_PATTERN, message = "must be 7-15 digits, optionally prefixed with +")
            String phone,
            @Email @Size(max = 200) String email) {
    }

    /**
     * The generated password appears here and nowhere else, ever.
     *
     * <p>{@code townshipId} is echoed back because {@code loginId} alone no longer identifies the
     * account -- the credential handed to the user is the pair, and the client needs both to print a
     * usable sign-in card.
     */
    public record CreatedUserResponse(UUID id, String loginId, String fullName, UserRole role,
                                      UUID townshipId, String generatedPassword) {
    }

    public record UpdateUserRequest(
            @Size(max = 120) String fullName,
            @Pattern(regexp = PHONE_PATTERN, message = "must be 7-15 digits, optionally prefixed with +")
            String phone,
            @Email @Size(max = 200) String email) {
    }

    public record UserResponse(
            UUID id,
            String loginId,
            UUID townshipId,
            String fullName,
            UserRole role,
            String phone,
            String email,
            boolean active,
            boolean mustResetPassword,
            boolean onDuty,
            UUID flatId,
            String flatNumber,
            String blockName,
            OffsetDateTime createdAt) {
    }

    public record ResetPasswordResponse(UUID id, String loginId, String generatedPassword) {
    }

    public record DutyRequest(@NotNull Boolean onDuty) {
    }

    /** Trimmed projection for the guard's on-duty dropdown -- no contact details leak to the gate. */
    public record SalesAgentResponse(UUID id, String fullName, String loginId) {
    }
}
