package com.gatecrash.security;

import com.gatecrash.config.AppProperties;
import com.gatecrash.user.UserRole;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.UUID;

/**
 * Issues and verifies the short-lived access token (HS256).
 *
 * <p>The token is a bearer credential with no server-side lookup on the hot path, so it carries
 * everything an authorization decision needs: {@code sub}, {@code role}, {@code loginId}, the
 * account's {@code tokenVersion} and the {@code mustResetPassword} flag. {@code tokenVersion} is what
 * makes revocation immediate -- see {@link JwtAuthFilter}.
 *
 * <p>Refresh tokens are deliberately <em>not</em> JWTs: they are opaque random strings stored hashed,
 * so they can be revoked individually and a database leak yields nothing usable.
 */
@Service
public class JwtService {

    public static final String CLAIM_ROLE = "role";
    public static final String CLAIM_LOGIN_ID = "loginId";
    public static final String CLAIM_TOKEN_VERSION = "tv";
    public static final String CLAIM_MUST_RESET = "mrp";
    public static final String CLAIM_TYPE = "typ";
    public static final String TYPE_ACCESS = "access";

    /** HS256 requires at least 256 bits of key material; anything shorter is rejected outright. */
    private static final int MIN_SECRET_BYTES = 32;

    private final SecretKey key;
    private final String issuer;
    private final Duration accessTtl;

    public JwtService(AppProperties properties) {
        byte[] secret = properties.jwt().secret().getBytes(StandardCharsets.UTF_8);
        if (secret.length < MIN_SECRET_BYTES) {
            throw new IllegalStateException(
                    "app.jwt.secret must be at least " + MIN_SECRET_BYTES + " bytes; got " + secret.length);
        }
        this.key = Keys.hmacShaKeyFor(secret);
        this.issuer = properties.jwt().issuer();
        this.accessTtl = Duration.ofMinutes(properties.jwt().accessTtlMin());
    }

    public String generateAccessToken(AppUserDetails user) {
        Instant now = Instant.now();
        return Jwts.builder()
                .id(UUID.randomUUID().toString())
                .issuer(issuer)
                .subject(user.getId().toString())
                .claim(CLAIM_ROLE, user.getRole().name())
                .claim(CLAIM_LOGIN_ID, user.getUsername())
                .claim(CLAIM_TOKEN_VERSION, user.getTokenVersion())
                .claim(CLAIM_MUST_RESET, user.isMustResetPassword())
                .claim(CLAIM_TYPE, TYPE_ACCESS)
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plus(accessTtl)))
                .signWith(key, Jwts.SIG.HS256)
                .compact();
    }

    /**
     * Verifies signature, issuer and expiry, and rejects anything that is not an access token.
     *
     * @throws JwtException if the token is missing, malformed, expired, or not ours
     */
    public AccessToken parseAccessToken(String token) {
        Claims claims = Jwts.parser()
                .verifyWith(key)
                .requireIssuer(issuer)
                .build()
                .parseSignedClaims(token)
                .getPayload();

        if (!TYPE_ACCESS.equals(claims.get(CLAIM_TYPE, String.class))) {
            throw new JwtException("Not an access token");
        }
        UUID userId;
        UserRole role;
        try {
            userId = UUID.fromString(claims.getSubject());
            role = UserRole.valueOf(claims.get(CLAIM_ROLE, String.class));
        } catch (IllegalArgumentException | NullPointerException ex) {
            throw new JwtException("Malformed token claims");
        }
        Integer tokenVersion = claims.get(CLAIM_TOKEN_VERSION, Integer.class);
        Boolean mustReset = claims.get(CLAIM_MUST_RESET, Boolean.class);
        return new AccessToken(userId, claims.get(CLAIM_LOGIN_ID, String.class), role,
                tokenVersion == null ? -1 : tokenVersion, Boolean.TRUE.equals(mustReset));
    }

    public Duration accessTtl() {
        return accessTtl;
    }

    /** Verified claims of an access token. */
    public record AccessToken(UUID userId, String loginId, UserRole role, int tokenVersion,
                              boolean mustResetPassword) {
    }
}
