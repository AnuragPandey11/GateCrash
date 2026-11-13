package com.gatecrash.billing;

import com.gatecrash.billing.dto.BillingDtos.DuesSummary;
import com.gatecrash.billing.dto.BillingDtos.InvoiceResponse;
import com.gatecrash.billing.dto.BillingDtos.MarkPaidRequest;
import com.gatecrash.billing.dto.BillingDtos.RecordInvoiceRequest;
import com.gatecrash.common.PageResponse;
import com.gatecrash.common.audit.AuditAction;
import com.gatecrash.common.audit.AuditService;
import com.gatecrash.common.exception.ConflictException;
import com.gatecrash.common.exception.NotFoundException;
import com.gatecrash.common.tenant.TenantContext;
import com.gatecrash.property.PropertyNode;
import com.gatecrash.property.PropertyService;
import com.gatecrash.security.AppUserDetails;
import com.gatecrash.security.SecurityUtils;
import jakarta.persistence.criteria.Predicate;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Bills. For now the office records them -- payments happen outside the app -- and residents see
 * the ones they have paid, with a receipt number. Online collection is the natural next step and
 * slots in as "mark paid" driven by a payment-gateway callback instead of by hand.
 */
@Service
@RequiredArgsConstructor
public class BillingService {

    private static final DateTimeFormatter RECEIPT_DATE = DateTimeFormatter.ofPattern("yyMMdd");
    private static final String RECEIPT_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    private static final SecureRandom RANDOM = new SecureRandom();

    private final InvoiceRepository invoices;
    private final PropertyService property;
    private final AuditService audit;

    @PreAuthorize("hasRole('ADMIN')")
    @Transactional
    public InvoiceResponse record(RecordInvoiceRequest request) {
        UUID townshipId = TenantContext.requireTownshipId();
        // requireUnit resolves inside the tenant and refuses a tower or a floor: bills are per home.
        PropertyNode unit = property.requireUnit(request.unitId());

        Invoice invoice = new Invoice();
        invoice.setTownshipId(townshipId);
        invoice.setUnit(unit);
        invoice.setCategory(request.category());
        invoice.setTitle(request.title().trim());
        invoice.setPeriodLabel(blankToNull(request.periodLabel()));
        invoice.setAmountPaise(request.amountPaise());
        invoice.setDueDate(request.dueDate());
        invoice.setCreatedBy(SecurityUtils.currentUserId());
        if (request.paid()) {
            settle(invoice, request.paidAt(), request.paymentMethod(), request.paymentReference());
        }
        invoices.save(invoice);
        audit.record(AuditAction.INVOICE_RECORDED, "invoice", invoice.getId(),
                AuditService.detail("unitId", unit.getId(), "amountPaise", invoice.getAmountPaise(),
                        "paid", request.paid()));
        return toResponse(invoice);
    }

    @PreAuthorize("hasRole('ADMIN')")
    @Transactional
    public InvoiceResponse markPaid(UUID invoiceId, MarkPaidRequest request) {
        Invoice invoice = invoices.findByIdAndTownshipId(invoiceId, TenantContext.requireTownshipId())
                .orElseThrow(() -> NotFoundException.of("Invoice", invoiceId));
        if (invoice.getStatus() == InvoiceStatus.PAID) {
            throw new ConflictException("ALREADY_PAID", "This bill is already paid.");
        }
        settle(invoice, request.paidAt(), request.paymentMethod(), request.paymentReference());
        invoices.save(invoice);
        audit.record(AuditAction.INVOICE_MARKED_PAID, "invoice", invoiceId, null);
        return toResponse(invoice);
    }

    @PreAuthorize("hasRole('ADMIN')")
    @Transactional(readOnly = true)
    public PageResponse<InvoiceResponse> list(UUID unitId, InvoiceStatus status, Pageable pageable) {
        UUID townshipId = TenantContext.requireTownshipId();
        Specification<Invoice> spec = (root, query, cb) -> {
            List<Predicate> predicates = new ArrayList<>();
            predicates.add(cb.equal(root.get("townshipId"), townshipId));
            if (unitId != null) {
                predicates.add(cb.equal(root.get("unit").get("id"), unitId));
            }
            if (status != null) {
                predicates.add(cb.equal(root.get("status"), status));
            }
            query.orderBy(cb.desc(root.get("createdAt")));
            return cb.and(predicates.toArray(new Predicate[0]));
        };
        return PageResponse.of(invoices.findAll(spec, pageable), this::toResponse);
    }

    /** The resident's bills tab: paid bills of their own unit, latest payment first. */
    @PreAuthorize("hasRole('RESIDENT')")
    @Transactional(readOnly = true)
    public PageResponse<InvoiceResponse> myPaid(Pageable pageable) {
        AppUserDetails caller = SecurityUtils.currentUser();
        if (caller.getFlatId() == null) {
            return PageResponse.of(Page.<Invoice>empty(pageable), this::toResponse);
        }
        return PageResponse.of(invoices.findByTownshipIdAndUnit_IdAndStatusOrderByPaidAtDesc(
                TenantContext.requireTownshipId(), caller.getFlatId(), InvoiceStatus.PAID, pageable),
                this::toResponse);
    }

    /** Unpaid bills on a unit. Callers resolve the unit within the tenant first. */
    @Transactional(readOnly = true)
    public DuesSummary duesFor(UUID unitId) {
        return new DuesSummary(invoices.countByUnit_IdAndStatus(unitId, InvoiceStatus.UNPAID),
                invoices.sumAmountByUnitAndStatus(unitId, InvoiceStatus.UNPAID));
    }

    private void settle(Invoice invoice, OffsetDateTime paidAt, String method, String reference) {
        OffsetDateTime when = paidAt == null ? OffsetDateTime.now() : paidAt;
        invoice.setStatus(InvoiceStatus.PAID);
        invoice.setPaidAt(when);
        invoice.setPaymentMethod(blankToNull(method));
        invoice.setPaymentReference(blankToNull(reference));
        invoice.setReceiptNo(newReceiptNo(invoice.getTownshipId(), when));
    }

    /** {@code R-261113-7KQ4M}: dated, short enough to read out, unique per township. */
    private String newReceiptNo(UUID townshipId, OffsetDateTime when) {
        for (int attempt = 0; attempt < 5; attempt++) {
            StringBuilder suffix = new StringBuilder();
            for (int i = 0; i < 5; i++) {
                suffix.append(RECEIPT_ALPHABET.charAt(RANDOM.nextInt(RECEIPT_ALPHABET.length())));
            }
            String receipt = "R-" + RECEIPT_DATE.format(when) + "-" + suffix;
            if (!invoices.existsByTownshipIdAndReceiptNo(townshipId, receipt)) {
                return receipt;
            }
        }
        throw new ConflictException("RECEIPT_COLLISION", "Could not issue a receipt number. Retry.");
    }

    private InvoiceResponse toResponse(Invoice i) {
        return new InvoiceResponse(i.getId(), i.getUnit().getId(), i.getUnit().getCode(), i.getCategory(),
                i.getTitle(), i.getPeriodLabel(), i.getAmountPaise(), i.getDueDate(), i.getStatus(),
                i.getPaidAt(), i.getPaymentMethod(), i.getPaymentReference(), i.getReceiptNo(),
                i.getCreatedAt());
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
