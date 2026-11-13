package com.gatecrash.amenity.dto;

import com.gatecrash.amenity.BookingStatus;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

public final class AmenityDtos {

    private AmenityDtos() {
    }

    /** Create or replace an amenity's definition (the office's form). */
    public record AmenityRequest(
            @NotBlank @Size(max = 80) String name,
            @Size(max = 1000) String description,
            @NotNull @Min(1) @Max(500) Integer capacity,
            @NotNull LocalTime openTime,
            @NotNull LocalTime closeTime,
            @NotNull @Min(15) @Max(480) Integer slotMinutes,
            @NotNull @Min(1) @Max(12) Integer maxSlotsPerBooking,
            Boolean active) {
    }

    public record AmenityResponse(
            UUID id,
            String name,
            String description,
            int capacity,
            LocalTime openTime,
            LocalTime closeTime,
            int slotMinutes,
            int maxSlotsPerBooking,
            boolean active) {
    }

    /** One slot of one day: how full it is, and whether the caller already holds it. */
    public record SlotResponse(
            LocalTime startTime,
            LocalTime endTime,
            OffsetDateTime startsAt,
            OffsetDateTime endsAt,
            int booked,
            int capacity,
            boolean available,
            boolean mine,
            boolean past) {
    }

    public record AvailabilityResponse(UUID amenityId, LocalDate date, List<SlotResponse> slots) {
    }

    /** A resident books {@code slots} consecutive slots starting at {@code startTime} on {@code date}. */
    public record BookRequest(
            @NotNull UUID amenityId,
            @NotNull LocalDate date,
            @NotNull LocalTime startTime,
            @NotNull @Min(1) @Max(12) Integer slots,
            @Min(1) @Max(50) Integer guests,
            @Size(max = 300) String note) {
    }

    public record CancelRequest(@Size(max = 300) String reason) {
    }

    public record BookingResponse(
            UUID id,
            UUID amenityId,
            String amenityName,
            String bookedByName,
            String unitCode,
            OffsetDateTime startsAt,
            OffsetDateTime endsAt,
            int guests,
            String note,
            BookingStatus status,
            String cancelReason,
            OffsetDateTime createdAt) {
    }
}
