package com.gatecrash.township;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface FlatRepository extends JpaRepository<Flat, UUID> {

    boolean existsByBlock_IdAndNumberIgnoreCase(UUID blockId, String number);

    List<Flat> findByBlock_IdOrderByNumberAsc(UUID blockId);

    List<Flat> findByTownship_IdOrderByNumberAsc(UUID townshipId);

    /** The tenant-safe point lookup: a flat id from another township resolves to empty. */
    Optional<Flat> findByIdAndTownship_Id(UUID id, UUID townshipId);

    Optional<Flat> findByTownship_IdAndNumberIgnoreCase(UUID townshipId, String number);

    long countByBlock_Id(UUID blockId);

    long countByTownship_Id(UUID townshipId);

    /**
     * Serialises concurrent resident provisioning for the same flat so the per-flat login-id
     * sequence ({@code A-101-1}, {@code A-101-2}, ...) cannot produce a duplicate. The unique index
     * on {@code (township_id, login_id)} is still the backstop if this lock is ever bypassed.
     *
     * <p>Scoped by township as well as id so it cannot be used to take a write lock on -- or learn
     * the existence of -- a flat in another township.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select f from Flat f where f.id = :id and f.township.id = :townshipId")
    Optional<Flat> findByIdForUpdate(@Param("id") UUID id, @Param("townshipId") UUID townshipId);
}
