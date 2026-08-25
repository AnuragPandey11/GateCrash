package com.gatecrash.user;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Modifying;
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
 *
 * <p><b>Tenancy:</b> there is deliberately no {@code findByLoginId(String)} on this interface any
 * more. Login ids are unique only within a township, so an unscoped lookup would return an arbitrary
 * township's account -- a cross-tenant authentication bug that would be invisible until a second
 * township existed. Every account lookup here is either scoped by township, or explicitly scoped to
 * the tenantless platform namespace where the super admins live.
 */
@Repository
public interface AppUserRepository extends JpaRepository<AppUser, UUID>, JpaSpecificationExecutor<AppUser> {

    // ----- Identity lookups -------------------------------------------------------------------

    /** The login path for every ordinary account, once the township code has been resolved. */
    Optional<AppUser> findByTownship_IdAndLoginId(UUID townshipId, String loginId);

    /** The login path for a {@code SUPER_ADMIN}, which belongs to no township. */
    Optional<AppUser> findByTownshipIsNullAndLoginId(String loginId);

    /** Bootstrap lookup: resolves the seeded admin of a township by its stable code. */
    Optional<AppUser> findByTownship_CodeAndLoginId(String townshipCode, String loginId);

    boolean existsByTownship_IdAndLoginId(UUID townshipId, String loginId);

    /** The tenant-safe point lookup: a user id from another township resolves to empty, not to a row. */
    Optional<AppUser> findByIdAndTownship_Id(UUID id, UUID townshipId);

    Optional<AppUser> findByIdAndTownshipIsNull(UUID id);

    // ----- The tenantless platform namespace (SUPER_ADMIN) -------------------------------------

    List<AppUser> findByTownshipIsNullOrderByFullNameAsc();

    long countByTownshipIsNullAndActiveTrue();

    boolean existsByTownshipIsNullAndLoginId(String loginId);

    boolean existsByTownshipIsNullAndPhone(String phone);

    boolean existsByTownshipIsNullAndEmail(String email);

    boolean existsByTownship_IdAndPhone(UUID townshipId, String phone);

    boolean existsByTownship_IdAndEmail(UUID townshipId, String email);

    boolean existsByTownship_IdAndPhoneAndIdNot(UUID townshipId, String phone, UUID id);

    boolean existsByTownship_IdAndEmailAndIdNot(UUID townshipId, String email, UUID id);

    // ----- Operational reads ------------------------------------------------------------------

    /** Guard's on-duty dropdown. Backed by the {@code idx_sales_on_duty} partial index. */
    List<AppUser> findByTownship_IdAndRoleAndOnDutyTrueAndActiveTrueOrderByFullNameAsc(
            UUID townshipId, UserRole role);

    /** Base for the per-flat resident login-id sequence. Counts inactive accounts too, deliberately:
     *  a deactivated {@code A-101-2} must not have its login id handed to a new resident.
     *  Flat ids are globally unique, so this is already confined to one township. */
    long countByFlat_Id(UUID flatId);

    List<AppUser> findByFlat_IdAndRoleAndActiveTrue(UUID flatId, UserRole role);

    long countByTownship_IdAndRoleAndActiveTrue(UUID townshipId, UserRole role);

    List<AppUser> findByTownship_IdAndRoleOrderByFullNameAsc(UUID townshipId, UserRole role);

    // ----- Township lifecycle -----------------------------------------------------------------

    /**
     * Ends every live session in a township in one statement, used when it is suspended or archived.
     *
     * <p>Bumping {@code token_version} is what makes the change immediate: outstanding access tokens
     * stop verifying on their next request instead of remaining valid for the rest of their TTL.
     * Deliberately paired with, not a substitute for, the township-status check in
     * {@code JwtAuthFilter} -- and deliberately <em>not</em> a mass deactivation of the accounts,
     * because restoring a township must not have to guess which of them were already disabled.
     */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("update AppUser u set u.tokenVersion = u.tokenVersion + 1 where u.township.id = :townshipId")
    int bumpTokenVersionsForTownship(@Param("townshipId") UUID townshipId);

    @Query("select u.id from AppUser u where u.township.id = :townshipId")
    List<UUID> findIdsByTownship(@Param("townshipId") UUID townshipId);

    // ----- Audience resolution (notification fan-out) ----------------------------------------
    // Each mode is its own parameterised query. No SQL is ever assembled from client input, and every
    // one of them is anchored on township_id -- a broadcast must never cross a tenant boundary.

    @Query("select u.id from AppUser u where u.active = true and u.township.id = :townshipId")
    List<UUID> findActiveUserIds(@Param("townshipId") UUID townshipId);

    @Query("""
           select u.id from AppUser u
            where u.active = true and u.township.id = :townshipId and u.role in :roles
           """)
    List<UUID> findActiveUserIdsByRoles(@Param("townshipId") UUID townshipId,
                                        @Param("roles") Collection<UserRole> roles);

    @Query("""
           select u.id from AppUser u
            where u.active = true and u.township.id = :townshipId and u.role not in :roles
           """)
    List<UUID> findActiveUserIdsExcludingRoles(@Param("townshipId") UUID townshipId,
                                               @Param("roles") Collection<UserRole> roles);

    @Query("""
           select u.id from AppUser u
            where u.active = true and u.township.id = :townshipId and u.flat.id in :flatIds
           """)
    List<UUID> findActiveUserIdsByFlatIds(@Param("townshipId") UUID townshipId,
                                          @Param("flatIds") Collection<UUID> flatIds);

    @Query("""
           select u.id from AppUser u
            where u.active = true and u.township.id = :townshipId and u.flat.block.id in :blockIds
           """)
    List<UUID> findActiveUserIdsByBlockIds(@Param("townshipId") UUID townshipId,
                                           @Param("blockIds") Collection<UUID> blockIds);
}
