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
import jakarta.persistence.UniqueConstraint;
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
 * One level in one township's property hierarchy -- the <em>shape</em> of its tree, and the
 * developer's own word for that level.
 *
 * <p>This is what makes the admin console dynamic. Rather than a hardcoded Blocks tab and a
 * Flats tab, the console reads a township's levels and renders one tab per level, labelled
 * {@link #plural}. A villa developer sees Clusters and Villas; a high-rise sees Towers, Floors
 * and Flats; nothing in the code changed between the two.
 *
 * <p>{@link #kind} and the labels answer different questions and must not be conflated.
 * {@code kind} is what the system knows (is this the addressable unit? does it carry a storey
 * number?); {@code singular}/{@code plural} are what the human reads. Code branches only on
 * the former -- see {@link PropertyNodeKind}.
 */
@Entity
@Table(name = "property_level",
        uniqueConstraints = @UniqueConstraint(columnNames = {"township_id", "depth"}))
@Getter
@Setter
@NoArgsConstructor
public class PropertyLevel {

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "township_id", nullable = false, updatable = false)
    private Township township;

    /** 0 is the outermost level. Contiguous from 0, enforced by {@link PropertyService}. */
    @Column(name = "depth", nullable = false)
    private int depth;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    @Column(name = "kind", nullable = false, columnDefinition = "property_node_kind")
    private PropertyNodeKind kind;

    /** "Tower", "Villa", "Plot". Display only -- never matched on. */
    @Column(name = "singular", nullable = false)
    private String singular;

    /** "Towers", "Villas", "Plots". Not derived by appending an "s": "Row Houses". */
    @Column(name = "plural", nullable = false)
    private String plural;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    public UUID getTownshipId() {
        return township == null ? null : township.getId();
    }

    public boolean isUnitLevel() {
        return kind != null && kind.isUnit();
    }
}
