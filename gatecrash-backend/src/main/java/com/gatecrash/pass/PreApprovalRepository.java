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

    /**
     * QR resolution, scoped to the redeeming guard's township.
     *
     * <p>The token is 122 bits of random UUID and globally unique, so an unscoped lookup would find
     * the right row -- and would happily let a pass minted for township A open a gate in township B.
     * The tenant predicate is what makes a leaked QR code worthless outside the community that
     * issued it.
     */
    Optional<PreApproval> findByQrTokenAndTownship_Id(UUID qrToken, UUID townshipId);

    /**
     * PIN candidates, narrowed by the peppered HMAC index.
     *
     * <p>Returns a list rather than an Optional because two passes could in principle share a PIN, and
     * because {@code pin_lookup} is an index, not an authoriser -- the caller still bcrypt-verifies
     * each candidate against {@code pin_hash} before accepting one.
     *
     * <p>Six digits is a small space, and across a whole platform PIN collisions between townships
     * are not rare but expected. Narrowing to the guard's township first is therefore both the
     * security boundary and what keeps the candidate list to the handful the design assumes.
     */
    @Query("""
           select p from PreApproval p
            where p.pinLookup = :pinLookup and p.status = :status and p.township.id = :townshipId
           """)
    List<PreApproval> findByPinLookupAndStatus(@Param("pinLookup") String pinLookup,
                                               @Param("status") PassStatus status,
                                               @Param("townshipId") UUID townshipId);

    default List<PreApproval> findActiveByPinLookup(String pinLookup, UUID townshipId) {
        return findByPinLookupAndStatus(pinLookup, PassStatus.ACTIVE, townshipId);
    }

    /** Serialises redemption so {@code use_count} cannot be incremented twice for one entry. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select p from PreApproval p where p.id = :id and p.township.id = :townshipId")
    Optional<PreApproval> findByIdForUpdate(@Param("id") UUID id,
                                            @Param("townshipId") UUID townshipId);

    /** Creator ids are tenant-unique, so a creator's own pass list cannot cross a boundary. */
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
