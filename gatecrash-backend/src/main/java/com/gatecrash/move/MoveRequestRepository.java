package com.gatecrash.move;

import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDate;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface MoveRequestRepository extends JpaRepository<MoveRequest, UUID> {

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select m from MoveRequest m where m.id = :id and m.townshipId = :townshipId")
    Optional<MoveRequest> findByIdForUpdate(@Param("id") UUID id, @Param("townshipId") UUID townshipId);

    List<MoveRequest> findTop50ByTownshipIdAndRequestedBy_IdOrderByCreatedAtDesc(UUID townshipId, UUID userId);

    Page<MoveRequest> findByTownshipIdOrderByMoveDateDescCreatedAtDesc(UUID townshipId, Pageable pageable);

    Page<MoveRequest> findByTownshipIdAndStatusOrderByMoveDateAscCreatedAtAsc(UUID townshipId, MoveStatus status,
                                                                             Pageable pageable);

    List<MoveRequest> findByTownshipIdAndStatusAndMoveDateOrderByTimeFromAsc(UUID townshipId, MoveStatus status,
                                                                            LocalDate moveDate);

    boolean existsByUnit_IdAndMoveTypeAndStatusIn(UUID unitId, MoveType type, Collection<MoveStatus> statuses);
}
