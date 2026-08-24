package com.gatecrash.pass;

import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * <b>Enum handling:</b> statuses are always bound as query parameters, never written as inline HQL
 * enum literals. Against a native Postgres enum column, Hibernate renders an inline literal as
 * {@code 'ACTIVE'::PassStatus} -- the <em>Java</em> type name -- and Postgres has no such type, so the
 * statement fails at runtime. Bound parameters are cast correctly. The default methods keep call
 * sites readable without reintroducing literals.
 */
public interface PreApprovalRepository extends JpaRepository<PreApproval, UUID> {

    Optional<PreApproval> findByQrToken(UUID qrToken);

    /**
     * PIN candidates, narrowed by the peppered HMAC index.
     *
     * <p>Returns a list rather than an Optional because two passes could in principle share a PIN, and
     * because {@code pin_lookup} is an index, not an authoriser -- the caller still bcrypt-verifies
     * each candidate against {@code pin_hash} before accepting one.
     */
    @Query("select p from PreApproval p where p.pinLookup = :pinLookup and p.status = :status")
    List<PreApproval> findByPinLookupAndStatus(@Param("pinLookup") String pinLookup,
                                               @Param("status") PassStatus status);

    default List<PreApproval> findActiveByPinLookup(String pinLookup) {
        return findByPinLookupAndStatus(pinLookup, PassStatus.ACTIVE);
    }

    /** Serialises redemption so {@code use_count} cannot be incremented twice for one entry. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select p from PreApproval p where p.id = :id")
    Optional<PreApproval> findByIdForUpdate(@Param("id") UUID id);

    Page<PreApproval> findByCreatedBy_IdOrderByCreatedAtDesc(UUID creatorId, Pageable pageable);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("""
           update PreApproval p
              set p.status = :expired
            where p.status = :active
              and p.validUntil < :now
           """)
    int markExpired(@Param("now") OffsetDateTime now,
                    @Param("active") PassStatus active,
                    @Param("expired") PassStatus expired);

    /** Lapsed passes: {@code ACTIVE} rows whose window has closed. */
    default int markExpired(OffsetDateTime now) {
        return markExpired(now, PassStatus.ACTIVE, PassStatus.EXPIRED);
    }
}
