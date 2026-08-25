package com.gatecrash.notification;

import com.gatecrash.notification.dto.NotificationDtos.AudienceRule;
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
import org.hibernate.annotations.UuidGenerator;
import org.hibernate.type.SqlTypes;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * A targeted broadcast.
 *
 * <p>The audience rule is stored as JSONB rather than normalised: targeting shapes change often
 * ("everyone in towers 3 and 4", "sales only") and each new shape would otherwise be a migration.
 * The resolved recipients are still materialised into {@code notification_recipient}, so the audit
 * trail and read receipts do not depend on being able to re-evaluate the rule later -- which matters,
 * because re-running a FLATS rule a month on would resolve to a different set of people.
 */
@Entity
@Table(name = "notification")
@Getter
@Setter
@NoArgsConstructor
public class Notification {

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    /**
     * The tenant this broadcast targets. Stored as a plain id rather than an association because the
     * author may be a super admin acting inside the township, whose own {@code township_id} is null.
     */
    @Column(name = "township_id", nullable = false, updatable = false)
    private UUID townshipId;

    @Column(name = "author_id", nullable = false, updatable = false)
    private UUID authorId;

    @Column(name = "title", nullable = false)
    private String title;

    @Column(name = "body", nullable = false)
    private String body;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "audience_rule", nullable = false)
    private AudienceRule audienceRule;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    @Column(name = "status", nullable = false, columnDefinition = "notif_status")
    private NotifStatus status = NotifStatus.QUEUED;

    @Column(name = "recipient_cnt", nullable = false)
    private int recipientCount = 0;

    @Column(name = "sent_at")
    private OffsetDateTime sentAt;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;
}
