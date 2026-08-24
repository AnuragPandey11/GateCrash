package com.gatecrash.device;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface DeviceRepository extends JpaRepository<Device, UUID> {

    Optional<Device> findByFcmToken(String fcmToken);

    List<Device> findByUserId(UUID userId);

    long countByUserId(UUID userId);

    @Query("select d.fcmToken from Device d where d.userId = :userId")
    List<String> findTokensByUserId(@Param("userId") UUID userId);

    /** Fan-out lookup. Callers must chunk {@code userIds} -- see {@code NotificationService}. */
    @Query("select d.fcmToken from Device d where d.userId in :userIds")
    List<String> findTokensByUserIds(@Param("userIds") Collection<UUID> userIds);

    /** Token hygiene: FCM told us these registrations are dead. */
    @Modifying(clearAutomatically = true)
    @Query("delete from Device d where d.fcmToken in :tokens")
    int deleteByTokens(@Param("tokens") Collection<String> tokens);

    @Modifying
    @Query("delete from Device d where d.userId = :userId")
    int deleteAllForUser(@Param("userId") UUID userId);
}
