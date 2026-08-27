package com.gatecrash.property;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Every finder here is anchored on the township, for the reason given in {@code CLAUDE.md}:
 * another township's node id must resolve to empty, so the caller gets a 404 -- the same answer
 * an id that does not exist gets, which is the answer that tells them nothing.
 */
public interface PropertyNodeRepository extends JpaRepository<PropertyNode, UUID> {

    /** The tenant-safe point lookup. */
    Optional<PropertyNode> findByIdAndTownship_Id(UUID id, UUID townshipId);

    List<PropertyNode> findByTownship_IdAndDepthOrderByNameAsc(UUID townshipId, int depth);

    List<PropertyNode> findByTownship_IdOrderByDepthAscNameAsc(UUID townshipId);

    List<PropertyNode> findByParent_IdOrderByNameAsc(UUID parentId);

    /** Floors sort by storey, not by name -- "Ground" belongs between -1 and 1, not under G. */
    @Query("""
            select n from PropertyNode n
            where n.parent.id = :parentId
            order by case when n.levelNumber is null then 1 else 0 end, n.levelNumber asc, n.name asc
            """)
    List<PropertyNode> findChildrenOrdered(@Param("parentId") UUID parentId);

    long countByParent_Id(UUID parentId);

    boolean existsByParent_IdAndNameIgnoreCase(UUID parentId, String name);

    /** Root-level sibling names are scoped to the township, since their parent_id is null. */
    boolean existsByTownship_IdAndParentIsNullAndNameIgnoreCase(UUID townshipId, String name);

    boolean existsByTownship_IdAndCodeIgnoreCase(UUID townshipId, String code);

    Optional<PropertyNode> findByTownship_IdAndCodeIgnoreCase(UUID townshipId, String code);

    boolean existsByParent_IdAndLevelNumber(UUID parentId, Integer levelNumber);

    List<PropertyNode> findByTownship_IdAndKindOrderByCodeAsc(UUID townshipId, PropertyNodeKind kind);

    long countByTownship_IdAndKind(UUID townshipId, PropertyNodeKind kind);

    /**
     * Locks the unit row so two admins provisioning a resident into it at the same moment
     * serialise, and the per-unit login-id sequence cannot mint the same suffix twice. Scoped to
     * the township for the usual reason: a lock is an observable side effect, so taking one on a
     * row the caller may not know exists would leak its existence.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select n from PropertyNode n where n.id = :id and n.township.id = :townshipId")
    Optional<PropertyNode> findByIdForUpdate(@Param("id") UUID id, @Param("townshipId") UUID townshipId);

    // ----- subtree queries -----------------------------------------------------------------

    /**
     * Every node beneath the given ancestors, at any depth, via the materialized path. This is
     * what replaces the old {@code flat.block.id in :blockIds} join: a two-level tree could
     * express "in this block" as a single hop, but "in this phase" is an arbitrary number of
     * hops, and a prefix scan handles both without a recursive CTE.
     *
     * <p>The path is built from UUIDs by the trigger, so the {@code like} pattern is assembled
     * from values that cannot contain a wildcard -- there is no pattern injection to be had.
     */
    @Query("""
            select n from PropertyNode n
            where n.township.id = :townshipId
              and n.kind = :kind
              and exists (
                  select 1 from PropertyNode a
                  where a.id in :ancestorIds
                    and a.township.id = :townshipId
                    and n.path like concat(a.path, '%')
              )
            """)
    List<PropertyNode> findDescendantsOfKind(@Param("townshipId") UUID townshipId,
                                             @Param("ancestorIds") Collection<UUID> ancestorIds,
                                             @Param("kind") PropertyNodeKind kind);

    /**
     * Total declared headcount across a township's units.
     *
     * <p>The kind is bound rather than written as a literal: an enum literal inside JPQL renders as
     * a cast to the Java type name, and the Postgres type is {@code property_node_kind}.
     */
    @Query("""
            select coalesce(sum(n.declaredOccupancy), 0) from PropertyNode n
            where n.township.id = :townshipId and n.kind = :kind
            """)
    long sumDeclaredOccupancy(@Param("townshipId") UUID townshipId,
                              @Param("kind") PropertyNodeKind kind);

    /**
     * Units considered occupied: someone has declared people live there, or at least one active
     * resident account is attached. The two disagree often enough to matter -- a unit handed over
     * with the owner's login created but nobody moved in yet has accounts and no headcount.
     */
    @Query(value = """
            select count(*) from property_node n
            where n.township_id = :townshipId and n.kind = 'UNIT'
              and (n.declared_occupancy > 0
                   or exists (select 1 from app_user u
                              where u.flat_id = n.id and u.is_active and u.role = 'RESIDENT'))
            """, nativeQuery = true)
    long countOccupiedUnits(@Param("townshipId") UUID townshipId);
}
