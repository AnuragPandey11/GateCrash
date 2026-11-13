package com.gatecrash.pass.dto;

import com.gatecrash.pass.PassStatus;
import com.gatecrash.pass.PassType;
import com.gatecrash.visit.VisitorType;
import com.gatecrash.visit.dto.VisitDtos.VisitResponse;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.time.OffsetDateTime;
import java.util.UUID;

public final class PassDtos {

    public static final String PHONE_PATTERN = "^\\+?[0-9]{7,15}$";

    private PassDtos() {
    }

    /**
     * A resident (or sales agent) pre-approving a visitor. It asks for the same details the guard's
     * walk-in form does, and is stricter about two of them: the visitor's phone is required (the
     * guard may need to call them), and so is when they leave -- that is what the overstay alert
     * measures, and a pass with no end is a permanent key.
     *
     * <p>{@code validFrom}/{@code validUntil} mean:
     * <ul>
     *   <li>ONE_TIME -- expected arrival / out time. The QR is accepted from an hour before the
     *       arrival until the out time.</li>
     *   <li>FREQUENT -- first / last day of the range. The QR is accepted any time in between, and
     *       {@code expectedDurationMinutes} (required) sets each visit's exit time.</li>
     * </ul>
     *
     * <p>{@code approverKind} is not taken from the client -- the server derives it from the caller,
     * because a resident must not be able to mint a pass that presents as a sales approval.
     */
    public record CreatePassRequest(
            PassType passType,
            @NotBlank @Size(max = 120) String visitorName,
            @NotBlank @Pattern(regexp = PHONE_PATTERN, message = "must be 7-15 digits, optionally prefixed with +")
            String visitorPhone,
            @NotNull VisitorType visitorType,
            @Size(max = 200) String purpose,
            @Size(max = 20) String vehicleNo,
            OffsetDateTime validFrom,
            @NotNull OffsetDateTime validUntil,
            @Min(5) @Max(1440) Integer expectedDurationMinutes,
            @Min(1) @Max(50) Integer maxUses) {
    }

    /** The PIN appears here once and is never retrievable again. */
    public record CreatePassResponse(
            UUID id,
            PassType passType,
            String pin,
            UUID qrToken,
            OffsetDateTime validFrom,
            OffsetDateTime validUntil,
            Integer maxUses) {
    }

    public record PassResponse(
            UUID id,
            PassType passType,
            String visitorName,
            String visitorPhone,
            VisitorType visitorType,
            String purpose,
            String vehicleNo,
            PassStatus status,
            String pinLast4,
            UUID qrToken,
            OffsetDateTime expectedArrivalAt,
            OffsetDateTime validFrom,
            OffsetDateTime validUntil,
            Integer expectedDurationMinutes,
            Integer maxUses,
            int useCount,
            OffsetDateTime createdAt) {
    }

    /** What the guard's scanner or keypad sends to look a pass up -- exactly one of pin or qrToken. */
    public record LookupPassRequest(
            @Pattern(regexp = "^[0-9]{4,10}$", message = "must be 4-10 digits") String pin,
            UUID qrToken,
            @NotNull UUID gateId) {
    }

    /**
     * The pre-filled form the guard sees after a scan, before anything is consumed. {@code problem}
     * is null when the pass can be used now, otherwise one word the console turns into a message.
     */
    public record PassPreviewResponse(
            UUID passId,
            PassType passType,
            String visitorName,
            String visitorPhone,
            VisitorType visitorType,
            String purpose,
            String vehicleNo,
            String hostName,
            String hostUnitCode,
            boolean meetSalesAgent,
            OffsetDateTime expectedArrivalAt,
            OffsetDateTime validFrom,
            OffsetDateTime validUntil,
            Integer expectedDurationMinutes,
            Integer maxUses,
            int useCount,
            boolean redeemable,
            String problem) {
    }

    /**
     * Exactly one of {@code pin} or {@code qrToken} is supplied; the service rejects both-or-neither.
     * Modelled as one request rather than two endpoints so the guard's scanner and keypad share a
     * single throttle bucket.
     *
     * <p>The remaining fields are the guard's corrections to the pre-filled form -- the vehicle the
     * visitor actually arrived in, a phone number that changed. Absent means "as on the pass".
     */
    public record RedeemPassRequest(
            @Pattern(regexp = "^[0-9]{4,10}$", message = "must be 4-10 digits") String pin,
            UUID qrToken,
            @NotNull UUID gateId,
            @Size(max = 120) String visitorName,
            @Pattern(regexp = PHONE_PATTERN, message = "must be 7-15 digits, optionally prefixed with +")
            String visitorPhone,
            @Size(max = 20) String vehicleNo,
            @Size(max = 200) String purpose,
            @Min(5) @Max(1440) Integer expectedDurationMinutes) {
    }

    /** Redemption creates a visit already CHECKED_IN -- zero-wait entry. Null remaining = unlimited. */
    public record RedeemPassResponse(UUID passId, VisitResponse visit, Integer remainingUses) {
    }
}
