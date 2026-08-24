package com.gatecrash.notification;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.Optional;
import java.util.UUID;

public interface NotificationRecipientRepository extends JpaRepository<NotificationRecipient, UUID> {

    Page<NotificationRecipient> findByUserIdOrderByIdDesc(UUID userId, Pageable pageable);

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
