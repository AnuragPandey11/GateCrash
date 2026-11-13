package com.gatecrash.helpdesk.dto;

import com.gatecrash.helpdesk.TicketCategory;
import com.gatecrash.helpdesk.TicketStatus;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

public final class HelpdeskDtos {

    private HelpdeskDtos() {
    }

    public record RaiseTicketRequest(
            @NotNull TicketCategory category,
            @NotBlank @Size(max = 160) String subject,
            @NotBlank @Size(max = 4000) String description) {
    }

    public record ReplyRequest(@NotBlank @Size(max = 4000) String body) {
    }

    /** The office moves a ticket along. OPEN is the resident's to restore, via reopen. */
    public record StatusRequest(@NotNull TicketStatus status) {
    }

    public record TicketSummary(
            UUID id,
            TicketCategory category,
            String subject,
            TicketStatus status,
            String unitCode,
            String raisedByName,
            int replies,
            OffsetDateTime createdAt,
            OffsetDateTime updatedAt) {
    }

    public record MessageResponse(UUID id, String authorName, boolean fromStaff, String body,
                                  OffsetDateTime createdAt) {
    }

    public record TicketDetail(
            UUID id,
            TicketCategory category,
            String subject,
            String description,
            TicketStatus status,
            String unitCode,
            String raisedByName,
            OffsetDateTime resolvedAt,
            OffsetDateTime createdAt,
            OffsetDateTime updatedAt,
            List<MessageResponse> messages) {
    }
}
