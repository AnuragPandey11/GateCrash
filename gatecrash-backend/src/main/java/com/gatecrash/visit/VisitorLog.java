package com.gatecrash.visit;

import com.gatecrash.pass.PreApproval;
import com.gatecrash.township.Flat;
import com.gatecrash.township.Gate;
import com.gatecrash.user.AppUser;
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
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.annotations.UuidGenerator;
import org.hibernate.type.SqlTypes;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * One physical arrival at a gate -- a walk-in awaiting approval, or a pass redemption that skipped
 * straight to {@code CHECKED_IN}. This is the row the guard's screen watches and the admin's
 * occupancy feed counts.
 */
@Entity
@Table(name = "visitor_log")
@Getter
@Setter
@NoArgsConstructor
public class VisitorLog {

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "gate_id", nullable = false, updatable = false)
    private Gate gate;

    /** The guard who logged the arrival. */
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "logged_by", nullable = false, updatable = false)
    private AppUser loggedBy;

    @Column(name = "visitor_name", nullable = false)
    private String visitorName;

    @Column(name = "visitor_phone")
    private String visitorPhone;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    @Column(name = "visitor_type", nullable = false, columnDefinition = "visitor_type")
    private VisitorType visitorType;

    @Column(name = "photo_url")
    private String photoUrl;

    @Column(name = "vehicle_no")
    private String vehicleNo;

    /**
     * The routed decision-maker. For resident routing this is one nominated account on the flat --
     * any active resident of {@link #targetFlat} may decide, so ownership is checked against the flat,
     * not against this id.
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "approver_id")
    private AppUser approver;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    @Column(name = "approver_kind", columnDefinition = "approver_kind")
    private ApproverKind approverKind;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "target_flat_id")
    private Flat targetFlat;

    /** Set when this arose from a pass redemption. */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "pre_approval_id")
    private PreApproval preApproval;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    @Column(name = "status", nullable = false, columnDefinition = "visit_status")
    private VisitStatus status = VisitStatus.PENDING;

    @Column(name = "decided_at")
    private OffsetDateTime decidedAt;

    @Column(name = "checked_in_at")
    private OffsetDateTime checkedInAt;

    @Column(name = "checked_out_at")
    private OffsetDateTime checkedOutAt;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    /**
     * Second line of defence behind the pessimistic row lock the service takes: if two decisions ever
     * reach this row concurrently without the lock, one of them fails loudly instead of silently
     * overwriting the other.
     */
    @Version
    @Column(name = "version", nullable = false)
    private long version;

    public UUID getApproverId() {
        return approver == null ? null : approver.getId();
    }

    public UUID getTargetFlatId() {
        return targetFlat == null ? null : targetFlat.getId();
    }
}
