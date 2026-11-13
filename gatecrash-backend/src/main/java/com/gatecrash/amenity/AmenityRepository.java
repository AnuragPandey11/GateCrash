package com.gatecrash.amenity;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface AmenityRepository extends JpaRepository<Amenity, UUID> {

    Optional<Amenity> findByIdAndTownshipId(UUID id, UUID townshipId);

    /** Taken before counting a slot's bookings, so two residents cannot both claim its last place. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select a from Amenity a where a.id = :id and a.townshipId = :townshipId")
    Optional<Amenity> findByIdForUpdate(@Param("id") UUID id, @Param("townshipId") UUID townshipId);

    List<Amenity> findByTownshipIdOrderByNameAsc(UUID townshipId);

    List<Amenity> findByTownshipIdAndActiveTrueOrderByNameAsc(UUID townshipId);

    boolean existsByTownshipIdAndNameIgnoreCase(UUID townshipId, String name);

    boolean existsByTownshipIdAndNameIgnoreCaseAndIdNot(UUID townshipId, String name, UUID id);
}
