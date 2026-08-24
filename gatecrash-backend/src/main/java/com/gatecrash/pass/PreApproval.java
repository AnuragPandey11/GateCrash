package com.gatecrash.pass;

import com.gatecrash.user.AppUser;
import com.gatecrash.visit.ApproverKind;
import com.gatecrash.visit.VisitorType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UuidGenerator;
import org.hibernate.type.SqlTypes;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * A time-bound pass minted before the visitor arrives, redeemable by PIN or QR.
 *
 * <p>Three fields carry the security of the whole feature:
 * <ul>
 *   <li>{@code pinHash} -- bcrypt, the only thing that authorises a PIN redemption.</li>
 *   <li>{@code pinLookup} -- a peppered HMAC used purely as an index, so redemption is one indexed
 *       read rather than a bcrypt comparison against every active pass in the township.</li>
 *   <li>{@code qrToken} -- 122 bits of random UUID, opaque, and the only thing encoded in the QR.</li>
 * </ul>
 * The plaintext PIN exists only in the mint response and is never persisted or logged.
 */
@Entity
@Table(name = "pre_approval")
@Getter
@Setter
@NoArgsConstructor
public class PreApproval {

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "created_by", nullable = false, updatable = false)
    private AppUser createdBy;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    @Column(name = "approver_kind", nullable = false, columnDefinition = "approver_kind")
    private ApproverKind approverKind;

    @Column(name = "visitor_name")
    private String visitorName;

    @Column(name = "visitor_phone")
    private String visitorPhone;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    @Column(name = "visitor_type", nullable = false, columnDefinition = "visitor_type")
    private VisitorType visitorType = VisitorType.GUEST;

    @Column(name = "pin_hash", nullable = false)
    private String pinHash;

    /** Deterministic HMAC of the PIN under a server-side pepper; index only, never an authoriser. */
    @Column(name = "pin_lookup")
    private String pinLookup;

    /** Display hint for the owner's pass list, e.g. "3456". Never the whole PIN. */
    @Column(name = "pin_last4")
    private String pinLast4;

    @Column(name = "qr_token", nullable = false, unique = true, updatable = false)
    private UUID qrToken = UUID.randomUUID();

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    @Column(name = "status", nullable = false, columnDefinition = "pass_status")
    private PassStatus status = PassStatus.ACTIVE;

    @Column(name = "valid_from", nullable = false)
    private OffsetDateTime validFrom = OffsetDateTime.now();

    @Column(name = "valid_until", nullable = false)
    private OffsetDateTime validUntil;

    @Column(name = "max_uses", nullable = false)
    private int maxUses = 1;

    @Column(name = "use_count", nullable = false)
    private int useCount = 0;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @Version
    @Column(name = "version", nullable = false)
    private long version;

    /** True only if the pass is active, inside its window, and has uses left. */
    public boolean isRedeemableAt(OffsetDateTime now) {
        return status == PassStatus.ACTIVE
                && !now.isBefore(validFrom)
                && now.isBefore(validUntil)
                && useCount < maxUses;
    }

    public UUID getCreatedById() {
        return createdBy == null ? null : createdBy.getId();
    }
}
