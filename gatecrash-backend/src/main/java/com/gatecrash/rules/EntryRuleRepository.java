package com.gatecrash.rules;

import com.gatecrash.visit.VisitorType;
import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface EntryRuleRepository extends JpaRepository<EntryRule, UUID> {

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select r from EntryRule r where r.id = :id and r.townshipId = :townshipId")
    Optional<EntryRule> findByIdForUpdate(@Param("id") UUID id, @Param("townshipId") UUID townshipId);

    List<EntryRule> findTop50ByTownshipIdAndUnit_IdOrderByCreatedAtDesc(UUID townshipId, UUID unitId);

    Page<EntryRule> findByTownshipIdOrderByCreatedAtDesc(UUID townshipId, Pageable pageable);

    Page<EntryRule> findByTownshipIdAndStatusOrderByCreatedAtDesc(UUID townshipId, EntryRuleStatus status,
                                                                  Pageable pageable);

    /** The gate's candidates: approved rules of one home for one visitor type. */
    List<EntryRule> findByUnit_IdAndStatusAndVisitorType(UUID unitId, EntryRuleStatus status,
                                                         VisitorType visitorType);

    long countByUnit_IdAndStatusIn(UUID unitId, Collection<EntryRuleStatus> statuses);
}
