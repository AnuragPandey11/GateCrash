package com.gatecrash.visit;

import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface VisitorLogRepository extends JpaRepository<VisitorLog, UUID>,
        JpaSpecificationExecutor<VisitorLog> {

    /**
     * Locks the row for the duration of a state transition.
     *
     * <p>Two residents of the same flat can tap Approve and Reject within the same second, and the
     * gate is about to act on whichever wins. Reading under {@code FOR UPDATE} makes the
     * check-then-set atomic, so the second decision sees the first and is refused with 409 instead of
     * quietly overwriting it.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select v from VisitorLog v where v.id = :id and v.township.id = :townshipId")
    Optional<VisitorLog> findByIdForUpdate(@Param("id") UUID id,
                                           @Param("townshipId") UUID townshipId);

    @Query("""
           select v from VisitorLog v
             join fetch v.gate
             left join fetch v.approver
             left join fetch v.targetFlat
            where v.id = :id and v.township.id = :townshipId
           """)
    Optional<VisitorLog> findDetailedById(@Param("id") UUID id,
                                          @Param("townshipId") UUID townshipId);

    /**
     * Unscoped detail fetch, for the after-commit notifier only.
     *
     * <p>The notifier runs on a pool thread with no request and therefore no tenant context; it is
     * re-reading a row whose id it was handed by the transaction that just created it, not resolving
     * anything a caller supplied. Nothing that serves an HTTP request may use this.
     */
    @Query("""
           select v from VisitorLog v
             join fetch v.gate
             left join fetch v.approver
             left join fetch v.targetFlat
            where v.id = :id
           """)
    Optional<VisitorLog> findDetailedByIdUnscoped(@Param("id") UUID id);

    // Approver and flat ids are themselves tenant-unique, so these two inboxes cannot cross a
    // boundary; they are the caller's own routing targets, taken from the authenticated principal.

    /** A sales agent's inbox: visits routed to them personally. */
    List<VisitorLog> findByApprover_IdAndStatusOrderByCreatedAtDesc(UUID approverId, VisitStatus status);

    /** A resident's inbox: anything pending on their flat, whoever the nominated approver is. */
    List<VisitorLog> findByTargetFlat_IdAndStatusOrderByCreatedAtDesc(UUID flatId, VisitStatus status);

    List<VisitorLog> findByTownship_IdAndStatusOrderByCheckedInAtDesc(UUID townshipId, VisitStatus status);

    long countByTownship_IdAndStatus(UUID townshipId, VisitStatus status);

    Page<VisitorLog> findByGate_IdOrderByCreatedAtDesc(UUID gateId, Pageable pageable);

    /**
     * Expiry sweep. A single set-based statement rather than load-modify-save: it is idempotent,
     * touches only rows that are genuinely stale, and cannot interleave badly with a live decision
     * (the PENDING predicate is re-evaluated under the write lock).
     *
     * <p>The statuses are bound as parameters rather than written as inline HQL enum literals. Against
     * a native Postgres enum column, Hibernate renders an inline literal as {@code 'PENDING'::VisitStatus}
     * -- the <em>Java</em> type name -- and Postgres has no such type, so the statement fails at
     * runtime. Bound parameters are cast correctly. The default methods below keep the call sites
     * clean without reintroducing literals.
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("""
           update VisitorLog v
              set v.status = :expired,
                  v.decidedAt = :now
            where v.status = :pending
              and v.createdAt < :cutoff
           """)
    int expirePending(@Param("cutoff") OffsetDateTime cutoff,
                      @Param("now") OffsetDateTime now,
                      @Param("pending") VisitStatus pending,
                      @Param("expired") VisitStatus expired);

    @Query("select v.id from VisitorLog v where v.status = :pending and v.createdAt < :cutoff")
    List<UUID> findIdsByStatusOlderThan(@Param("pending") VisitStatus pending,
                                        @Param("cutoff") OffsetDateTime cutoff);

    default int expirePendingOlderThan(OffsetDateTime cutoff, OffsetDateTime now) {
        return expirePending(cutoff, now, VisitStatus.PENDING, VisitStatus.EXPIRED);
    }

    /** Read the ids first so the sweep can emit a WS event per expired visit and unstick each gate. */
    default List<UUID> findPendingIdsOlderThan(OffsetDateTime cutoff) {
        return findIdsByStatusOlderThan(VisitStatus.PENDING, cutoff);
    }
}
