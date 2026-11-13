package com.gatecrash.move.dto;

import com.gatecrash.move.MoveStatus;
import com.gatecrash.move.MoveType;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.util.UUID;

public final class MoveDtos {

    private MoveDtos() {
    }

    public record CreateMoveRequest(
            @NotNull MoveType moveType,
            @NotNull LocalDate moveDate,
            @NotNull LocalTime timeFrom,
            @NotNull LocalTime timeTo,
            @Size(max = 200) String vehicleDetails,
            @Min(0) @Max(50) Integer helpersCount,
            @Size(max = 1000) String notes) {
    }

    public enum MoveDecision {
        APPROVED,
        REJECTED
    }

    public record DecideMoveRequest(@NotNull MoveDecision decision, @Size(max = 500) String note) {
    }

    /**
     * Marking a move done. For a move-out, {@code deactivateResidents} also switches off every
     * resident account on the unit -- the household has left, so their gate approvals must stop.
     */
    public record CompleteMoveRequest(boolean deactivateResidents) {
    }

    public record MoveResponse(
            UUID id,
            UUID unitId,
            String unitCode,
            String requestedByName,
            MoveType moveType,
            LocalDate moveDate,
            LocalTime timeFrom,
            LocalTime timeTo,
            String vehicleDetails,
            Integer helpersCount,
            String notes,
            MoveStatus status,
            String adminNote,
            String decidedByName,
            OffsetDateTime decidedAt,
            OffsetDateTime completedAt,
            OffsetDateTime createdAt,
            /** Office view only: what the unit still owes, so a move-out is not approved blind. */
            Long unpaidCount,
            Long unpaidAmountPaise) {
    }
}
