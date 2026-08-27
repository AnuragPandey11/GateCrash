package com.gatecrash.user;

import com.gatecrash.common.audit.AuditAction;
import com.gatecrash.common.audit.AuditService;
import com.gatecrash.common.exception.BusinessValidationException;
import com.gatecrash.common.exception.ForbiddenException;
import com.gatecrash.common.exception.NotFoundException;
import com.gatecrash.common.exception.UnauthorizedException;
import com.gatecrash.security.AppUserDetails;
import com.gatecrash.security.JwtService;
import com.gatecrash.security.LoginAttemptService;
import com.gatecrash.security.SecurityUtils;
import com.gatecrash.township.Township;
import com.gatecrash.township.TownshipRepository;
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

import java.util.Locale;
import java.util.UUID;

/**
 * Login, refresh, password change and logout.
 *
 * <p><b>Login is {@code (townshipCode, loginId, password)}.</b> The code is not decoration: login ids
 * are unique only within a township, so resolving one without a township would either return an
 * arbitrary tenant's account or require a cross-tenant scan -- the first is an authentication bug and
 * the second is an enumeration oracle. A {@code SUPER_ADMIN} omits the code and is resolved in the
 * tenantless platform namespace instead.
 *
 * <p>Every failure path out of {@link #login} returns the same error with the same message, and does
 * the same amount of work: a missing account, an unknown township code and a wrong password all still
 * pay for one bcrypt comparison against a dummy hash. Both are necessary -- a distinguishable message
 * or a measurably faster rejection would let an attacker enumerate which townships exist and which
 * flats have registered residents before ever guessing a password.
 *
 * <p>The one deliberate exception is a <em>suspended or archived township</em>, which is reported
 * plainly. It is only reachable after the credentials have already verified, so it discloses nothing
 * an attacker did not already hold -- and returning "invalid credentials" to an entire township whose
 * account is merely suspended would send every resident chasing a password problem they do not have.
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
    private final TownshipRepository townships;
    private final PasswordEncoder passwordEncoder;
    private final PasswordPolicy passwordPolicy;
    private final JwtService jwtService;
    private final RefreshTokenService refreshTokens;
    private final LoginAttemptService loginAttempts;
    private final AuditService audit;

    @Transactional
    public LoginResponse login(LoginRequest request, String clientAddress) {
        String loginId = request.loginId().trim();
        String townshipCode = normaliseCode(request.townshipCode());

        // The throttle budget is per (township, login id). Keying it on the login id alone would let
        // failures against one township's "A-101-1" lock out the unrelated account of the same name
        // in every other township on the platform.
        String attemptKey = attemptKey(townshipCode, loginId);
        loginAttempts.assertNotLockedOut(attemptKey, clientAddress);

        Township township = townshipCode == null ? null : townships.findByCode(townshipCode).orElse(null);
        AppUser user = resolveAccount(township, townshipCode, loginId);

        // Note the ordering: the password is verified even when the township, the account or the
        // active flag is missing, so all of those outcomes cost the same and are indistinguishable.
        boolean passwordMatches = passwordEncoder.matches(
                request.password(), user == null ? DUMMY_HASH : user.getPasswordHash());

        if (user == null || !user.isActive() || !passwordMatches) {
            onFailedLogin(attemptKey, clientAddress, user,
                    township == null ? null : township.getId());
            throw UnauthorizedException.invalidCredentials();
        }

        // Reached only with valid credentials in hand, which is what makes a specific answer safe.
        if (township != null && !township.isActive()) {
            audit.recordIsolated(user.getId(), township.getId(), AuditAction.LOGIN_FAILED, "app_user",
                    user.getId(), AuditService.detail("reason", "TOWNSHIP_" + township.getStatus()));
            log.warn("Login refused for user {}: township {} is {}",
                    user.getId(), township.getId(), township.getStatus());
            throw new ForbiddenException("TOWNSHIP_INACTIVE",
                    "This township is not currently active. Contact your administrator.");
        }

        loginAttempts.recordSuccess(attemptKey, clientAddress);
        audit.recordIsolated(user.getId(), user.getTownshipId(), AuditAction.LOGIN_SUCCEEDED,
                "app_user", user.getId(),
                AuditService.detail("loginId", loginId, "role", user.getRole(),
                        "townshipCode", townshipCode));
        log.info("Login succeeded for user {} ({}) in township {}",
                user.getId(), user.getRole(), user.getTownshipId());

        return issueTokens(user, TownshipSummary.of(township));
    }

    /**
     * Two namespaces, chosen by whether a township code was supplied.
     *
     * <p>An unknown code returns null rather than a 404 on purpose: "no such township" would let
     * anyone enumerate the platform's customer list from the login form.
     */
    private AppUser resolveAccount(Township township, String townshipCode, String loginId) {
        if (townshipCode == null) {
            return users.findByTownshipIsNullAndLoginId(loginId).orElse(null);
        }
        if (township == null) {
            return null;
        }
        return users.findByTownship_IdAndLoginId(township.getId(), loginId).orElse(null);
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

        Township township = user.getTownship();
        if (township != null && !township.isActive()) {
            // A township suspended mid-session must not be able to refresh its way back in.
            refreshTokens.revokeAllForUser(user.getId(), "TOWNSHIP_INACTIVE");
            throw new ForbiddenException("TOWNSHIP_INACTIVE",
                    "This township is not currently active. Contact your administrator.");
        }

        audit.recordIsolated(user.getId(), user.getTownshipId(), AuditAction.REFRESH_ROTATED,
                "app_user", user.getId(), null);
        return buildResponse(AppUserDetails.from(user), user.getFullName(),
                TownshipSummary.of(township), jwtService.generateAccessToken(AppUserDetails.from(user)),
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

        // Snapshot the principal and its township *before* revoking. The revoke is a bulk
        // @Modifying(clearAutomatically = true) statement, which detaches everything in the
        // persistence context -- including the lazily mapped township this response needs to read.
        AppUserDetails principal = AppUserDetails.from(user);
        String fullName = user.getFullName();
        TownshipSummary township = TownshipSummary.of(user.getTownship());

        refreshTokens.revokeAllForUser(userId, "PASSWORD_CHANGED");
        audit.record(AuditAction.USER_PASSWORD_CHANGED, "app_user", userId, null);
        log.info("Password changed for user {}", userId);

        return buildResponse(principal, fullName, township,
                jwtService.generateAccessToken(principal), refreshTokens.issue(userId));
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
        Township township = user.getTownship();
        return new MeResponse(
                user.getId(),
                user.getLoginId(),
                user.getFullName(),
                user.getRole(),
                user.isMustResetPassword(),
                user.isOnDuty(),
                user.getFlatId(),
                user.getUnit() == null ? null : user.getUnit().getCode(),
                user.getUnit() == null ? null : user.getUnit().containerName(),
                township == null ? null : township.getId(),
                township == null ? null : township.getCode(),
                township == null ? null : township.getName());
    }

    private void onFailedLogin(String attemptKey, String clientAddress, AppUser user, UUID townshipId) {
        loginAttempts.recordFailure(attemptKey, clientAddress);
        UUID actorId = user == null ? null : user.getId();
        String action = loginAttempts.isLockedOut(attemptKey)
                ? AuditAction.LOGIN_LOCKED_OUT
                : AuditAction.LOGIN_FAILED;
        // Isolated so the record survives regardless of what the caller's transaction does.
        audit.recordIsolated(actorId, townshipId, action, "app_user", actorId,
                AuditService.detail("attemptKey", attemptKey, "clientAddress", clientAddress));
        log.warn("Failed login for '{}' from {}", attemptKey, clientAddress);
    }

    private LoginResponse issueTokens(AppUser user, TownshipSummary township) {
        AppUserDetails principal = AppUserDetails.from(user);
        return buildResponse(principal, user.getFullName(), township,
                jwtService.generateAccessToken(principal), refreshTokens.issue(user.getId()));
    }

    private LoginResponse buildResponse(AppUserDetails principal, String fullName,
                                        TownshipSummary township, String accessToken,
                                        String refreshToken) {
        return new LoginResponse(
                accessToken,
                refreshToken,
                "Bearer",
                jwtService.accessTtl().toSeconds(),
                principal.isMustResetPassword(),
                principal.getRole(),
                principal.getId(),
                fullName,
                township.id(),
                township.code(),
                township.name());
    }

    /**
     * The township fields the login response echoes back, read eagerly.
     *
     * <p>Carried as a detached value rather than as the entity because the calls between loading the
     * account and building the response include bulk updates that clear the persistence context --
     * after which reading a lazily mapped association throws. Copying three strings is cheaper than
     * reasoning about which of those calls does that today and which will tomorrow.
     */
    private record TownshipSummary(UUID id, String code, String name) {

        /** Null in, empty out: a SUPER_ADMIN legitimately has no township. */
        private static TownshipSummary of(Township township) {
            return township == null
                    ? new TownshipSummary(null, null, null)
                    : new TownshipSummary(township.getId(), township.getCode(), township.getName());
        }
    }

    /** Codes are stored upper case; a resident typing theirs in lower case must still get in. */
    private String normaliseCode(String code) {
        if (code == null || code.isBlank()) {
            return null;
        }
        return code.trim().toUpperCase(Locale.ROOT);
    }

    /** Namespaces the throttle budget so one township's failures cannot lock out another's. */
    private String attemptKey(String townshipCode, String loginId) {
        return (townshipCode == null ? "@platform" : townshipCode) + "/" + loginId;
    }
}
