package com.gatecrash.visit;

import com.gatecrash.pass.PreApproval;
import com.gatecrash.property.PropertyNode;
import com.gatecrash.township.Gate;
import com.gatecrash.township.Township;
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

    /**
     * The tenant. Redundant with {@code gate.township} in the happy path -- and that is the point:
     * the composite foreign keys {@code visit_gate_same_township}, {@code visit_guard_same_township},
     * {@code visit_approver_same_township}, {@code visit_unit_same_township} and
     * {@code visit_pass_same_township} all pin their target to this column, so a visit that mixed two
     * townships could not be written at all.
     */
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "township_id", nullable = false, updatable = false)
    private Township township;

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
     * The "Meet Sales Agent" tick-box: this visitor came to see the sales team. Orthogonal to
     * {@link #visitorType} -- a prospect is a GUEST who wants to meet sales -- and tied to routing
     * by the {@code sales_meeting_routes_to_sales} check: true exactly when the visit is routed to a
     * sales agent.
     */
    @Column(name = "meet_sales_agent", nullable = false)
    private boolean meetSalesAgent = false;

    @Column(name = "purpose")
    private String purpose;

    /**
     * How long the visitor expects to stay, set by the guard at the gate or by the resident when
     * approving (or by the pass). Drives {@link #expectedOutAt}, and so the overstay alert.
     */
    @Column(name = "expected_duration_minutes")
    private Integer expectedDurationMinutes;

    /** Set at check-in from the duration, or from a one-time pass's out time; extendable. */
    @Column(name = "expected_out_at")
    private OffsetDateTime expectedOutAt;

    /** When the overstay alert fired. Cleared when the stay is extended, so it can fire again. */
    @Column(name = "overstay_alerted_at")
    private OffsetDateTime overstayAlertedAt;

    /**
     * Peppered HMAC of the Leave-at-Gate collection code -- the same scheme as pass PINs, so the
     * plaintext is never stored. Regenerating the code replaces it.
     */
    @Column(name = "collection_code_lookup")
    private String collectionCodeLookup;

    @Column(name = "collected_at")
    private OffsetDateTime collectedAt;

    /** The society rule that approved this walk-in on arrival, if one did (V10). */
    @Column(name = "entry_rule_id")
    private UUID entryRuleId;

    /**
     * Where the visitor left (V12). {@link #gate} is where they came in; in a township with several
     * gates the two can differ, and both belong in the record.
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "exit_gate_id")
    private Gate exitGate;

    /**
     * The routed decision-maker. For resident routing this is one nominated account on the flat --
     * any active resident of {@link #targetUnit} may decide, so ownership is checked against the flat,
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
    private PropertyNode targetUnit;

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

    public UUID getTownshipId() {
        return township == null ? null : township.getId();
    }

    public UUID getApproverId() {
        return approver == null ? null : approver.getId();
    }

    public UUID getTargetFlatId() {
        return targetUnit == null ? null : targetUnit.getId();
    }
}
