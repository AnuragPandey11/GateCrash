package com.gatecrash.user;

import com.gatecrash.common.audit.AuditAction;
import com.gatecrash.common.audit.AuditService;
import com.gatecrash.common.exception.BusinessValidationException;
import com.gatecrash.common.exception.NotFoundException;
import com.gatecrash.common.exception.UnauthorizedException;
import com.gatecrash.security.AppUserDetails;
import com.gatecrash.security.JwtService;
import com.gatecrash.security.LoginAttemptService;
import com.gatecrash.security.SecurityUtils;
import com.gatecrash.user.dto.AuthDtos.ChangePasswordRequest;
import com.gatecrash.user.dto.AuthDtos.LoginRequest;
import com.gatecrash.user.dto.AuthDtos.LoginResponse;
import com.gatecrash.user.dto.AuthDtos.MeResponse;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

/**
 * Login, refresh, password change and logout.
 *
 * <p>Every failure path out of {@link #login} returns the same error with the same message, and does
 * the same amount of work: a missing account still pays for one bcrypt comparison against a dummy
 * hash. Both are necessary -- a distinguishable message or a measurably faster rejection would let an
 * attacker enumerate which flats have registered residents before ever guessing a password.
 */
@Service
@RequiredArgsConstructor
public class AuthService {

    private static final Logger log = LoggerFactory.getLogger(AuthService.class);

    /**
     * A real bcrypt digest of a value nobody knows, used to keep the "no such account" path as
     * expensive as the "wrong password" path.
     */
    private static final String DUMMY_HASH =
            "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

    private final AppUserRepository users;
    private final PasswordEncoder passwordEncoder;
    private final PasswordPolicy passwordPolicy;
    private final JwtService jwtService;
    private final RefreshTokenService refreshTokens;
    private final LoginAttemptService loginAttempts;
    private final AuditService audit;

    @Transactional
    public LoginResponse login(LoginRequest request, String clientAddress) {
        String loginId = request.loginId().trim();
        loginAttempts.assertNotLockedOut(loginId, clientAddress);

        AppUser user = users.findByLoginId(loginId).orElse(null);

        // Note the ordering: the password is verified even when the account is missing or inactive,
        // so all three outcomes cost the same and are indistinguishable from outside.
        boolean passwordMatches = passwordEncoder.matches(
                request.password(), user == null ? DUMMY_HASH : user.getPasswordHash());

        if (user == null || !user.isActive() || !passwordMatches) {
            onFailedLogin(loginId, clientAddress, user);
            throw UnauthorizedException.invalidCredentials();
        }

        loginAttempts.recordSuccess(loginId, clientAddress);
        audit.record(AuditAction.LOGIN_SUCCEEDED, "app_user", user.getId(),
                AuditService.detail("loginId", loginId, "role", user.getRole()));
        log.info("Login succeeded for user {} ({})", user.getId(), user.getRole());

        return issueTokens(user);
    }

    @Transactional
    public LoginResponse refresh(String rawRefreshToken) {
        RefreshTokenService.Rotation rotation = refreshTokens.rotate(rawRefreshToken);
        AppUser user = users.findById(rotation.userId())
                .orElseThrow(UnauthorizedException::invalidCredentials);

        if (!user.isActive()) {
            // The account was disabled while the session was alive; drop every token it holds.
            refreshTokens.revokeAllForUser(user.getId(), "ACCOUNT_DEACTIVATED");
            throw new UnauthorizedException("ACCOUNT_DISABLED", "This account is inactive.");
        }

        audit.record(AuditAction.REFRESH_ROTATED, "app_user", user.getId(), null);
        return buildResponse(user, jwtService.generateAccessToken(AppUserDetails.from(user)),
                rotation.refreshToken());
    }

    /**
     * Changing a password ends every other session for the account: outstanding refresh tokens are
     * revoked and {@code tokenVersion} is bumped, which invalidates already-issued access tokens on
     * their next request. The caller gets a fresh pair back so it is not logged out of its own device.
     */
    @Transactional
    public LoginResponse changePassword(ChangePasswordRequest request) {
        UUID userId = SecurityUtils.currentUserId();
        AppUser user = users.findById(userId)
                .orElseThrow(() -> NotFoundException.of("User", userId));

        if (!passwordEncoder.matches(request.currentPassword(), user.getPasswordHash())) {
            log.warn("Failed password change for user {}: current password mismatch", userId);
            throw new UnauthorizedException("INVALID_CREDENTIALS", "Current password is incorrect.");
        }
        if (passwordEncoder.matches(request.newPassword(), user.getPasswordHash())) {
            throw new BusinessValidationException(
                    "PASSWORD_REUSED", "New password must be different from the current one.");
        }
        passwordPolicy.validate(request.newPassword(), user.getLoginId(), user.getFullName());

        user.setPasswordHash(passwordEncoder.encode(request.newPassword()));
        user.setMustResetPassword(false);
        user.bumpTokenVersion();
        users.save(user);

        refreshTokens.revokeAllForUser(userId, "PASSWORD_CHANGED");
        audit.record(AuditAction.USER_PASSWORD_CHANGED, "app_user", userId, null);
        log.info("Password changed for user {}", userId);

        return issueTokens(user);
    }

    @Transactional
    public void logout(String rawRefreshToken) {
        UUID userId = SecurityUtils.currentUserId();
        if (rawRefreshToken != null && !rawRefreshToken.isBlank()) {
            refreshTokens.revokeSingle(rawRefreshToken, "LOGOUT");
        } else {
            // No token supplied: fail safe by ending every session for this account.
            refreshTokens.revokeAllForUser(userId, "LOGOUT_ALL");
        }
        audit.record(AuditAction.LOGOUT, "app_user", userId, null);
    }

    @Transactional(readOnly = true)
    public MeResponse me() {
        UUID userId = SecurityUtils.currentUserId();
        AppUser user = users.findById(userId)
                .orElseThrow(() -> NotFoundException.of("User", userId));
        return new MeResponse(
                user.getId(),
                user.getLoginId(),
                user.getFullName(),
                user.getRole(),
                user.isMustResetPassword(),
                user.isOnDuty(),
                user.getFlatId(),
                user.getFlat() == null ? null : user.getFlat().getNumber(),
                user.getFlat() == null ? null : user.getFlat().getBlock().getName());
    }

    private void onFailedLogin(String loginId, String clientAddress, AppUser user) {
        loginAttempts.recordFailure(loginId, clientAddress);
        UUID actorId = user == null ? null : user.getId();
        String action = loginAttempts.isLockedOut(loginId)
                ? AuditAction.LOGIN_LOCKED_OUT
                : AuditAction.LOGIN_FAILED;
        // Isolated so the record survives regardless of what the caller's transaction does.
        audit.recordIsolated(actorId, action, "app_user", actorId,
                AuditService.detail("loginId", loginId, "clientAddress", clientAddress));
        log.warn("Failed login for '{}' from {}", loginId, clientAddress);
    }

    private LoginResponse issueTokens(AppUser user) {
        String accessToken = jwtService.generateAccessToken(AppUserDetails.from(user));
        String refreshToken = refreshTokens.issue(user.getId());
        return buildResponse(user, accessToken, refreshToken);
    }

    private LoginResponse buildResponse(AppUser user, String accessToken, String refreshToken) {
        return new LoginResponse(
                accessToken,
                refreshToken,
                "Bearer",
                jwtService.accessTtl().toSeconds(),
                user.isMustResetPassword(),
                user.getRole(),
                user.getId(),
                user.getFullName());
    }
}
