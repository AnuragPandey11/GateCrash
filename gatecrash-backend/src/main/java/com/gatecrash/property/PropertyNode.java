package com.gatecrash.property;

import com.gatecrash.township.Township;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.annotations.UuidGenerator;
import org.hibernate.type.SqlTypes;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * One node anywhere in a township's property tree: a phase, a tower, a floor, or a flat.
 *
 * <p>Replaces the fixed {@code building_block} -> {@code flat} pair, which could only express
 * one shape of project. The ids carried over verbatim in {@code V4}, so a {@code PropertyNode}
 * of kind {@code UNIT} is the same row, with the same id, that a {@code Flat} was.
 *
 * <p>Three fields are derived by database trigger and must never be set from Java:
 * {@link #depth}, {@link #path} and {@link #unit}. Deriving them in the database is the same
 * call V3 made with the composite foreign keys -- the service layer is where bugs live, and a
 * hand-maintained path that drifts does not fail loudly, it silently sends a notification to
 * the wrong tower. They are mapped {@code insertable = false, updatable = false} so Hibernate
 * reads them back rather than writing them.
 */
@Entity
@Table(name = "property_node")
@Getter
@Setter
@NoArgsConstructor
public class PropertyNode {

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "township_id", nullable = false, updatable = false)
    private Township township;

    /**
     * Null only for a depth-0 root. Immutable after insert: re-parenting would strand the
     * stored {@link #path} of every descendant, so the database refuses it outright.
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "parent_id", updatable = false)
    private PropertyNode parent;

    /** Derived by trigger as {@code parent.depth + 1}. */
    @Column(name = "depth", nullable = false, insertable = false, updatable = false)
    private int depth;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    @Column(name = "kind", nullable = false, columnDefinition = "property_node_kind")
    private PropertyNodeKind kind;

    /** What this node is called in its parent: "Tower A", "14", "A-1401". */
    @Column(name = "name", nullable = false)
    private String name;

    /**
     * The addressable code, on {@code UNIT} nodes only and mandatory there. This is the string
     * a guard types at the gate and the base of every resident login id in the unit
     * ({@code A-1401} -> {@code A-1401-1}). Unique per township, which is stricter than the
     * per-block rule it replaced -- see the note in {@code V4__property_tree.sql}.
     */
    @Column(name = "code")
    private String code;

    /**
     * Storey number, on {@code FLOOR} nodes only. Signed, because basements are real.
     * Separate from {@link #name} so that a floor displayed as "Ground" still sorts between
     * -1 and 1, and so "G", "GF" and "Ground" cannot become three different floors.
     */
    @Column(name = "level_number")
    private Integer levelNumber;

    /**
     * How many people live in this unit, including everyone with no app account -- the spouse,
     * the children, the parents, the live-in help. Counting {@code app_user} rows instead would
     * report a four-person household as one, because typically only the owner has a login.
     *
     * <p>Kept at or above the number of active resident accounts by
     * {@link PropertyService#setDeclaredOccupancy}; that invariant spans two tables, so it is
     * enforced in the service rather than by a constraint.
     */
    @Column(name = "declared_occupancy", nullable = false)
    private int declaredOccupancy;

    /**
     * Materialized path of ancestor ids, {@code /root/child/self/}, derived by trigger. Turns
     * "every resident under Tower A" into a prefix scan instead of a recursive CTE per
     * notification send.
     */
    @Column(name = "path", nullable = false, insertable = false, updatable = false)
    private String path;

    /**
     * Mirrors {@code kind == UNIT}, derived by trigger and pinned by a check constraint. Exists
     * to be a foreign key target: it is what lets {@code app_user.flat_id} reference the unit
     * level specifically, so a resident cannot be filed under a floor or a whole tower.
     */
    @Column(name = "is_unit", nullable = false, insertable = false, updatable = false)
    private boolean unit;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    public UUID getTownshipId() {
        return township == null ? null : township.getId();
    }

    public UUID getParentId() {
        return parent == null ? null : parent.getId();
    }

    /** The label a resident or guard sees. Units are known by their code, everything else by name. */
    public String displayLabel() {
        return kind != null && kind.isUnit() && code != null ? code : name;
    }

    /**
     * The name of the building or grouping this node sits in -- "Tower A", "Rose Cluster" -- for
     * the places that used to show a block name next to a flat number.
     *
     * <p>Walks past floors deliberately. In a Tower -> Floor -> Flat township the immediate parent
     * of a flat is the storey, and "14" is not a useful answer to "which building?"; in a
     * Cluster -> Villa township the immediate parent already is the answer. Returns null for a
     * root, and for a township whose units hang directly off nothing.
     *
     * <p>Walks lazy proxies, so call it inside a transaction.
     */
    public String containerName() {
        PropertyNode ancestor = parent;
        while (ancestor != null && ancestor.getKind() == PropertyNodeKind.FLOOR) {
            ancestor = ancestor.getParent();
        }
        return ancestor == null ? null : ancestor.getName();
    }
}
