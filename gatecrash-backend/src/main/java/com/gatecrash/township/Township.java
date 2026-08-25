package com.gatecrash.township;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
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
 * The tenant. Every operational row in the system belongs to exactly one of these, and the only
 * accounts that do not are {@code SUPER_ADMIN}s, who administer the platform itself.
 *
 * <p>{@link #code} is part of a credential, not a label: because login ids are only unique within a
 * township ({@code A-101-1} exists in every township that has a block A), the code is what tells the
 * login endpoint which namespace to resolve the login id in. It is immutable once issued for the same
 * reason a login id is -- changing it would invalidate every sign-in card handed to a resident.
 */
@Entity
@Table(name = "township")
@Getter
@Setter
@NoArgsConstructor
public class Township {

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    /** Upper-case, 2-32 chars of {@code [A-Z0-9-]}; enforced by {@code township_code_shape}. */
    @Column(name = "code", nullable = false, unique = true, updatable = false)
    private String code;

    @Column(name = "name", nullable = false)
    private String name;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    @Column(name = "status", nullable = false, columnDefinition = "township_status")
    private TownshipStatus status = TownshipStatus.ACTIVE;

    @Column(name = "contact_email")
    private String contactEmail;

    @Column(name = "contact_phone")
    private String contactPhone;

    /** The super admin who onboarded this township. */
    @Column(name = "created_by")
    private UUID createdBy;

    @Column(name = "archived_at")
    private OffsetDateTime archivedAt;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    public boolean isActive() {
        return status != null && status.allowsAccess();
    }
}
