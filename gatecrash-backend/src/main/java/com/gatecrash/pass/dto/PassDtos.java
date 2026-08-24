package com.gatecrash.pass.dto;

import com.gatecrash.pass.PassStatus;
import com.gatecrash.visit.VisitorType;
import com.gatecrash.visit.dto.VisitDtos.VisitResponse;
import jakarta.validation.constraints.Future;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.time.OffsetDateTime;
import java.util.UUID;

public final class PassDtos {

    private PassDtos() {
    }

    /**
     * {@code approverKind} is not taken from the client -- the server derives it from the caller's
     * role, because a resident must not be able to mint a pass that presents as a sales approval.
     */
    public record CreatePassRequest(
            @Size(max = 120) String visitorName,
            @Pattern(regexp = "^\\+?[0-9]{7,15}$", message = "must be 7-15 digits, optionally prefixed with +")
            String visitorPhone,
            @NotNull VisitorType visitorType,
            @NotNull @Future OffsetDateTime validUntil,
            @Min(1) @Max(50) int maxUses) {
    }

    /** The PIN appears here once and is never retrievable again. */
    public record CreatePassResponse(
            UUID id,
            String pin,
            UUID qrToken,
            OffsetDateTime validFrom,
            OffsetDateTime validUntil,
            int maxUses) {
    }

    public record PassResponse(
            UUID id,
            String visitorName,
            String visitorPhone,
            VisitorType visitorType,
            PassStatus status,
            String pinLast4,
            UUID qrToken,
            OffsetDateTime validFrom,
            OffsetDateTime validUntil,
            int maxUses,
            int useCount,
            OffsetDateTime createdAt) {
    }

    /**
     * Exactly one of {@code pin} or {@code qrToken} is supplied; the service rejects both-or-neither.
     * Modelled as one request rather than two endpoints so the guard's scanner and keypad share a
     * single throttle bucket.
     */
    public record RedeemPassRequest(
            @Pattern(regexp = "^[0-9]{4,10}$", message = "must be 4-10 digits") String pin,
            UUID qrToken,
            @NotNull UUID gateId) {
    }

    /** Redemption creates a visit already CHECKED_IN -- zero-wait entry. */
    public record RedeemPassResponse(UUID passId, VisitResponse visit, int remainingUses) {
    }
}
