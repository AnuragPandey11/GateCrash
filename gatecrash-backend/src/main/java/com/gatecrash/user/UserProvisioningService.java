package com.gatecrash.user;

import com.gatecrash.common.audit.AuditAction;
import com.gatecrash.common.audit.AuditService;
import com.gatecrash.common.exception.BusinessValidationException;
import com.gatecrash.common.exception.ConflictException;
import com.gatecrash.common.exception.ForbiddenException;
import com.gatecrash.common.exception.NotFoundException;
import com.gatecrash.common.tenant.TenantContext;
import com.gatecrash.security.SecurityUtils;
import com.gatecrash.township.Flat;
import com.gatecrash.township.FlatRepository;
import com.gatecrash.township.TownshipRepository;
import com.gatecrash.user.dto.UserDtos.CreateUserRequest;
import com.gatecrash.user.dto.UserDtos.CreatedUserResponse;
import com.gatecrash.user.dto.UserDtos.ResetPasswordResponse;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

/**
 * The only path by which an account comes into existence.
 *
 * <p>There is no registration endpoint and no OTP: an admin creates the account, the server generates
 * the password, and the plaintext is returned exactly once in the creation response for the admin to
 * hand over. It is never stored, never logged, and cannot be retrieved again -- a lost password is a
 * reset, not a lookup.
 *
 * <p>Accounts land in {@link TenantContext}'s township, never in one named by the request. Two roles
 * are refused here regardless of context and have their own paths:
 * <ul>
 *   <li>{@code ADMIN} -- only a super admin appoints a township's administrator, because that is the
 *       account with authority over every other account in the township. An admin who could mint
 *       further admins would make the platform operator's control over the tenant advisory.</li>
 *   <li>{@code SUPER_ADMIN} -- belongs to no township at all, so there is no tenant to create it in.
 *       {@code SuperAdminService} owns that.</li>
 * </ul>
 */
@Service
@RequiredArgsConstructor
public class UserProvisioningService {

    private static final Logger log = LoggerFactory.getLogger(UserProvisioningService.class);

    private final AppUserRepository users;
    private final FlatRepository flats;
    private final TownshipRepository townships;
    private final PasswordEncoder passwordEncoder;
    private final PasswordGenerator passwordGenerator;
    private final AuditService audit;

    @PreAuthorize("hasRole('ADMIN')")
    @Transactional
    public CreatedUserResponse createUser(CreateUserRequest request) {
        UUID townshipId = TenantContext.requireTownshipId();
        requireRoleIsProvisionable(request.role());

        AppUser user = new AppUser();
        user.setTownship(townships.getReferenceById(townshipId));
        user.setRole(request.role());
        user.setFullName(request.fullName().trim());
        user.setCreatedBy(SecurityUtils.currentUserId());

        if (request.role() == UserRole.RESIDENT) {
            applyResidentIdentity(user, request, townshipId);
        } else {
            applyStaffIdentity(user, request, townshipId);
        }

        assignContactDetails(user, townshipId, request.phone(), request.email());

        String generatedPassword = passwordGenerator.generate();
        user.setPasswordHash(passwordEncoder.encode(generatedPassword));
        user.setMustResetPassword(true);
        user.setActive(true);

        try {
            users.saveAndFlush(user);
        } catch (DataIntegrityViolationException ex) {
            // The unique index is the backstop behind the flat row lock; surface it as a clean 409.
            log.warn("Provisioning conflict for login id {} in township {}",
                    user.getLoginId(), townshipId);
            throw new ConflictException("LOGIN_ID_TAKEN",
                    "That login id is already in use. Retry the request.");
        }

        audit.record(AuditAction.USER_PROVISIONED, "app_user", user.getId(),
                AuditService.detail("loginId", user.getLoginId(), "role", user.getRole()));
        log.info("Provisioned {} account {} ({}) in township {}",
                user.getRole(), user.getId(), user.getLoginId(), townshipId);

        return new CreatedUserResponse(user.getId(), user.getLoginId(), user.getFullName(),
                user.getRole(), townshipId, generatedPassword);
    }

