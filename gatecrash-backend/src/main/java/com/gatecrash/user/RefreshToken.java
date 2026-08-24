package com.gatecrash.user;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UuidGenerator;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * A single link in a refresh-token rotation chain.
 *
 * <p>Only the SHA-256 of the opaque token is stored, so a database dump yields nothing that can be
 * presented to {@code /auth/refresh}. Every refresh mints a new link and revokes the old one; all
 * links from one login share a {@code familyId} so that replaying a spent token can revoke the whole
 * chain at once.
 */
@Entity
@Table(name = "refresh_token")
@Getter
@Setter
@NoArgsConstructor
public class RefreshToken {

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    /** Shared by every token descended from one login. */
    @Column(name = "family_id", nullable = false, updatable = false)
    private UUID familyId;

    @Column(name = "token_hash", nullable = false, unique = true, updatable = false)
    private String tokenHash;

    @Column(name = "expires_at", nullable = false)
    private OffsetDateTime expiresAt;

    @Column(name = "revoked", nullable = false)
    private boolean revoked = false;

    @Column(name = "revoked_reason")
    private String revokedReason;

    @Column(name = "rotated_at")
    private OffsetDateTime rotatedAt;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    public boolean isUsable(OffsetDateTime now) {
        return !revoked && expiresAt.isAfter(now);
    }

    public void revoke(String reason) {
        this.revoked = true;
        this.revokedReason = reason;
    }
}
