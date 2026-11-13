package com.gatecrash.staff;

import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface StaffAttendanceRepository extends JpaRepository<StaffAttendance, UUID> {

    /** The open stay, if the person is inside. At most one: ux_staff_one_open_stay. */
    Optional<StaffAttendance> findFirstByStaff_IdAndCheckedOutAtIsNull(UUID staffId);

    List<StaffAttendance> findByStaff_IdInAndCheckedOutAtIsNull(Collection<UUID> staffIds);

    @EntityGraph(attributePaths = {"staff", "gate"})
    List<StaffAttendance> findByTownshipIdAndCheckedOutAtIsNullOrderByCheckedInAtDesc(UUID townshipId);

    @EntityGraph(attributePaths = {"staff", "gate", "exitGate"})
    List<StaffAttendance> findByStaff_IdAndCheckedInAtAfterOrderByCheckedInAtDesc(UUID staffId, OffsetDateTime after);

    @EntityGraph(attributePaths = {"staff", "gate", "exitGate"})
    List<StaffAttendance> findByTownshipIdAndCheckedInAtGreaterThanEqualAndCheckedInAtLessThanOrderByCheckedInAtDesc(
            UUID townshipId, OffsetDateTime from, OffsetDateTime to);

    /** Each person's latest arrival: rows of {staffId, max(checkedInAt)}. */
    @Query("""
           select a.staff.id, max(a.checkedInAt) from StaffAttendance a
            where a.staff.id in :staffIds group by a.staff.id
           """)
    List<Object[]> lastSeen(@Param("staffIds") Collection<UUID> staffIds);
}
