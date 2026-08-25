package com.gatecrash.common.audit;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UuidGenerator;
import org.hibernate.type.SqlTypes;

import java.time.OffsetDateTime;
import java.util.Map;
import java.util.UUID;

/** Append-only trail. Rows are never updated or deleted by application code. */
@Entity
@Table(name = "audit_log")
@Getter
@Setter
@NoArgsConstructor
public class AuditLog {

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    /** Null for system-initiated actions such as the scheduled expiry sweeps. */
    @Column(name = "actor_id")
    private UUID actorId;

    /**
     * The tenant the action happened in. Null only for platform-level actions -- a super admin
     * creating or archiving a township acts on the platform, not inside one.
     */
    @Column(name = "township_id")
    private UUID townshipId;

    @Column(name = "action", nullable = false, updatable = false)
    private String action;

    @Column(name = "entity", nullable = false, updatable = false)
    private String entity;

    @Column(name = "entity_id")
    private UUID entityId;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "detail")
    private Map<String, Object> detail;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;
}
