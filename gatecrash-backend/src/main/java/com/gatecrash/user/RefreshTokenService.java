package com.gatecrash.user;

import com.gatecrash.common.audit.AuditAction;
import com.gatecrash.common.audit.AuditService;
import com.gatecrash.common.exception.UnauthorizedException;
import com.gatecrash.config.AppProperties;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.OffsetDateTime;
import java.util.Base64;
import java.util.UUID;

/**
 * Issues, rotates and revokes refresh tokens.
 *
 * <p>The token itself is 256 bits of {@link SecureRandom} rendered URL-safe, never a JWT: it must be
 * revocable the instant it is presented, which a self-contained token cannot be. Only its SHA-256 is
 * persisted, so the table is useless to anyone who reads it. Plain SHA-256 is the right primitive
 * here (rather than bcrypt): the input is already high-entropy random, so there is nothing to brute
 * force, and lookup has to be a single indexed read.
 *
 * <p>Rotation is one-time-use. Presenting a token that was already rotated means either a race or a
 * stolen token, and there is no safe way to tell which -- so the entire family is revoked and both
 * the legitimate user and the attacker are forced to re-authenticate.
 */
@Service
@RequiredArgsConstructor
public class RefreshTokenService {

    private static final Logger log = LoggerFactory.getLogger(RefreshTokenService.class);
    private static final int TOKEN_BYTES = 32;

    private final RefreshTokenRepository refreshTokens;
    private final RefreshTokenRevoker revoker;
    private final AppProperties properties;
    private final AuditService audit;
    private final SecureRandom random = new SecureRandom();

    /** Starts a new rotation family. Returns the plaintext token -- the only time it exists. */
    @Transactional
    public String issue(UUID userId) {
        return persist(userId, UUID.randomUUID());
    }

    /**
     * Validates and consumes a refresh token, returning the replacement.
     *
     * @throws UnauthorizedException if the token is unknown, expired, or already spent
     */
    @Transactional
    public Rotation rotate(String rawToken) {
        String hash = hash(rawToken);
        RefreshToken existing = refreshTokens.findByTokenHash(hash)
                .orElseThrow(() -> new UnauthorizedException("INVALID_REFRESH_TOKEN",
                        "Refresh token is invalid or expired."));

        OffsetDateTime now = OffsetDateTime.now();
        if (existing.isRevoked()) {
            // Replay of a spent token. Assume compromise and burn the whole chain.
            //
            // Both the revocation and the audit row run in their own transactions: this method is
            // about to throw, and anything enlisted in the current transaction would be rolled back
            // with it -- leaving the stolen token live.
            log.warn("Refresh token reuse detected for user {} (family {})",
                    existing.getUserId(), existing.getFamilyId());
            revoker.revokeFamilyNow(existing.getFamilyId(), "REUSE_DETECTED");
            audit.recordIsolated(existing.getUserId(), AuditAction.REFRESH_REUSE_DETECTED,
                    "refresh_token", existing.getId(),
                    AuditService.detail("familyId", existing.getFamilyId()));
            throw new UnauthorizedException("REFRESH_TOKEN_REUSED",
                    "Session has been invalidated. Sign in again.");
        }
        if (!existing.isUsable(now)) {
            throw new UnauthorizedException("INVALID_REFRESH_TOKEN",
                    "Refresh token is invalid or expired.");
        }

        existing.revoke("ROTATED");
        existing.setRotatedAt(now);
        refreshTokens.save(existing);

        String replacement = persist(existing.getUserId(), existing.getFamilyId());
        return new Rotation(existing.getUserId(), replacement);
    }

    @Transactional
    public void revokeAllForUser(UUID userId, String reason) {
        int revoked = refreshTokens.revokeAllForUser(userId, reason);
        if (revoked > 0) {
            log.info("Revoked {} refresh token(s) for user {} ({})", revoked, userId, reason);
        }
    }

    /** Best-effort single-session logout: an unknown token is not an error worth surfacing. */
    @Transactional
    public void revokeSingle(String rawToken, String reason) {
        if (rawToken == null || rawToken.isBlank()) {
            return;
        }
        refreshTokens.findByTokenHash(hash(rawToken)).ifPresent(token -> {
            if (!token.isRevoked()) {
                token.revoke(reason);
                refreshTokens.save(token);
            }
        });
    }

    @Transactional
    public int purgeExpired(OffsetDateTime cutoff) {
        return refreshTokens.deleteExpiredBefore(cutoff);
    }

    private String persist(UUID userId, UUID familyId) {
        byte[] bytes = new byte[TOKEN_BYTES];
        random.nextBytes(bytes);
        String rawToken = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);

        RefreshToken token = new RefreshToken();
        token.setUserId(userId);
        token.setFamilyId(familyId);
        token.setTokenHash(hash(rawToken));
        token.setExpiresAt(OffsetDateTime.now().plusDays(properties.jwt().refreshTtlDays()));
        refreshTokens.save(token);
        return rawToken;
    }

    private String hash(String rawToken) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return Base64.getEncoder().encodeToString(digest.digest(rawToken.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("SHA-256 is required but unavailable", ex);
        }
    }

    /** The user the rotated token belonged to, plus its replacement. */
    public record Rotation(UUID userId, String refreshToken) {
    }
}
