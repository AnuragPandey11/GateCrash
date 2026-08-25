package com.gatecrash.platform;

import com.gatecrash.common.PageResponse;
import com.gatecrash.common.audit.AuditAction;
import com.gatecrash.common.audit.AuditService;
import com.gatecrash.common.exception.BusinessValidationException;
import com.gatecrash.common.exception.ConflictException;
import com.gatecrash.common.exception.NotFoundException;
import com.gatecrash.common.tenant.TenantContext;
import com.gatecrash.platform.dto.PlatformDtos.ArchiveTownshipRequest;
import com.gatecrash.platform.dto.PlatformDtos.CreateTownshipRequest;
import com.gatecrash.platform.dto.PlatformDtos.CreatedTownshipResponse;
import com.gatecrash.platform.dto.PlatformDtos.TownshipAdminRequest;
import com.gatecrash.platform.dto.PlatformDtos.TownshipResponse;
import com.gatecrash.platform.dto.PlatformDtos.UpdateTownshipRequest;
import com.gatecrash.security.SecurityUtils;
import com.gatecrash.township.BuildingBlockRepository;
import com.gatecrash.township.GateRepository;
import com.gatecrash.township.Township;
import com.gatecrash.township.TownshipRepository;
import com.gatecrash.township.TownshipStatus;
import com.gatecrash.user.AppUserRepository;
import com.gatecrash.user.RefreshTokenService;
import com.gatecrash.user.UserProvisioningService;
import com.gatecrash.user.UserRole;
import com.gatecrash.user.dto.UserDtos.CreateUserRequest;
import com.gatecrash.user.dto.UserDtos.CreatedUserResponse;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

/**
 * The tenant lifecycle: onboarding a township, suspending it, retiring it, bringing it back.
 *
 * <p>Only a {@code SUPER_ADMIN} reaches any of this. A township administrator has complete authority
 * <em>inside</em> their township and none at all over its existence -- if they could archive it they
 * could lock out every resident and guard in it, and if they could create one they would be selling
 * the platform's capacity on the operator's behalf.
 *
 * <h2>Why there is no delete</h2>
 *
 * <p>Archiving is the terminal state, and it is reversible. The rest of this codebase refuses to
 * destroy access-control history -- users are deactivated rather than deleted, blocks and gates
 * cannot be removed while anything references them -- and a township is the root of all of it. A
 * cascading delete would erase every visitor log and audit row proving who was admitted through a
 * gate and who authorised it, which is precisely the record a township keeps this system for. A
 * cancelled customer stops being able to sign in; they do not stop having had a history.
 *
 * <h2>How lockout takes effect</h2>
 *
 * <p>Suspending or archiving does three things, and the redundancy is deliberate:
 * <ol>
 *   <li>the township's status stops {@code AuthService} issuing new tokens;</li>
 *   <li>every member's {@code tokenVersion} is bumped, so access tokens already in the wild stop
 *       verifying on their very next request rather than lasting out their TTL;</li>
 *   <li>every refresh token in the township is revoked, so nothing can rotate its way back in.</li>
 * </ol>
 * Notably it does <em>not</em> deactivate the accounts. Restoring a township would then have to guess
 * which of them an admin had deliberately disabled beforehand, and it would guess wrong.
 */
@Service
@RequiredArgsConstructor
public class TownshipLifecycleService {

    private static final Logger log = LoggerFactory.getLogger(TownshipLifecycleService.class);

    private final TownshipRepository townships;
    private final AppUserRepository users;
    private final BuildingBlockRepository blocks;
    private final GateRepository gates;
    private final UserProvisioningService provisioning;
    private final RefreshTokenService refreshTokens;
    private final AuditService audit;

    // ----- onboarding -------------------------------------------------------------------------

