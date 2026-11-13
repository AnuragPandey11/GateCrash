package com.gatecrash.billing.dto;

import com.gatecrash.billing.InvoiceCategory;
import com.gatecrash.billing.InvoiceStatus;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.UUID;

public final class BillingDtos {

    private BillingDtos() {
    }

    /**
     * The office records a bill for a unit. {@code paid} records an already-settled bill in one step
     * (the common case while payments happen outside the app); a receipt number is issued for it.
     */
    public record RecordInvoiceRequest(
            @NotNull UUID unitId,
            @NotNull InvoiceCategory category,
            @NotBlank @Size(max = 120) String title,
            @Size(max = 40) String periodLabel,
            /** In paise. One rupee = 100. Capped at one crore rupees. */
            @NotNull @Min(1) @Max(1_000_000_000L) Long amountPaise,
            LocalDate dueDate,
            boolean paid,
            OffsetDateTime paidAt,
            @Size(max = 40) String paymentMethod,
            @Size(max = 80) String paymentReference) {
    }

    public record MarkPaidRequest(
            OffsetDateTime paidAt,
            @Size(max = 40) String paymentMethod,
            @Size(max = 80) String paymentReference) {
    }

    public record InvoiceResponse(
            UUID id,
            UUID unitId,
            String unitCode,
            InvoiceCategory category,
            String title,
            String periodLabel,
            long amountPaise,
            LocalDate dueDate,
            InvoiceStatus status,
            OffsetDateTime paidAt,
            String paymentMethod,
            String paymentReference,
            String receiptNo,
            OffsetDateTime createdAt) {
    }

    /** Outstanding dues on a unit -- shown to the office when it decides a move-out. */
    public record DuesSummary(long unpaidCount, long unpaidAmountPaise) {
    }
}
