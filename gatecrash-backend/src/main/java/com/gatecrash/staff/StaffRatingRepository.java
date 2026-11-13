package com.gatecrash.staff;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface StaffRatingRepository extends JpaRepository<StaffRating, UUID> {

    Optional<StaffRating> findByStaff_IdAndUnit_Id(UUID staffId, UUID unitId);

    List<StaffRating> findByUnit_IdAndStaff_IdIn(UUID unitId, Collection<UUID> staffIds);

    /** Rows of {staffId, avg(rating), count}. */
    @Query("""
           select r.staff.id, avg(r.rating), count(r) from StaffRating r
            where r.staff.id in :staffIds group by r.staff.id
           """)
    List<Object[]> summaries(@Param("staffIds") Collection<UUID> staffIds);
}
