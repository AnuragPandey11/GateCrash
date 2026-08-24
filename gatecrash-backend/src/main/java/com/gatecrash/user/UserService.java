package com.gatecrash.user;

import com.gatecrash.common.PageResponse;
import com.gatecrash.common.audit.AuditAction;
import com.gatecrash.common.audit.AuditService;
import com.gatecrash.common.exception.BusinessValidationException;
import com.gatecrash.common.exception.ConflictException;
import com.gatecrash.common.exception.NotFoundException;
import com.gatecrash.security.SecurityUtils;
import com.gatecrash.user.dto.UserDtos.SalesAgentResponse;
import com.gatecrash.user.dto.UserDtos.UpdateUserRequest;
import com.gatecrash.user.dto.UserDtos.UserResponse;
import jakarta.persistence.criteria.Predicate;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

/** Account administration, plus the sales duty toggle that feeds the guard's dropdown. */
@Service
@RequiredArgsConstructor
public class UserService {

    private static final Logger log = LoggerFactory.getLogger(UserService.class);

    private final AppUserRepository users;
    private final RefreshTokenService refreshTokens;
    private final UserMapper mapper;
    private final AuditService audit;

    @PreAuthorize("hasRole('ADMIN')")
    @Transactional(readOnly = true)
    public PageResponse<UserResponse> list(UserRole role, Boolean active, UUID flatId, String search,
                                           Pageable pageable) {
        return PageResponse.of(users.findAll(filter(role, active, flatId, search), pageable),
                mapper::toResponse);
    }

    @PreAuthorize("hasRole('ADMIN')")
    @Transactional(readOnly = true)
    public UserResponse get(UUID userId) {
        return users.findById(userId)
                .map(mapper::toResponse)
                .orElseThrow(() -> NotFoundException.of("User", userId));
    }

    /**
     * Updates contact details only. Role, flat and login id are immutable by design: changing any of
     * them would silently re-point historical visitor logs and audit rows at a different person.
     * Those cases are a deactivate-and-reprovision, not an edit.
     */
    @PreAuthorize("hasRole('ADMIN')")
    @Transactional
    public UserResponse update(UUID userId, UpdateUserRequest request) {
        AppUser user = users.findById(userId)
                .orElseThrow(() -> NotFoundException.of("User", userId));

        if (request.fullName() != null && !request.fullName().isBlank()) {
            user.setFullName(request.fullName().trim());
        }
        if (request.phone() != null) {
            String phone = normalise(request.phone());
            if (phone != null && users.existsByPhoneAndIdNot(phone, userId)) {
                throw new ConflictException("PHONE_TAKEN", "That phone number is already registered.");
            }
            user.setPhone(phone);
        }
        if (request.email() != null) {
            String email = normalise(request.email());
            if (email != null && users.existsByEmailAndIdNot(email, userId)) {
                throw new ConflictException("EMAIL_TAKEN", "That email address is already registered.");
            }
            user.setEmail(email);
        }

        users.save(user);
        audit.record(AuditAction.USER_UPDATED, "app_user", userId, null);
        return mapper.toResponse(user);
    }

    /**
     * Soft-deactivates an account. Nothing is deleted -- the visitor log and audit trail must keep
     * resolving the person who approved a visit long after they leave the township.
     */
    @PreAuthorize("hasRole('ADMIN')")
    @Transactional
    public UserResponse setActive(UUID userId, boolean active) {
        AppUser user = users.findById(userId)
                .orElseThrow(() -> NotFoundException.of("User", userId));

        if (!active && userId.equals(SecurityUtils.currentUserId())) {
            throw new BusinessValidationException("CANNOT_DEACTIVATE_SELF",
                    "You cannot deactivate your own account.");
        }
        if (user.isActive() == active) {
            return mapper.toResponse(user);
        }

        user.setActive(active);
        if (!active) {
            // Kill the session now: bump the token version and drop every refresh token.
            user.bumpTokenVersion();
            user.setOnDuty(false);
        }
        users.save(user);
        if (!active) {
            refreshTokens.revokeAllForUser(userId, "ACCOUNT_DEACTIVATED");
        }

        audit.record(active ? AuditAction.USER_REACTIVATED : AuditAction.USER_DEACTIVATED,
                "app_user", userId, null);
        log.info("User {} set active={} by {}", userId, active, SecurityUtils.currentUserId());
        return mapper.toResponse(user);
    }

    /** Sales agents mark themselves on or off duty; nobody else can move that flag. */
    @PreAuthorize("hasRole('SALES')")
    @Transactional
    public UserResponse setOwnDuty(boolean onDuty) {
        UUID userId = SecurityUtils.currentUserId();
        AppUser user = users.findById(userId)
                .orElseThrow(() -> NotFoundException.of("User", userId));

        user.setOnDuty(onDuty);
        users.save(user);
        audit.record(AuditAction.DUTY_CHANGED, "app_user", userId,
                AuditService.detail("onDuty", onDuty));
        return mapper.toResponse(user);
    }

    /**
     * The guard's routing dropdown. Guards need this to log a client visit, and admins to supervise;
     * residents and other sales agents have no business enumerating who is on shift.
     */
    @PreAuthorize("hasAnyRole('GUARD','ADMIN')")
    @Transactional(readOnly = true)
    public List<SalesAgentResponse> onDutySalesAgents() {
        return users.findByRoleAndOnDutyTrueAndActiveTrueOrderByFullNameAsc(UserRole.SALES).stream()
                .map(mapper::toSalesAgent)
                .toList();
    }

    private Specification<AppUser> filter(UserRole role, Boolean active, UUID flatId, String search) {
        return (root, query, builder) -> {
            List<Predicate> predicates = new ArrayList<>();
            if (role != null) {
                predicates.add(builder.equal(root.get("role"), role));
            }
            if (active != null) {
                predicates.add(builder.equal(root.get("active"), active));
            }
            if (flatId != null) {
                predicates.add(builder.equal(root.get("flat").get("id"), flatId));
            }
            if (search != null && !search.isBlank()) {
                // Criteria binds this as a parameter, so injection is not the concern -- but LIKE
                // metacharacters in the term still have to be escaped or a search for "_" matches
                // everything.
                String term = search.trim().toLowerCase(Locale.ROOT)
                        .replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
                String pattern = "%" + term + "%";
                predicates.add(builder.or(
                        builder.like(builder.lower(root.get("fullName")), pattern, '\\'),
                        builder.like(builder.lower(root.get("loginId")), pattern, '\\')));
            }
            return builder.and(predicates.toArray(new Predicate[0]));
        };
    }

    private String normalise(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        return value.trim().toLowerCase(Locale.ROOT);
    }
}
