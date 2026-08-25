package com.gatecrash.township;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Every finder is anchored on {@code townshipId}. Lookups by primary key alone are still available
 * from {@link JpaRepository}, but callers must follow them with a tenant check -- an id in a URL is
 * attacker-controlled, and finding the row is not the same as being entitled to it.
 */
@Repository
public interface BuildingBlockRepository extends JpaRepository<BuildingBlock, UUID> {

    boolean existsByTownship_IdAndNameIgnoreCase(UUID townshipId, String name);

    List<BuildingBlock> findByTownship_IdOrderByNameAsc(UUID townshipId);

    Optional<BuildingBlock> findByIdAndTownship_Id(UUID id, UUID townshipId);

    Optional<BuildingBlock> findByTownship_IdAndNameIgnoreCase(UUID townshipId, String name);

    long countByTownship_Id(UUID townshipId);
}