    /**
     * Issues a new generated password and forces a change on next login. Every existing session for
     * the account dies immediately: refresh tokens are revoked by the caller, and the token-version
     * bump invalidates outstanding access tokens.
     */
    @PreAuthorize("hasRole('ADMIN')")
    @Transactional
    public ResetPasswordResponse resetPassword(UUID userId) {
        AppUser user = requireUserInTenant(userId);

        String generatedPassword = passwordGenerator.generate();
        user.setPasswordHash(passwordEncoder.encode(generatedPassword));
        user.setMustResetPassword(true);
        user.bumpTokenVersion();
        users.save(user);

        audit.record(AuditAction.USER_PASSWORD_RESET, "app_user", userId, null);
        log.info("Admin {} reset the password for user {}", SecurityUtils.currentUserId(), userId);

        return new ResetPasswordResponse(user.getId(), user.getLoginId(), generatedPassword);
    }

    /**
     * Tenant-safe account lookup shared by the admin surfaces. A user id from another township is a
     * 404 rather than a 403: the difference between "not yours" and "does not exist" is itself a
     * disclosure, and across a tenant boundary it is one this system does not make.
     */
    @Transactional(readOnly = true)
    public AppUser requireUserInTenant(UUID userId) {
        return users.findByIdAndTownship_Id(userId, TenantContext.requireTownshipId())
                .orElseThrow(() -> NotFoundException.of("User", userId));
    }

    private void requireRoleIsProvisionable(UserRole role) {
        if (role == UserRole.SUPER_ADMIN) {
            throw new BusinessValidationException("ROLE_NOT_PROVISIONABLE",
                    "A SUPER_ADMIN belongs to no township and is created from the platform endpoints.");
        }
        if (role == UserRole.ADMIN && !SecurityUtils.hasRole(UserRole.SUPER_ADMIN)) {
            throw new ForbiddenException("ADMIN_REQUIRES_SUPER_ADMIN",
                    "Only a super admin may appoint a township administrator.");
        }
    }

    /**
     * Residents get {@code <flat number>-<n>}: {@code A-101-1}, then {@code A-101-2}. That is unique
     * within the township only -- every township with a block A mints its own {@code A-101-1}.
     *
     * <p>The flat row is locked for update first, which serialises two admins provisioning into the
     * same flat at the same moment. The count deliberately includes deactivated accounts -- reusing
     * {@code A-101-2} after its owner moved out would silently re-point that login id at a new person
     * and make the audit trail ambiguous.
     */
    private void applyResidentIdentity(AppUser user, CreateUserRequest request, UUID townshipId) {
        if (request.flatId() == null) {
            throw new BusinessValidationException("FLAT_REQUIRED",
                    "flatId is required when provisioning a RESIDENT.");
        }
        Flat flat = flats.findByIdForUpdate(request.flatId(), townshipId)
                .orElseThrow(() -> NotFoundException.of("Flat", request.flatId()));

        long existing = users.countByFlat_Id(flat.getId());
        user.setFlat(flat);
        user.setLoginId(flat.getNumber() + "-" + (existing + 1));
    }

    private void applyStaffIdentity(AppUser user, CreateUserRequest request, UUID townshipId) {
        if (request.loginId() == null || request.loginId().isBlank()) {
            throw new BusinessValidationException("LOGIN_ID_REQUIRED",
                    "loginId is required for " + request.role() + " accounts.");
        }
        if (request.flatId() != null) {
            throw new BusinessValidationException("FLAT_NOT_ALLOWED",
                    "Only RESIDENT accounts may be linked to a flat.");
        }
        String loginId = request.loginId().trim();
        if (users.existsByTownship_IdAndLoginId(townshipId, loginId)) {
            throw new ConflictException("LOGIN_ID_TAKEN", "That login id is already in use.");
        }
        user.setLoginId(loginId);
    }

    /**
     * Contact uniqueness is per township. Checking it globally would leak across the tenant boundary:
     * "that phone number is already registered" would tell one township's admin something true only
     * about a different customer's township.
     */
    private void assignContactDetails(AppUser user, UUID townshipId, String phone, String email) {
        String normalisedPhone = normalise(phone);
        String normalisedEmail = normalise(email);
        if (normalisedPhone != null && users.existsByTownship_IdAndPhone(townshipId, normalisedPhone)) {
            throw new ConflictException("PHONE_TAKEN", "That phone number is already registered.");
        }
        if (normalisedEmail != null && users.existsByTownship_IdAndEmail(townshipId, normalisedEmail)) {
            throw new ConflictException("EMAIL_TAKEN", "That email address is already registered.");
        }
        user.setPhone(normalisedPhone);
        user.setEmail(normalisedEmail);
    }

    /** Blank strings become null so they do not collide under the unique indexes. */
    private String normalise(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        return value.trim().toLowerCase();
    }
}
