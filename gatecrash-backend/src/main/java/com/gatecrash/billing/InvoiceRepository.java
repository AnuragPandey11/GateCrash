package com.gatecrash.billing;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;
import java.util.UUID;

public interface InvoiceRepository extends JpaRepository<Invoice, UUID>, JpaSpecificationExecutor<Invoice> {

    Optional<Invoice> findByIdAndTownshipId(UUID id, UUID townshipId);

    Page<Invoice> findByTownshipIdAndUnit_IdAndStatusOrderByPaidAtDesc(UUID townshipId, UUID unitId,
                                                                      InvoiceStatus status, Pageable pageable);

    boolean existsByTownshipIdAndReceiptNo(UUID townshipId, String receiptNo);

    long countByUnit_IdAndStatus(UUID unitId, InvoiceStatus status);

    @Query("select coalesce(sum(i.amountPaise), 0) from Invoice i where i.unit.id = :unitId and i.status = :status")
    long sumAmountByUnitAndStatus(@Param("unitId") UUID unitId, @Param("status") InvoiceStatus status);
}
