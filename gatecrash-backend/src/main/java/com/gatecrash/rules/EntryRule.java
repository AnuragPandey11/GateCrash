package com.gatecrash.rules;

import com.gatecrash.property.PropertyNode;
import com.gatecrash.user.AppUser;
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
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.annotations.UuidGenerator;
import org.hibernate.type.SqlTypes;

import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * A society rule: "let this kind of visitor into my home without asking me" (V10).
 *
 * <p>Requested by a resident, decided by the society office. While APPROVED, in date and inside
 * its daily window, a walk-in the guard logs for {@link #unit} that matches it is approved on the
 * spot. It belongs to the home, not to the resident who asked.
 */
@Entity
@Table(name = "entry_rule")
@Getter
@Setter
@NoArgsConstructor
public class EntryRule {

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "township_id", nullable = false, updatable = false)
    private UUID townshipId;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "unit_id", nullable = false, updatable = false)
    private PropertyNode unit;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "requested_by", nullable = false, updatable = false)
    private AppUser requestedBy;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    @Column(name = "visitor_type", nullable = false, columnDefinition = "visitor_type")
    private VisitorType visitorType;

    @Column(name = "label", nullable = false)
    private String label;

    /** Matched case-insensitively against the walk-in's name and purpose. Null = any of the type. */
    @Column(name = "match_text")
    private String matchText;

    @Column(name = "visitor_phone")
    private String visitorPhone;

    @Column(name = "allowed_from")
    private LocalTime allowedFrom;

    @Column(name = "allowed_to")
    private LocalTime allowedTo;

    @Column(name = "valid_until")
    private OffsetDateTime validUntil;

    @Column(name = "note")
    private String note;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    @Column(name = "status", nullable = false, columnDefinition = "entry_rule_status")
    private EntryRuleStatus status = EntryRuleStatus.PENDING;

    @Column(name = "admin_note")
    private String adminNote;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "decided_by")
    private AppUser decidedBy;

    @Column(name = "decided_at")
    private OffsetDateTime decidedAt;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    @Version
    @Column(name = "version", nullable = false)
    private long version;
}
