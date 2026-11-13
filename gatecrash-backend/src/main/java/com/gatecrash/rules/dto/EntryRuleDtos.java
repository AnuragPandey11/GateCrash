package com.gatecrash.rules.dto;

import com.gatecrash.rules.EntryRuleStatus;
import com.gatecrash.visit.VisitorType;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.util.UUID;

public final class EntryRuleDtos {

    private EntryRuleDtos() {
    }

    /**
     * A resident's request. {@code matchText} narrows the rule to one company or person ("Amazon",
     * "Ramesh electrician"); {@code visitorPhone} to one number. A delivery rule may leave both out
     * ("all deliveries"); a guest or technician rule may not — "let any guest in" is no rule at all.
     */
    public record CreateRuleRequest(
            @NotNull VisitorType visitorType,
            @NotBlank @Size(max = 80) String label,
            @Size(min = 2, max = 60) String matchText,
            @Pattern(regexp = "^\\+?[0-9]{7,15}$", message = "must be 7-15 digits, optionally prefixed with +")
            String visitorPhone,
            LocalTime allowedFrom,
            LocalTime allowedTo,
            OffsetDateTime validUntil,
            @Size(max = 300) String note) {
    }

    public enum RuleDecision {
        APPROVED,
        REJECTED
    }

    public record DecideRuleRequest(@NotNull RuleDecision decision, @Size(max = 300) String note) {
    }

    public record RevokeRuleRequest(@Size(max = 300) String note) {
    }

    public record RuleResponse(
            UUID id,
            String unitCode,
            String requestedByName,
            VisitorType visitorType,
            String label,
            String matchText,
            String visitorPhone,
            LocalTime allowedFrom,
            LocalTime allowedTo,
            OffsetDateTime validUntil,
            String note,
            EntryRuleStatus status,
            String adminNote,
            String decidedByName,
            OffsetDateTime decidedAt,
            OffsetDateTime createdAt) {
    }
}
