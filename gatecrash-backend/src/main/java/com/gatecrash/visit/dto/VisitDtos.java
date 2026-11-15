package com.gatecrash.visit.dto;

import com.gatecrash.visit.ApproverKind;
import com.gatecrash.visit.VisitStatus;
import com.gatecrash.visit.VisitorType;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.time.OffsetDateTime;
import java.util.UUID;

public final class VisitDtos {

    /** Bounds on a visit's expected duration: five minutes to a week (visit_duration_range). */
    public static final int MIN_DURATION_MINUTES = 5;
    public static final int MAX_DURATION_MINUTES = 10_080;

    private VisitDtos() {
    }

    /**
     * A walk-in, as the guard logs it. Name, type and destination are required; everything else is
     * optional at the gate -- including the expected duration, which the resident can supply when
     * they approve instead.
     */
    public record CreateVisitRequest(
            @NotNull UUID gateId,
            @NotNull VisitorType visitorType,
            @NotBlank @Size(max = 120) String visitorName,
            @Pattern(regexp = "^\\+?[0-9]{7,15}$", message = "must be 7-15 digits, optionally prefixed with +")
            String visitorPhone,
            @Size(max = 20) String vehicleNo,
            /** Gate snapshot. Validated as an https URL on an allowlisted host -- see VisitService. */
            @Size(max = 2048) String photoUrl,
            /** Resident routing. Required unless meetSalesAgent is ticked. */
            UUID targetFlatId,
            /**
             * The "Meet Sales Agent" tick-box. When true the visit is routed to the on-duty sales
             * agent named in {@code salesAgentId} instead of to a unit.
             */
            Boolean meetSalesAgent,
            /** Sales routing. Required when meetSalesAgent is true. */
            UUID salesAgentId,
            @Size(max = 200) String purpose,
            @Min(MIN_DURATION_MINUTES) @Max(MAX_DURATION_MINUTES) Integer expectedDurationMinutes) {

        /** Absent means unticked: an existing guard client that predates the tick-box keeps working. */
        public boolean isMeetSalesAgent() {
            return Boolean.TRUE.equals(meetSalesAgent);
        }
    }

    /** What an approver may choose; EXPIRED and the check-in states are not theirs. */
    public enum Decision {
        APPROVED,
        REJECTED,
        /** Deliveries only: the courier stays out, security keeps the parcel for collection. */
        LEAVE_AT_GATE
    }

    /**
     * The approve/deny/leave tap. On APPROVED the resident may also say how long the visitor will
     * stay, if the guard did not.
     */
    public record VisitDecisionRequest(
            @NotNull Decision decision,
            @Min(MIN_DURATION_MINUTES) @Max(MAX_DURATION_MINUTES) Integer expectedDurationMinutes) {
    }

    /** The host extends a stay -- clears the overstay alert and tells the gate. */
    public record ExtendStayRequest(@NotNull @Min(5) @Max(1440) Integer extendMinutes) {
    }

    /** Check-out: the gate the guard is standing at, which may not be the one the visitor entered by. */
    public record CheckOutRequest(UUID gateId) {
    }

    /** The guard types the code the resident shows them. */
    public record CollectParcelRequest(@NotNull @Pattern(regexp = "^[0-9]{6}$") String code) {
    }

    /** A fresh collection code -- shown to the resident, never stored in plaintext. */
    public record CollectionCodeResponse(UUID visitId, String code) {
    }

    /**
     * What a visit looks like over the wire.
     *
     * <p>{@code visitorPhone} is included because the guard and the approver both legitimately need
     * it to call the visitor; it is scoped by the same authorization as the rest of the record.
     * {@code collectionCode} is present only on the response to a Leave-at-Gate decision -- the one
     * moment the plaintext exists.
     */
    public record VisitResponse(
            UUID id,
            UUID gateId,
            String gateName,
            String visitorName,
            String visitorPhone,
            VisitorType visitorType,
            boolean meetSalesAgent,
            String vehicleNo,
            String photoUrl,
            VisitStatus status,
            ApproverKind approverKind,
            UUID approverId,
            String approverName,
            UUID targetFlatId,
            String targetFlatNumber,
            UUID preApprovalId,
            String loggedByName,
            OffsetDateTime createdAt,
            OffsetDateTime decidedAt,
            OffsetDateTime checkedInAt,
            OffsetDateTime checkedOutAt,
            String purpose,
            Integer expectedDurationMinutes,
            OffsetDateTime expectedOutAt,
            boolean overstaying,
            OffsetDateTime collectedAt,
            String collectionCode,
            /** Let in by one of the home's society rules rather than by a resident's tap. */
            boolean autoApproved,
            /** The gate they left by, once checked out; {@code gateId} is the gate they entered at. */
            UUID exitGateId,
            String exitGateName) {
    }

    /** Admin "who is inside right now". */
    public record OccupancyResponse(long insideCount, java.util.List<VisitResponse> visits) {
    }
}
