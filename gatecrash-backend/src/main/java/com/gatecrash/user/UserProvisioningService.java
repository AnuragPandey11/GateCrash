package com.gatecrash.user;

import com.gatecrash.common.audit.AuditAction;
import com.gatecrash.common.audit.AuditService;
import com.gatecrash.common.exception.BusinessValidationException;
import com.gatecrash.common.exception.ConflictException;
import com.gatecrash.common.exception.NotFoundException;
import com.gatecrash.security.SecurityUtils;
import com.gatecrash.township.Flat;
import com.gatecrash.township.FlatRepository;
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
 */
@Service
@RequiredArgsConstructor
public class UserProvisioningService {

    private static final Logger log = LoggerFactory.getLogger(UserProvisioningService.class);

    private final AppUserRepository users;
    private final FlatRepository flats;
    private final PasswordEncoder passwordEncoder;
    private final PasswordGenerator passwordGenerator;
    private final AuditService audit;

    @PreAuthorize("hasRole('ADMIN')")
    @Transactional
    public CreatedUserResponse createUser(CreateUserRequest request) {
        AppUser user = new AppUser();
        user.setRole(request.role());
        user.setFullName(request.fullName().trim());
        user.setCreatedBy(SecurityUtils.currentUserId());

        if (request.role() == UserRole.RESIDENT) {
            applyResidentIdentity(user, request);
        } else {
            applyStaffIdentity(user, request);
        }

        assignContactDetails(user, request.phone(), request.email());

        String generatedPassword = passwordGenerator.generate();
        user.setPasswordHash(passwordEncoder.encode(generatedPassword));
        user.setMustResetPassword(true);
        user.setActive(true);

        try {
            users.saveAndFlush(user);
        } catch (DataIntegrityViolationException ex) {
            // The unique index is the backstop behind the flat row lock; surface it as a clean 409.
            log.warn("Provisioning conflict for login id {}", user.getLoginId());
            throw new ConflictException("LOGIN_ID_TAKEN",
                    "That login id is already in use. Retry the request.");
        }

        audit.record(AuditAction.USER_PROVISIONED, "app_user", user.getId(),
                AuditService.detail("loginId", user.getLoginId(), "role", user.getRole()));
        log.info("Provisioned {} account {} ({})", user.getRole(), user.getId(), user.getLoginId());

        return new CreatedUserResponse(user.getId(), user.getLoginId(), user.getFullName(),
                user.getRole(), generatedPassword);
    }

    /**
     * Issues a new generated password and forces a change on next login. Every existing session for
     * the account dies immediately: refresh tokens are revoked by the caller, and the token-version
     * bump invalidates outstanding access tokens.
     */
    @PreAuthorize("hasRole('ADMIN')")
    @Transactional
    public ResetPasswordResponse resetPassword(UUID userId) {
        AppUser user = users.findById(userId)
                .orElseThrow(() -> NotFoundException.of("User", userId));

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
     * Residents get {@code <flat number>-<n>}: {@code A-101-1}, then {@code A-101-2}.
     *
     * <p>The flat row is locked for update first, which serialises two admins provisioning into the
     * same flat at the same moment. The count deliberately includes deactivated accounts -- reusing
     * {@code A-101-2} after its owner moved out would silently re-point that login id at a new person
     * and make the audit trail ambiguous.
     */
    private void applyResidentIdentity(AppUser user, CreateUserRequest request) {
        if (request.flatId() == null) {
            throw new BusinessValidationException("FLAT_REQUIRED",
                    "flatId is required when provisioning a RESIDENT.");
        }
        Flat flat = flats.findByIdForUpdate(request.flatId())
                .orElseThrow(() -> NotFoundException.of("Flat", request.flatId()));

        long existing = users.countByFlat_Id(flat.getId());
        user.setFlat(flat);
        user.setLoginId(flat.getNumber() + "-" + (existing + 1));
    }

    private void applyStaffIdentity(AppUser user, CreateUserRequest request) {
        if (request.loginId() == null || request.loginId().isBlank()) {
            throw new BusinessValidationException("LOGIN_ID_REQUIRED",
                    "loginId is required for " + request.role() + " accounts.");
        }
        if (request.flatId() != null) {
            throw new BusinessValidationException("FLAT_NOT_ALLOWED",
                    "Only RESIDENT accounts may be linked to a flat.");
        }
        String loginId = request.loginId().trim();
        if (users.existsByLoginId(loginId)) {
            throw new ConflictException("LOGIN_ID_TAKEN", "That login id is already in use.");
        }
        user.setLoginId(loginId);
    }

    private void assignContactDetails(AppUser user, String phone, String email) {
        String normalisedPhone = normalise(phone);
        String normalisedEmail = normalise(email);
        if (normalisedPhone != null && users.existsByPhone(normalisedPhone)) {
            throw new ConflictException("PHONE_TAKEN", "That phone number is already registered.");
        }
        if (normalisedEmail != null && users.existsByEmail(normalisedEmail)) {
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
