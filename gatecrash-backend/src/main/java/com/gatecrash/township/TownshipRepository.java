package com.gatecrash.township;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface TownshipRepository extends JpaRepository<Township, UUID> {

    /** The login path. Codes are normalised to upper case before they are stored or looked up. */
    Optional<Township> findByCode(String code);

    boolean existsByCode(String code);

    Page<Township> findByStatusInOrderByNameAsc(Collection<TownshipStatus> statuses, Pageable pageable);

    Page<Township> findAllByOrderByNameAsc(Pageable pageable);

    List<Township> findByStatusOrderByNameAsc(TownshipStatus status);

    /** Headline counts for the super admin's township list, resolved in one pass per township. */
    @Query("select count(u) from AppUser u where u.township.id = :townshipId and u.active = true")
    long countActiveUsers(@Param("townshipId") UUID townshipId);

    @Query("""
           select count(u) from AppUser u
            where u.township.id = :townshipId and u.role = com.gatecrash.user.UserRole.ADMIN
              and u.active = true
           """)
    long countActiveAdmins(@Param("townshipId") UUID townshipId);
}
