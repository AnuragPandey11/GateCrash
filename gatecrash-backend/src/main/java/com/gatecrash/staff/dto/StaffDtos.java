package com.gatecrash.staff.dto;

import com.gatecrash.staff.StaffCategory;
import com.gatecrash.staff.StaffScope;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

public final class StaffDtos {

    private static final String PHONE = "^\\+?[0-9]{7,15}$";
    private static final String PHONE_MESSAGE = "must be 7-15 digits, optionally prefixed with +";

    private StaffDtos() {
    }

    /** A resident registers a new daily helper for their home. The phone is how duplicates are caught. */
    public record RegisterHelpRequest(
            @NotNull StaffCategory category,
            @NotBlank @Size(max = 120) String fullName,
            @NotBlank @Pattern(regexp = PHONE, message = PHONE_MESSAGE) String phone) {
    }

    /** The office adds anyone, of either scope. */
    public record CreateStaffRequest(
            @NotNull StaffScope scope,
            @NotNull StaffCategory category,
            @NotBlank @Size(max = 120) String fullName,
            @Pattern(regexp = PHONE, message = PHONE_MESSAGE) String phone) {
    }

    /** A resident adds a helper already registered in the society, by the helper's entry code. */
    public record LinkHelpRequest(@NotNull @Pattern(regexp = "^[0-9]{6}$") String code) {
    }

    public record RateRequest(@NotNull @Min(1) @Max(5) Integer rating, @Size(max = 1000) String review) {
    }

    public record SetActiveRequest(@NotNull Boolean active) {
    }

    /** Exactly one of the two: the typed entry code, or the token read off the ID-card QR. */
    public record GateLookupRequest(@Pattern(regexp = "^[0-9]{6}$") String code, UUID qrToken) {
    }

    public record GateMoveRequest(@NotNull UUID gateId) {
    }

    /**
     * A staff member as one audience sees them; fields an audience may not see are null and so
     * omitted on the wire. The office sees everything; a household sees the ID-card token and its
     * own rating but not which other homes the helper works in; the gate sees the homes (that is
     * where the helper is going) but never the token.
     */
    public record StaffResponse(
            UUID id,
            StaffScope scope,
            StaffCategory category,
            String fullName,
            String phone,
            boolean active,
            UUID qrToken,
            List<String> householdUnits,
            int householdCount,
            Double averageRating,
            long ratingCount,
            Integer myRating,
            String myReview,
            boolean insideNow,
            OffsetDateTime insideSince,
            OffsetDateTime lastSeenAt,
            OffsetDateTime createdAt) {
    }

    /** {@code code} is the only time the plaintext entry code leaves the server. */
    public record StaffCreatedResponse(StaffResponse staff, String code) {
    }

    public record AttendanceResponse(
            UUID id,
            UUID staffId,
            String staffName,
            StaffCategory category,
            StaffScope scope,
            String gateName,
            String exitGateName,
            OffsetDateTime checkedInAt,
            OffsetDateTime checkedOutAt) {
    }
}
