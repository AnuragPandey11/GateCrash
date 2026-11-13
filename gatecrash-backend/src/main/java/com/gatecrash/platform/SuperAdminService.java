package com.gatecrash.platform;

import com.gatecrash.common.audit.AuditAction;
import com.gatecrash.common.audit.AuditService;
import com.gatecrash.common.exception.BusinessValidationException;
import com.gatecrash.common.exception.ConflictException;
import com.gatecrash.common.exception.NotFoundException;
import com.gatecrash.common.tenant.TenantContext;
import com.gatecrash.platform.dto.PlatformDtos.CreateSuperAdminRequest;
import com.gatecrash.platform.dto.PlatformDtos.SuperAdminResponse;
import com.gatecrash.security.SecurityUtils;
import com.gatecrash.township.Township;
import com.gatecrash.township.TownshipRepository;
import com.gatecrash.user.AppUser;
import com.gatecrash.user.AppUserRepository;
import com.gatecrash.user.PasswordGenerator;
import com.gatecrash.user.RefreshTokenService;
import com.gatecrash.user.UserMapper;
import com.gatecrash.user.UserProvisioningService;
import com.gatecrash.user.UserRole;
import com.gatecrash.user.dto.UserDtos.CreatedUserResponse;
import com.gatecrash.user.dto.UserDtos.ResetPasswordResponse;
import com.gatecrash.user.dto.UserDtos.UserResponse;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Locale;
import java.util.UUID;

/**
 * Accounts at the platform level: the super admins themselves, and the administrators of any
 * township.
 *
 * <p>Two invariants guard the platform against locking itself out, and both are worth stating
 * because neither is recoverable from inside the application:
 * <ul>
 *   <li>a super admin cannot deactivate their own account, and</li>
 *   <li>the last active super admin cannot be deactivated at all.</li>
 * </ul>
 * Without the second, a two-operator platform is one mistaken click away from having nobody able to
 * create a township, appoint an admin, or restore a suspended tenant -- a state whose only fix is a
 * hand-written UPDATE against production.
 */
@Service
@RequiredArgsConstructor
public class SuperAdminService {

    private static final Logger log = LoggerFactory.getLogger(SuperAdminService.class);

    private final AppUserRepository users;
    private final TownshipRepository townships;
    private final UserProvisioningService provisioning;
    private final RefreshTokenService refreshTokens;
    private final PasswordEncoder passwordEncoder;
    private final PasswordGenerator passwordGenerator;
    private final UserMapper mapper;
    private final AuditService audit;

    // ----- super admins -----------------------------------------------------------------------

    @PreAuthorize("hasRole('SUPER_ADMIN')")
    @Transactional(readOnly = true)
    public List<SuperAdminResponse> listSuperAdmins() {
        return users.findByTownshipIsNullOrderByFullNameAsc().stream()
                .map(this::toSuperAdmin)
                .toList();
    }

    /**
     * Creates a peer super admin. Not routed through {@code UserProvisioningService} because that
     * service is tenant-bound by construction -- it reads the township from {@code TenantContext} and
     * refuses to build an account without one, which is exactly the property that keeps it honest.
     * A tenantless account is a different thing and is built here, explicitly.
     */
    @PreAuthorize("hasRole('SUPER_ADMIN')")
    @Transactional
    public CreatedUserResponse createSuperAdmin(CreateSuperAdminRequest request) {
        String loginId = request.loginId().trim();
        if (users.existsByTownshipIsNullAndLoginId(loginId)) {
            throw new ConflictException("LOGIN_ID_TAKEN", "That login id is already in use.");
        }
        String phone = normalise(request.phone());
        String email = normalise(request.email());
        if (phone != null && users.existsByTownshipIsNullAndPhone(phone)) {
            throw new ConflictException("PHONE_TAKEN", "That phone number is already registered.");
        }
        if (email != null && users.existsByTownshipIsNullAndEmail(email)) {
            throw new ConflictException("EMAIL_TAKEN", "That email address is already registered.");
        }

        String generatedPassword = passwordGenerator.generate();

        AppUser user = new AppUser();
        user.setRole(UserRole.SUPER_ADMIN);
        user.setTownship(null);            // super_admin_is_tenantless makes this mandatory
        user.setLoginId(loginId);
        user.setFullName(request.fullName().trim());
        user.setPhone(phone);
        user.setEmail(email);
        user.setPasswordHash(passwordEncoder.encode(generatedPassword));
        user.setMustResetPassword(true);
        user.setActive(true);
        user.setCreatedBy(SecurityUtils.currentUserId());
        users.saveAndFlush(user);

        audit.record(AuditAction.SUPER_ADMIN_PROVISIONED, "app_user", user.getId(),
                AuditService.detail("loginId", loginId));
        log.warn("Super admin {} ({}) provisioned by {}",
                user.getId(), loginId, SecurityUtils.currentUserId());

        return new CreatedUserResponse(user.getId(), user.getLoginId(), user.getFullName(),
                user.getRole(), false, null, generatedPassword);
    }

