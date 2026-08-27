package com.gatecrash.platform.dto;

import com.gatecrash.township.TownshipStatus;
import com.gatecrash.user.dto.UserDtos.CreatedUserResponse;
import com.gatecrash.property.dto.PropertyDtos;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

/**
 * The platform (super admin) surface: townships and the accounts that administer them.
 *
 * <p>Kept apart from {@code TownshipDtos}, which is the <em>inside</em> of a township -- blocks,
 * flats and gates. These are the payloads for acting on a township as a tenant of the platform, and
 * the separation is what stops a township admin's endpoint from ever accidentally accepting a
 * lifecycle field.
 */
public final class PlatformDtos {

    /**
     * A township code is typed at every sign-in, so it is short, unambiguous and case-normalised.
     * Matches the {@code township_code_shape} check constraint after upper-casing.
     */
    public static final String TOWNSHIP_CODE_PATTERN = "^[A-Za-z0-9][A-Za-z0-9-]{1,31}$";

    private PlatformDtos() {
    }

    /**
     * Onboards a township and its first administrator in one call.
     *
     * <p>They are deliberately not two endpoints. A township with no admin is unusable and nobody can
     * fix it from inside -- only a super admin can appoint one -- so allowing that state to exist even
     * briefly is offering a half-built tenant as a valid outcome.
     */
    public record CreateTownshipRequest(
            @NotBlank
            @Pattern(regexp = TOWNSHIP_CODE_PATTERN,
                    message = "must be 2-32 characters of letters, digits or dashes")
            String code,
            @NotBlank @Size(max = 160) String name,
            @Email @Size(max = 200) String contactEmail,
            @Pattern(regexp = com.gatecrash.user.dto.UserDtos.PHONE_PATTERN,
                    message = "must be 7-15 digits, optionally prefixed with +")
            String contactPhone,
            /**
             * The kind of project this developer builds. Seeds the township's property levels, so
             * its admin lands on a structure screen that already says Towers and Flats, or Clusters
             * and Villas, rather than an empty one. Defaults to APARTMENT when omitted.
             */
            com.gatecrash.property.PropertyType propertyType,
            /**
             * An explicit level set, for a developer whose structure does not match any preset --
             * overrides {@code propertyType}'s levels when present, while the type is still recorded
             * for reporting.
             *
             * <p>This is the one moment the structure is easy to get right. The level set cannot be
             * reshaped once the tree holds anything ({@code 409 PROPERTY_TREE_NOT_EMPTY}), because
             * inserting a level under towers that already hold flats has no safe automatic answer to
             * which floor each flat belongs on. Offering it at onboarding is what stops a developer
             * discovering three levels too late that they needed a Phase.
             */
            @Valid @Size(max = 6) List<PropertyDtos.LevelSpec> levels,
            @Valid @NotNull TownshipAdminRequest admin) {
    }

    /** The details of an ADMIN account to provision inside a township. */
    public record TownshipAdminRequest(
            @NotBlank
            @Pattern(regexp = com.gatecrash.user.dto.UserDtos.LOGIN_ID_PATTERN,
                    message = "must be 2-64 characters of letters, digits, dot, dash or underscore")
            String loginId,
            @NotBlank @Size(max = 120) String fullName,
            @Pattern(regexp = com.gatecrash.user.dto.UserDtos.PHONE_PATTERN,
                    message = "must be 7-15 digits, optionally prefixed with +")
            String phone,
            @Email @Size(max = 200) String email) {
    }

    /** Code is absent on purpose: it is part of every resident's credential and never changes. */
    public record UpdateTownshipRequest(
            @Size(max = 160) String name,
            @Email @Size(max = 200) String contactEmail,
            @Pattern(regexp = com.gatecrash.user.dto.UserDtos.PHONE_PATTERN,
                    message = "must be 7-15 digits, optionally prefixed with +")
            String contactPhone) {
    }

    public record TownshipResponse(
            UUID id,
            String code,
            String name,
            TownshipStatus status,
            String contactEmail,
            String contactPhone,
            long activeUserCount,
            long activeAdminCount,
            /** Nodes at the outermost property level -- towers, clusters, phases. */
            long blockCount,
            /** Nodes at the addressable level: the units a resident can live in. */
            long unitCount,
            com.gatecrash.property.PropertyType propertyType,
            long gateCount,
            OffsetDateTime createdAt,
            OffsetDateTime archivedAt) {
    }

    /** The admin's generated password appears here and nowhere else, ever. */
    public record CreatedTownshipResponse(TownshipResponse township, CreatedUserResponse admin) {
    }

    /**
     * Archiving locks out an entire township, so the caller has to type its code back. A confirmation
     * that costs nothing to satisfy accidentally is not a confirmation.
     */
    public record ArchiveTownshipRequest(
            @NotBlank @Size(max = 32) String confirmCode) {
    }

    public record CreateSuperAdminRequest(
            @NotBlank
            @Pattern(regexp = com.gatecrash.user.dto.UserDtos.LOGIN_ID_PATTERN,
                    message = "must be 2-64 characters of letters, digits, dot, dash or underscore")
            String loginId,
            @NotBlank @Size(max = 120) String fullName,
            @Pattern(regexp = com.gatecrash.user.dto.UserDtos.PHONE_PATTERN,
                    message = "must be 7-15 digits, optionally prefixed with +")
            String phone,
            @Email @Size(max = 200) String email) {
    }

    public record SuperAdminResponse(
            UUID id,
            String loginId,
            String fullName,
            String phone,
            String email,
            boolean active,
            boolean mustResetPassword,
            OffsetDateTime createdAt) {
    }
}
