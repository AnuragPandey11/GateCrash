package com.gatecrash.user;

import com.gatecrash.property.PropertyNode;
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
 * An account. Every account is admin-provisioned -- there is no self-signup path anywhere in the
 * system, which is why this entity has no "verified"/"pending" states.
 */
@Entity
@Table(name = "app_user")
@Getter
@Setter
@NoArgsConstructor
public class AppUser {

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    @Column(name = "role", nullable = false, columnDefinition = "user_role")
    private UserRole role;

    /**
     * The tenant this account belongs to. Null for -- and only for -- {@code SUPER_ADMIN}, which the
     * {@code super_admin_is_tenantless} check constraint enforces as an exact biconditional rather
     * than leaving it to application convention.
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "township_id", updatable = false)
    private Township township;

    /**
     * What the user types to log in: {@code A-101-1} for residents, an assigned code otherwise.
     *
     * <p>Unique per township, not globally -- every township with a block A mints an {@code A-101-1}.
     * That is why login also takes the township code; see {@code AuthService}.
     */
    @Column(name = "login_id", nullable = false, updatable = false)
    private String loginId;

    @Column(name = "full_name", nullable = false)
    private String fullName;

    /** Unique within the township ({@code ux_user_township_phone}), not across the platform. */
    @Column(name = "phone")
    private String phone;

    /** Unique within the township ({@code ux_user_township_email}), not across the platform. */
    @Column(name = "email")
    private String email;

    /** BCrypt digest. Never serialised, never logged, never returned. */
    @Column(name = "password_hash", nullable = false)
    private String passwordHash;

    @Column(name = "must_reset_password", nullable = false)
    private boolean mustResetPassword = true;

    @Column(name = "is_active", nullable = false)
    private boolean active = true;

    @Column(name = "created_by")
    private UUID createdBy;

    /**
     * The unit this resident lives in. Residents only, enforced by the {@code resident_needs_flat}
     * check constraint, and pinned to the addressable level by {@code user_unit_same_township} --
     * a resident cannot be filed under a floor or a whole tower.
     *
     * <p>The column is still named {@code flat_id}: V4 repointed it from the retired {@code flat}
     * table to {@code property_node} without renaming it, so that migration stayed a pure
     * structural change. The Java side is free to say what it now means.
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "flat_id")
    private PropertyNode unit;

    /** SALES presence, drives the guard's on-duty dropdown. */
    @Column(name = "is_on_duty", nullable = false)
    private boolean onDuty = false;

    /**
     * Stamped into every access token. Incrementing it invalidates all outstanding access tokens for
     * this user immediately, which is what makes password change and deactivation take effect now
     * rather than after the token TTL elapses.
     */
    @Column(name = "token_version", nullable = false)
    private int tokenVersion = 0;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    /** Kept as {@code getFlatId} while the API still speaks {@code flatId}; see {@link #unit}. */
    public UUID getFlatId() {
        return unit == null ? null : unit.getId();
    }

    /** The unit's addressable code ({@code A-1401}), or null for anyone who is not a resident. */
    public String getUnitCode() {
        return unit == null ? null : unit.getCode();
    }

    public UUID getTownshipId() {
        return township == null ? null : township.getId();
    }

    public void bumpTokenVersion() {
        this.tokenVersion++;
    }
}
