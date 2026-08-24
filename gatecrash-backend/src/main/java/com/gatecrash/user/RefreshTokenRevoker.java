package com.gatecrash.user;

import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

/**
 * Revocations that must survive the rollback of the operation that triggered them.
 *
 * <p>Reuse detection is the motivating case: {@code RefreshTokenService.rotate} discovers a replayed
 * token, revokes the family, then throws 401. If the revocation shared that transaction it would roll
 * back with the exception -- the attacker would get an error, the family would stay live, and the
 * stolen token would keep working. That is a security hole with a passing-looking test.
 *
 * <p>It lives in its own bean because a {@code REQUIRES_NEW} annotation on a method called from
 * {@code this} is silently ignored: self-invocation bypasses the Spring proxy.
 */
@Service
@RequiredArgsConstructor
public class RefreshTokenRevoker {

    private static final Logger log = LoggerFactory.getLogger(RefreshTokenRevoker.class);

    private final RefreshTokenRepository refreshTokens;

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void revokeFamilyNow(UUID familyId, String reason) {
        int revoked = refreshTokens.revokeFamily(familyId, reason);
        log.warn("Revoked {} token(s) in family {} ({})", revoked, familyId, reason);
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void revokeAllForUserNow(UUID userId, String reason) {
        int revoked = refreshTokens.revokeAllForUser(userId, reason);
        if (revoked > 0) {
            log.info("Revoked {} refresh token(s) for user {} ({})", revoked, userId, reason);
        }
    }
}
