package com.gatecrash.billing;

import com.gatecrash.billing.dto.BillingDtos.InvoiceResponse;
import com.gatecrash.billing.dto.BillingDtos.MarkPaidRequest;
import com.gatecrash.billing.dto.BillingDtos.RecordInvoiceRequest;
import com.gatecrash.common.PageResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
@RequiredArgsConstructor
@Tag(name = "Bills")
public class BillingController {

    private final BillingService billing;

    @GetMapping("/api/v1/invoices/mine")
    @Operation(summary = "The resident's paid bills, latest first")
    public PageResponse<InvoiceResponse> mine(@PageableDefault(size = 20) Pageable pageable) {
        return billing.myPaid(pageable);
    }

    @PostMapping("/api/v1/admin/invoices")
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Office records a bill for a unit, optionally already paid")
    public InvoiceResponse record(@Valid @RequestBody RecordInvoiceRequest request) {
        return billing.record(request);
    }

    @GetMapping("/api/v1/admin/invoices")
    @Operation(summary = "Bills in the township, filterable by unit and status")
    public PageResponse<InvoiceResponse> list(@RequestParam(required = false) UUID unitId,
                                              @RequestParam(required = false) InvoiceStatus status,
                                              @PageableDefault(size = 25) Pageable pageable) {
        return billing.list(unitId, status, pageable);
    }

    @PostMapping("/api/v1/admin/invoices/{id}/mark-paid")
    @Operation(summary = "Office records payment of an unpaid bill")
    public InvoiceResponse markPaid(@PathVariable UUID id, @Valid @RequestBody MarkPaidRequest request) {
        return billing.markPaid(id, request);
    }
}
