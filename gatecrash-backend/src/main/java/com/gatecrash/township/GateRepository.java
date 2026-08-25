package com.gatecrash.township;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface GateRepository extends JpaRepository<Gate, UUID> {

    boolean existsByTownship_IdAndNameIgnoreCase(UUID townshipId, String name);

    List<Gate> findByTownship_IdOrderByNameAsc(UUID townshipId);

    /** The tenant-safe point lookup: a gate id from another township resolves to empty, not to a row. */
    Optional<Gate> findByIdAndTownship_Id(UUID id, UUID townshipId);

    Optional<Gate> findByTownship_IdAndNameIgnoreCase(UUID townshipId, String name);

    long countByTownship_Id(UUID townshipId);
}