    @PreAuthorize("hasRole('SUPER_ADMIN')")
    @Transactional
    public CreatedTownshipResponse create(CreateTownshipRequest request) {
        String code = normaliseCode(request.code());
        if (townships.existsByCode(code)) {
            throw new ConflictException("TOWNSHIP_CODE_TAKEN",
                    "A township with that code already exists.");
        }

        Township township = new Township();
        township.setCode(code);
        township.setName(request.name().trim());
        township.setContactEmail(blankToNull(request.contactEmail()));
        township.setContactPhone(blankToNull(request.contactPhone()));
        township.setStatus(TownshipStatus.ACTIVE);
        township.setCreatedBy(SecurityUtils.currentUserId());
        townships.saveAndFlush(township);

        CreatedUserResponse admin = provisionAdmin(township, request.admin());

        audit.recordForTownship(township.getId(), AuditAction.TOWNSHIP_CREATED, "township",
                township.getId(), AuditService.detail("code", code, "name", township.getName(),
                        "adminLoginId", admin.loginId()));
        log.info("Township {} ({}) created by super admin {} with admin {}",
                township.getId(), code, SecurityUtils.currentUserId(), admin.id());

        return new CreatedTownshipResponse(toResponse(township), admin);
    }

    /** Appoints an additional administrator for an existing township. */
    @PreAuthorize("hasRole('SUPER_ADMIN')")
    @Transactional
    public CreatedUserResponse addAdmin(UUID townshipId, TownshipAdminRequest request) {
        Township township = requireTownship(townshipId);
        requireNotArchived(township);

        CreatedUserResponse admin = provisionAdmin(township, request);
        audit.recordForTownship(townshipId, AuditAction.TOWNSHIP_ADMIN_ADDED, "app_user", admin.id(),
                AuditService.detail("loginId", admin.loginId()));
        return admin;
    }

    /**
     * Stands the provisioning call up inside the target township.
     *
     * <p>{@code TenantContext.callAs} is what makes this safe: {@code UserProvisioningService} reads
     * the tenant from the context and from nowhere else, so borrowing the context for the duration is
     * the only way to provision into a township without giving that service a townshipId parameter --
     * and a townshipId parameter is exactly the thing that eventually gets passed from a request body.
     */
    private CreatedUserResponse provisionAdmin(Township township, TownshipAdminRequest request) {
        CreateUserRequest adminRequest = new CreateUserRequest(
                UserRole.ADMIN, null, request.loginId(), request.fullName(),
                request.phone(), request.email());
        return TenantContext.callAs(township.getId(), () -> provisioning.createUser(adminRequest));
    }

    // ----- reads ------------------------------------------------------------------------------

    @PreAuthorize("hasRole('SUPER_ADMIN')")
    @Transactional(readOnly = true)
    public PageResponse<TownshipResponse> list(boolean includeArchived, Pageable pageable) {
        Page<Township> page = includeArchived
                ? townships.findAllByOrderByNameAsc(pageable)
                : townships.findByStatusInOrderByNameAsc(
                        List.of(TownshipStatus.ACTIVE, TownshipStatus.SUSPENDED), pageable);
        return PageResponse.of(page, this::toResponse);
    }

    @PreAuthorize("hasRole('SUPER_ADMIN')")
    @Transactional(readOnly = true)
    public TownshipResponse get(UUID townshipId) {
        return toResponse(requireTownship(townshipId));
    }

    // ----- mutation ---------------------------------------------------------------------------

    @PreAuthorize("hasRole('SUPER_ADMIN')")
    @Transactional
    public TownshipResponse update(UUID townshipId, UpdateTownshipRequest request) {
        Township township = requireTownship(townshipId);

        if (request.name() != null && !request.name().isBlank()) {
            township.setName(request.name().trim());
        }
        if (request.contactEmail() != null) {
            township.setContactEmail(blankToNull(request.contactEmail()));
        }
        if (request.contactPhone() != null) {
            township.setContactPhone(blankToNull(request.contactPhone()));
        }
        townships.save(township);

        audit.recordForTownship(townshipId, AuditAction.TOWNSHIP_UPDATED, "township", townshipId, null);
        return toResponse(township);
    }

    /** Temporary lockout -- non-payment, an incident under investigation. Fully reversible. */
    @PreAuthorize("hasRole('SUPER_ADMIN')")
    @Transactional
    public TownshipResponse suspend(UUID townshipId) {
        Township township = requireTownship(townshipId);
        if (township.getStatus() == TownshipStatus.ARCHIVED) {
            throw new ConflictException("TOWNSHIP_ARCHIVED",
                    "Restore the township before suspending it.");
        }
        if (township.getStatus() == TownshipStatus.SUSPENDED) {
            return toResponse(township);
        }

        township.setStatus(TownshipStatus.SUSPENDED);
        townships.save(township);
        endAllSessions(townshipId);

        audit.recordForTownship(townshipId, AuditAction.TOWNSHIP_SUSPENDED, "township", townshipId, null);
        log.warn("Township {} suspended by super admin {}", townshipId, SecurityUtils.currentUserId());
        return toResponse(township);
    }

