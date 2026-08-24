package com.gatecrash.user;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Admin listing uses {@link JpaSpecificationExecutor} rather than a JPQL query with
 * {@code :param is null or ...} branches: Postgres cannot infer the type of a null bind against a
 * native enum column, and Criteria lets us omit absent filters from the query entirely.
 */
@Repository
public interface AppUserRepository extends JpaRepository<AppUser, UUID>, JpaSpecificationExecutor<AppUser> {

    Optional<AppUser> findByLoginId(String loginId);

    boolean existsByLoginId(String loginId);

    boolean existsByPhone(String phone);

    boolean existsByEmail(String email);

    boolean existsByPhoneAndIdNot(String phone, UUID id);

    boolean existsByEmailAndIdNot(String email, UUID id);

    /** Guard's on-duty dropdown. Backed by the {@code idx_sales_on_duty} partial index. */
    List<AppUser> findByRoleAndOnDutyTrueAndActiveTrueOrderByFullNameAsc(UserRole role);

    /** Base for the per-flat resident login-id sequence. Counts inactive accounts too, deliberately:
     *  a deactivated {@code A-101-2} must not have its login id handed to a new resident. */
    long countByFlat_Id(UUID flatId);

    List<AppUser> findByFlat_IdAndRoleAndActiveTrue(UUID flatId, UserRole role);

    // ----- Audience resolution (notification fan-out) ----------------------------------------
    // Each mode is its own parameterised query. No SQL is ever assembled from client input.

    @Query("select u.id from AppUser u where u.active = true")
    List<UUID> findActiveUserIds();

    @Query("select u.id from AppUser u where u.active = true and u.role in :roles")
    List<UUID> findActiveUserIdsByRoles(@Param("roles") Collection<UserRole> roles);

    @Query("select u.id from AppUser u where u.active = true and u.role not in :roles")
    List<UUID> findActiveUserIdsExcludingRoles(@Param("roles") Collection<UserRole> roles);

    @Query("select u.id from AppUser u where u.active = true and u.flat.id in :flatIds")
    List<UUID> findActiveUserIdsByFlatIds(@Param("flatIds") Collection<UUID> flatIds);

    @Query("select u.id from AppUser u where u.active = true and u.flat.block.id in :blockIds")
    List<UUID> findActiveUserIdsByBlockIds(@Param("blockIds") Collection<UUID> blockIds);
}
