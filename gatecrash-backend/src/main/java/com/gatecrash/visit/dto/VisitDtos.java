package com.gatecrash.visit.dto;

import com.gatecrash.visit.ApproverKind;
import com.gatecrash.visit.VisitStatus;
import com.gatecrash.visit.VisitorType;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.time.OffsetDateTime;
import java.util.UUID;

public final class VisitDtos {

    private VisitDtos() {
    }

    public record CreateVisitRequest(
            @NotNull UUID gateId,
            @NotNull VisitorType visitorType,
            @NotBlank @Size(max = 120) String visitorName,
            @Pattern(regexp = "^\\+?[0-9]{7,15}$", message = "must be 7-15 digits, optionally prefixed with +")
            String visitorPhone,
            @Size(max = 20) String vehicleNo,
            /** Gate snapshot. Validated as an https URL on an allowlisted host -- see VisitService. */
            @Size(max = 2048) String photoUrl,
            /** Resident routing. Required unless visitorType is CLIENT. */
            UUID targetFlatId,
            /** Sales routing. Required when visitorType is CLIENT. */
            UUID salesAgentId) {
    }

    /** Only the two outcomes an approver may choose; EXPIRED and the check-in states are not theirs. */
    public enum Decision {
        APPROVED,
        REJECTED
    }

    public record VisitDecisionRequest(@NotNull Decision decision) {
    }

    /**
     * What a visit looks like over the wire.
     *
     * <p>{@code visitorPhone} is included because the guard and the approver both legitimately need
     * it to call the visitor; it is scoped by the same authorization as the rest of the record.
     */
    public record VisitResponse(
            UUID id,
            UUID gateId,
            String gateName,
            String visitorName,
            String visitorPhone,
            VisitorType visitorType,
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
            OffsetDateTime checkedOutAt) {
    }

    /** Admin "who is inside right now". */
    public record OccupancyResponse(long insideCount, java.util.List<VisitResponse> visits) {
    }
}
