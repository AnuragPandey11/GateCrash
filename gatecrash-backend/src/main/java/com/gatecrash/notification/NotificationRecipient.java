package com.gatecrash.notification;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.UuidGenerator;

import java.time.OffsetDateTime;
import java.util.UUID;

/** The materialised fan-out: one row per user per notification, carrying the read receipt. */
@Entity
@Table(name = "notification_recipient",
        uniqueConstraints = @UniqueConstraint(columnNames = {"notification_id", "user_id"}))
@Getter
@Setter
@NoArgsConstructor
public class NotificationRecipient {

    @Id
    @UuidGenerator
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "notification_id", nullable = false, updatable = false)
    private UUID notificationId;

    @Column(name = "user_id", nullable = false, updatable = false)
    private UUID userId;

    /** Whether FCM accepted at least one device for this user -- not proof the user saw it. */
    @Column(name = "delivered", nullable = false)
    private boolean delivered = false;

    @Column(name = "read_at")
    private OffsetDateTime readAt;
}
