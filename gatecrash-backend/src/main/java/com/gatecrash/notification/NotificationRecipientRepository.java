package com.gatecrash.notification;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.Optional;
import java.util.UUID;

public interface NotificationRecipientRepository extends JpaRepository<NotificationRecipient, UUID> {

    Page<NotificationRecipient> findByUserIdOrderByIdDesc(UUID userId, Pageable pageable);

    /**
     * The inbox, newest first. Ordered by the notification's creation time: the row id is a random
     * UUID, so ordering by it (as {@link #findByUserIdOrderByIdDesc} does) is no order at all.
     */
    @Query(value = """
           select r from NotificationRecipient r, Notification n
            where n.id = r.notificationId and r.userId = :userId
            order by n.createdAt desc, r.id desc
           """,
           countQuery = "select count(r) from NotificationRecipient r where r.userId = :userId")
    Page<NotificationRecipient> inboxOf(@Param("userId") UUID userId, Pageable pageable);

    @Modifying(clearAutomatically = true)
    @Query("update NotificationRecipient r set r.readAt = :now where r.userId = :userId and r.readAt is null")
    int markAllRead(@Param("userId") UUID userId, @Param("now") OffsetDateTime now);

    Optional<NotificationRecipient> findByIdAndUserId(UUID id, UUID userId);

    long countByUserIdAndReadAtIsNull(UUID userId);

    long countByNotificationIdAndDeliveredTrue(UUID notificationId);

    /** Marks the users whose devices FCM accepted; a single statement rather than N updates. */
    @Modifying(clearAutomatically = true)
    @Query("""
           update NotificationRecipient r
              set r.delivered = true
            where r.notificationId = :notificationId
              and r.userId in :userIds
           """)
    int markDelivered(@Param("notificationId") UUID notificationId,
                      @Param("userIds") Collection<UUID> userIds);
}
