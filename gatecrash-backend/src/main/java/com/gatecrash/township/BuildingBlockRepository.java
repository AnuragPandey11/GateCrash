package com.gatecrash.township;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface BuildingBlockRepository extends JpaRepository<BuildingBlock, UUID> {

    boolean existsByNameIgnoreCase(String name);

    List<BuildingBlock> findAllByOrderByNameAsc();
}