    /**
     * Retirement -- what {@code DELETE /super/townships/{id}} does.
     *
     * <p>The caller must type the township's own code back to confirm. It is the one operation on the
     * platform that takes an entire community offline at once, and an unconfirmed {@code DELETE} on a
     * mis-pasted id would do exactly that.
     */
    @PreAuthorize("hasRole('SUPER_ADMIN')")
    @Transactional
    public TownshipResponse archive(UUID townshipId, ArchiveTownshipRequest request) {
        Township township = requireTownship(townshipId);
        if (!township.getCode().equalsIgnoreCase(request.confirmCode().trim())) {
            throw new BusinessValidationException("CONFIRMATION_MISMATCH",
                    "confirmCode must match the township's code.");
        }
        if (township.getStatus() == TownshipStatus.ARCHIVED) {
            return toResponse(township);
        }

        township.setStatus(TownshipStatus.ARCHIVED);
        township.setArchivedAt(OffsetDateTime.now());
        townships.save(township);
        int sessionsEnded = endAllSessions(townshipId);

        audit.recordForTownship(townshipId, AuditAction.TOWNSHIP_ARCHIVED, "township", townshipId,
                AuditService.detail("code", township.getCode(), "sessionsEnded", sessionsEnded));
        log.warn("Township {} ({}) archived by super admin {}; {} session(s) ended",
                townshipId, township.getCode(), SecurityUtils.currentUserId(), sessionsEnded);
        return toResponse(township);
    }

    /** Brings a suspended or archived township back. Nothing was destroyed, so nothing is rebuilt. */
    @PreAuthorize("hasRole('SUPER_ADMIN')")
    @Transactional
    public TownshipResponse restore(UUID townshipId) {
        Township township = requireTownship(townshipId);
        if (township.getStatus() == TownshipStatus.ACTIVE) {
            return toResponse(township);
        }

        township.setStatus(TownshipStatus.ACTIVE);
        township.setArchivedAt(null);
        townships.save(township);

        audit.recordForTownship(townshipId, AuditAction.TOWNSHIP_RESTORED, "township", townshipId, null);
        log.info("Township {} restored by super admin {}", townshipId, SecurityUtils.currentUserId());
        return toResponse(township);
    }

    // ----- internals --------------------------------------------------------------------------

    /**
     * Ends every live session in the township. The token-version bump is the immediate half (already
     * issued access tokens stop verifying on their next request) and the refresh revocation is the
     * durable half (nothing can rotate a new pair out of an old one).
     */
    private int endAllSessions(UUID townshipId) {
        int affected = users.bumpTokenVersionsForTownship(townshipId);
        users.findIdsByTownship(townshipId)
                .forEach(userId -> refreshTokens.revokeAllForUser(userId, "TOWNSHIP_LIFECYCLE"));
        return affected;
    }

    private Township requireTownship(UUID townshipId) {
        return townships.findById(townshipId)
                .orElseThrow(() -> NotFoundException.of("Township", townshipId));
    }

    private void requireNotArchived(Township township) {
        if (township.getStatus() == TownshipStatus.ARCHIVED) {
            throw new ConflictException("TOWNSHIP_ARCHIVED",
                    "That township is archived. Restore it before changing it.");
        }
    }

    private TownshipResponse toResponse(Township township) {
        UUID id = township.getId();
        return new TownshipResponse(
                id,
                township.getCode(),
                township.getName(),
                township.getStatus(),
                township.getContactEmail(),
                township.getContactPhone(),
                townships.countActiveUsers(id),
                users.countByTownship_IdAndRoleAndActiveTrue(id, UserRole.ADMIN),
                blocks.countByTownship_Id(id),
                gates.countByTownship_Id(id),
                township.getCreatedAt(),
                township.getArchivedAt());
    }

    private String normaliseCode(String code) {
        return code.trim().toUpperCase(Locale.ROOT);
    }

    private String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
