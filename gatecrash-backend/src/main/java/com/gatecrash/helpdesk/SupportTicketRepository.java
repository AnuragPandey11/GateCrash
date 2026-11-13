package com.gatecrash.helpdesk;

import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;
import java.util.UUID;

/** Every finder is anchored on the township: another township's ticket id is a 404. */
public interface SupportTicketRepository extends JpaRepository<SupportTicket, UUID> {

    Optional<SupportTicket> findByIdAndTownshipId(UUID id, UUID townshipId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select t from SupportTicket t where t.id = :id and t.townshipId = :townshipId")
    Optional<SupportTicket> findByIdForUpdate(@Param("id") UUID id, @Param("townshipId") UUID townshipId);

    Page<SupportTicket> findByTownshipIdAndRaisedBy_IdOrderByCreatedAtDesc(UUID townshipId, UUID userId,
                                                                           Pageable pageable);

    Page<SupportTicket> findByTownshipIdOrderByCreatedAtDesc(UUID townshipId, Pageable pageable);

    Page<SupportTicket> findByTownshipIdAndStatusOrderByCreatedAtDesc(UUID townshipId, TicketStatus status,
                                                                      Pageable pageable);
}
