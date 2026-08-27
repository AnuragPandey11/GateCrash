package com.gatecrash.property;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface PropertyLevelRepository extends JpaRepository<PropertyLevel, UUID> {

    List<PropertyLevel> findByTownship_IdOrderByDepthAsc(UUID townshipId);

    Optional<PropertyLevel> findByTownship_IdAndDepth(UUID townshipId, int depth);

    Optional<PropertyLevel> findByTownship_IdAndKind(UUID townshipId, PropertyNodeKind kind);

    Optional<PropertyLevel> findByIdAndTownship_Id(UUID id, UUID townshipId);

    long countByTownship_Id(UUID townshipId);
}
