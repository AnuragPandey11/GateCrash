package com.gatecrash.user;

import com.gatecrash.township.Flat;
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

    /** What the user types to log in: {@code A-101-1} for residents, an assigned code otherwise. */
    @Column(name = "login_id", nullable = false, unique = true, updatable = false)
    private String loginId;

    @Column(name = "full_name", nullable = false)
    private String fullName;

    @Column(name = "phone", unique = true)
    private String phone;

    @Column(name = "email", unique = true)
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

    /** Residents only; enforced by the {@code resident_needs_flat} check constraint. */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "flat_id")
    private Flat flat;

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

    public UUID getFlatId() {
        return flat == null ? null : flat.getId();
    }

    public void bumpTokenVersion() {
        this.tokenVersion++;
    }
}