    @PreAuthorize("hasRole('SUPER_ADMIN')")
    @Transactional
    public SuperAdminResponse setSuperAdminActive(UUID userId, boolean active) {
        AppUser user = requireSuperAdmin(userId);
        if (user.isActive() == active) {
            return toSuperAdmin(user);
        }
        if (!active) {
            requireNotLastSuperAdmin(userId);
        }

        user.setActive(active);
        if (!active) {
            user.bumpTokenVersion();
        }
        users.save(user);
        if (!active) {
            refreshTokens.revokeAllForUser(userId, "ACCOUNT_DEACTIVATED");
        }

        audit.record(active ? AuditAction.USER_REACTIVATED : AuditAction.SUPER_ADMIN_REMOVED,
                "app_user", userId, null);
        log.warn("Super admin {} set active={} by {}", userId, active, SecurityUtils.currentUserId());
        return toSuperAdmin(user);
    }

    @PreAuthorize("hasRole('SUPER_ADMIN')")
    @Transactional
    public ResetPasswordResponse resetSuperAdminPassword(UUID userId) {
        AppUser user = requireSuperAdmin(userId);

        String generatedPassword = passwordGenerator.generate();
        user.setPasswordHash(passwordEncoder.encode(generatedPassword));
        user.setMustResetPassword(true);
        user.bumpTokenVersion();
        users.save(user);
        refreshTokens.revokeAllForUser(userId, "PASSWORD_RESET");

        audit.record(AuditAction.USER_PASSWORD_RESET, "app_user", userId, null);
        return new ResetPasswordResponse(user.getId(), user.getLoginId(), generatedPassword);
    }

    // ----- township administrators --------------------------------------------------------------

    @PreAuthorize("hasRole('SUPER_ADMIN')")
    @Transactional(readOnly = true)
    public List<UserResponse> listTownshipAdmins(UUID townshipId) {
        requireTownship(townshipId);
        return users.findByTownship_IdAndRoleOrderByFullNameAsc(townshipId, UserRole.ADMIN).stream()
                .map(mapper::toResponse)
                .toList();
    }

    /**
     * Removes a township's administrator -- deactivation, not deletion, exactly as
     * {@code UserService.setActive} does. Their name still has to resolve on every visit they ever
     * approved.
     *
     * <p>The last active admin of a township cannot be removed this way. A township with no admin
     * cannot provision a guard, a resident or a replacement admin, and nobody inside it can fix that;
     * appointing the replacement first is one extra call and removes an entire class of support
     * ticket.
     */
    @PreAuthorize("hasRole('SUPER_ADMIN')")
    @Transactional
    public UserResponse removeTownshipAdmin(UUID townshipId, UUID userId) {
        requireTownship(townshipId);
        AppUser admin = users.findByIdAndTownship_Id(userId, townshipId)
                .orElseThrow(() -> NotFoundException.of("User", userId));
        if (admin.getRole() != UserRole.ADMIN) {
            throw new BusinessValidationException("NOT_A_TOWNSHIP_ADMIN",
                    "That account is not an administrator of this township.");
        }
        if (admin.isActive()
                && users.countByTownship_IdAndRoleAndActiveTrue(townshipId, UserRole.ADMIN) <= 1) {
            throw new ConflictException("LAST_TOWNSHIP_ADMIN",
                    "Appoint another administrator before removing the last one.");
        }

        admin.setActive(false);
        admin.bumpTokenVersion();
        users.save(admin);
        refreshTokens.revokeAllForUser(userId, "ADMIN_REMOVED");

        audit.recordForTownship(townshipId, AuditAction.TOWNSHIP_ADMIN_REMOVED, "app_user", userId,
                AuditService.detail("loginId", admin.getLoginId()));
        log.warn("Township {} admin {} removed by super admin {}",
                townshipId, userId, SecurityUtils.currentUserId());
        return mapper.toResponse(admin);
    }

    /** Reissues a township admin's password, for the support case where they are locked out. */
    @PreAuthorize("hasRole('SUPER_ADMIN')")
    @Transactional
    public ResetPasswordResponse resetTownshipAdminPassword(UUID townshipId, UUID userId) {
        requireTownship(townshipId);
        // Borrowing the tenant context reuses the ordinary reset path -- including its tenant-scoped
        // lookup -- rather than growing a second, subtly different implementation of it here.
        return TenantContext.callAs(townshipId, () -> provisioning.resetPassword(userId));
    }

    // ----- internals --------------------------------------------------------------------------

    private AppUser requireSuperAdmin(UUID userId) {
        AppUser user = users.findByIdAndTownshipIsNull(userId)
                .orElseThrow(() -> NotFoundException.of("Super admin", userId));
        if (user.getRole() != UserRole.SUPER_ADMIN) {
            throw NotFoundException.of("Super admin", userId);
        }
        return user;
    }

    private void requireNotLastSuperAdmin(UUID userId) {
        if (userId.equals(SecurityUtils.currentUserId())) {
            throw new BusinessValidationException("CANNOT_DEACTIVATE_SELF",
                    "You cannot deactivate your own account.");
        }
        if (users.countByTownshipIsNullAndActiveTrue() <= 1) {
            throw new ConflictException("LAST_SUPER_ADMIN",
                    "The platform must keep at least one active super admin.");
        }
    }

    private Township requireTownship(UUID townshipId) {
        return townships.findById(townshipId)
                .orElseThrow(() -> NotFoundException.of("Township", townshipId));
    }

    private SuperAdminResponse toSuperAdmin(AppUser user) {
        return new SuperAdminResponse(user.getId(), user.getLoginId(), user.getFullName(),
                user.getPhone(), user.getEmail(), user.isActive(), user.isMustResetPassword(),
                user.getCreatedAt());
    }

    private String normalise(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        return value.trim().toLowerCase(Locale.ROOT);
    }
}
