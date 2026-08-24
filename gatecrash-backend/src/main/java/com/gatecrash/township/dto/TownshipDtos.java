package com.gatecrash.township.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.time.OffsetDateTime;
import java.util.UUID;

public final class TownshipDtos {

    private TownshipDtos() {
    }

    public record CreateBlockRequest(@NotBlank @Size(max = 80) String name) {
    }

    public record BlockResponse(UUID id, String name, long flatCount, OffsetDateTime createdAt) {
    }

    public record CreateFlatRequest(
            @NotNull UUID blockId,
            @NotBlank @Size(max = 40) String number) {
    }

    public record FlatResponse(UUID id, String number, UUID blockId, String blockName,
                               OffsetDateTime createdAt) {
    }

    public record CreateGateRequest(@NotBlank @Size(max = 80) String name) {
    }

    public record GateResponse(UUID id, String name, OffsetDateTime createdAt) {
    }
}
