package com.gatecrash.staff;

import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface StaffHouseholdRepository extends JpaRepository<StaffHousehold, UUID> {

    @EntityGraph(attributePaths = "staff")
    List<StaffHousehold> findByTownshipIdAndUnit_Id(UUID townshipId, UUID unitId);

    @EntityGraph(attributePaths = "unit")
    List<StaffHousehold> findByStaff_IdIn(Collection<UUID> staffIds);

    Optional<StaffHousehold> findByStaff_IdAndUnit_Id(UUID staffId, UUID unitId);

    boolean existsByStaff_IdAndUnit_Id(UUID staffId, UUID unitId);

    long countByUnit_Id(UUID unitId);
}
