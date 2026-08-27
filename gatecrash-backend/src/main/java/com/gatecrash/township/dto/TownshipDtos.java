package com.gatecrash.township.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.time.OffsetDateTime;
import java.util.UUID;

public final class TownshipDtos {

    private TownshipDtos() {
    }

    public record CreateGateRequest(@NotBlank @Size(max = 80) String name) {
    }

    public record GateResponse(UUID id, String name, OffsetDateTime createdAt) {
    }
}
