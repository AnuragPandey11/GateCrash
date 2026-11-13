package com.gatecrash.staff;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface StaffMemberRepository extends JpaRepository<StaffMember, UUID> {

    Optional<StaffMember> findByIdAndTownshipId(UUID id, UUID townshipId);

    /** Serialises check-in/out of one person, so two gates cannot both mark them in. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select s from StaffMember s where s.id = :id and s.townshipId = :townshipId")
    Optional<StaffMember> findByIdForUpdate(@Param("id") UUID id, @Param("townshipId") UUID townshipId);

    Optional<StaffMember> findByTownshipIdAndCodeLookup(UUID townshipId, String codeLookup);

    Optional<StaffMember> findByTownshipIdAndQrToken(UUID townshipId, UUID qrToken);

    boolean existsByTownshipIdAndCodeLookup(UUID townshipId, String codeLookup);

    boolean existsByTownshipIdAndPhone(UUID townshipId, String phone);

    List<StaffMember> findByTownshipIdOrderByFullNameAsc(UUID townshipId);

    List<StaffMember> findByTownshipIdAndActiveTrueOrderByFullNameAsc(UUID townshipId);
}
