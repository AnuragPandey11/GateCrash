package com.gatecrash.user;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface RefreshTokenRepository extends JpaRepository<RefreshToken, UUID> {

    Optional<RefreshToken> findByTokenHash(String tokenHash);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("""
           update RefreshToken t
              set t.revoked = true, t.revokedReason = :reason
            where t.userId = :userId and t.revoked = false
           """)
    int revokeAllForUser(@Param("userId") UUID userId, @Param("reason") String reason);

    /** Used on reuse detection: one replayed token invalidates every sibling in its chain. */
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("""
           update RefreshToken t
              set t.revoked = true, t.revokedReason = :reason
            where t.familyId = :familyId and t.revoked = false
           """)
    int revokeFamily(@Param("familyId") UUID familyId, @Param("reason") String reason);

    /** Housekeeping: expired rows carry no security value and would grow the table forever. */
    @Modifying
    @Query("delete from RefreshToken t where t.expiresAt < :cutoff")
    int deleteExpiredBefore(@Param("cutoff") OffsetDateTime cutoff);

    long countByUserIdAndRevokedFalse(UUID userId);
}
