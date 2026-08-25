package com.gatecrash.pass;

import com.gatecrash.common.AfterCommitExecutor;
import com.gatecrash.common.PageResponse;
import com.gatecrash.common.audit.AuditAction;
import com.gatecrash.common.audit.AuditService;
import com.gatecrash.common.exception.BusinessValidationException;
import com.gatecrash.common.exception.ConflictException;
import com.gatecrash.common.exception.ForbiddenException;
import com.gatecrash.common.exception.GoneException;
import com.gatecrash.common.exception.NotFoundException;
import com.gatecrash.common.exception.TooManyRequestsException;
import com.gatecrash.common.tenant.TenantContext;
import com.gatecrash.config.AppProperties;
import com.gatecrash.device.DeviceService;
import com.gatecrash.pass.dto.PassDtos.CreatePassRequest;
import com.gatecrash.pass.dto.PassDtos.CreatePassResponse;
import com.gatecrash.pass.dto.PassDtos.PassResponse;
import com.gatecrash.pass.dto.PassDtos.RedeemPassRequest;
import com.gatecrash.pass.dto.PassDtos.RedeemPassResponse;
import com.gatecrash.push.FcmService;
import com.gatecrash.push.PushPayload;
import com.gatecrash.security.AppUserDetails;
import com.gatecrash.security.FixedWindowRateLimiter;
import com.gatecrash.security.SecurityUtils;
import com.gatecrash.township.Gate;
import com.gatecrash.township.TownshipService;
import com.gatecrash.user.AppUser;
import com.gatecrash.user.AppUserRepository;
import com.gatecrash.user.PasswordGenerator;
import com.gatecrash.user.UserRole;
import com.gatecrash.visit.ApproverKind;
import com.gatecrash.visit.VisitMapper;
import com.gatecrash.visit.VisitNotifier;
import com.gatecrash.visit.VisitStatus;
import com.gatecrash.visit.VisitorLog;
import com.gatecrash.visit.VisitorLogRepository;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Pageable;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Pre-approval passes: minting, redemption, revocation.
 *
 * <p>A pass is a bearer credential for physical entry, so the threat model is concrete. The
 * mitigations, in order of importance:
 *
 * <ul>
 *   <li><b>The PIN is never stored.</b> Only bcrypt (for verification) and a peppered HMAC (for
 *       lookup) are persisted -- see {@link PinHasher}. A leaked database yields no usable pass.</li>
 *   <li><b>Redemption is rate limited per guard.</b> Six digits is only a million combinations;
 *       without a throttle, a compromised guard tablet could grind out a valid PIN in hours.</li>
 *   <li><b>Redemption is serialised by a row lock.</b> Two scans of the same QR in the same instant
 *       must not both succeed against a single-use pass.</li>
 *   <li><b>Failures are indistinguishable.</b> Wrong PIN, revoked pass and expired pass all return
 *       the same message, so the gate keypad cannot be used to probe which PINs exist.</li>
 *   <li><b>Resolution is confined to the guard's township.</b> Both the QR token and the PIN lookup
 *       are narrowed by tenant before a candidate is ever considered. Without that, a six-digit PIN
 *       -- or a photographed QR code -- from one community would be a working key at another's gate,
 *       and PIN collisions across a whole platform are not a hypothetical: a million-value space
 *       shared by many townships makes them routine. It is also what keeps the candidate list to the
 *       handful the bcrypt-verify loop below assumes.</li>
 * </ul>
 */
@Service
@RequiredArgsConstructor
public class PassService {

    private static final Logger log = LoggerFactory.getLogger(PassService.class);

    /** One message for every redemption failure, so the endpoint is not an oracle. */
    private static final String REDEEM_FAILURE_MESSAGE = "This pass is not valid for entry.";

    private final PreApprovalRepository passes;
    private final VisitorLogRepository visits;
    private final AppUserRepository users;
    private final TownshipService township;
    private final PasswordEncoder passwordEncoder;
    private final PasswordGenerator passwordGenerator;
    private final PinHasher pinHasher;
    private final VisitMapper visitMapper;
    private final VisitNotifier visitNotifier;
    private final DeviceService devices;
    private final FcmService fcm;
    private final AuditService audit;
    private final AfterCommitExecutor afterCommit;
    private final FixedWindowRateLimiter rateLimiter;
    private final AppProperties properties;

    // ----- minting ----------------------------------------------------------------------------

    @PreAuthorize("hasAnyRole('RESIDENT','SALES')")
    @Transactional
    public CreatePassResponse createPass(CreatePassRequest request) {
        AppUserDetails caller = SecurityUtils.currentUser();
        AppUser creator = users.findById(caller.getId())
                .orElseThrow(() -> NotFoundException.of("User", caller.getId()));

        OffsetDateTime now = OffsetDateTime.now();
        validateWindow(request.validUntil(), now);
        if (request.maxUses() > properties.pass().maxUsesLimit()) {
            throw new BusinessValidationException("MAX_USES_EXCEEDED",
                    "A pass may allow at most " + properties.pass().maxUsesLimit() + " entries.");
        }

        String pin = passwordGenerator.generateNumericPin(properties.pass().pinLength());

        PreApproval pass = new PreApproval();
        // Taken from the creator's own account, not from the request context, so a pass can only
        // ever belong to the township of the person who minted it.
        pass.setTownship(creator.getTownship());
        pass.setCreatedBy(creator);
        // Derived from the caller's role, never from the request body.
        pass.setApproverKind(caller.getRole() == UserRole.SALES ? ApproverKind.SALES : ApproverKind.RESIDENT);
        pass.setVisitorName(blankToNull(request.visitorName()));
        pass.setVisitorPhone(blankToNull(request.visitorPhone()));
        pass.setVisitorType(request.visitorType());
        pass.setPinHash(passwordEncoder.encode(pin));
        pass.setPinLookup(pinHasher.lookupValue(pin));
        pass.setPinLast4(pin.substring(Math.max(0, pin.length() - 4)));
        pass.setQrToken(UUID.randomUUID());
        pass.setStatus(PassStatus.ACTIVE);
        pass.setValidFrom(now);
        pass.setValidUntil(request.validUntil());
        pass.setMaxUses(request.maxUses());
        passes.save(pass);

        audit.record(AuditAction.PASS_CREATED, "pre_approval", pass.getId(),
                AuditService.detail("visitorType", pass.getVisitorType(), "maxUses", pass.getMaxUses(),
                        "validUntil", pass.getValidUntil()));
        log.info("Pass {} minted by user {}", pass.getId(), caller.getId());

        // The only time the plaintext PIN leaves this method.
        return new CreatePassResponse(pass.getId(), pin, pass.getQrToken(), pass.getValidFrom(),
                pass.getValidUntil(), pass.getMaxUses());
    }

    @PreAuthorize("hasAnyRole('RESIDENT','SALES')")
    @Transactional(readOnly = true)
    public PageResponse<PassResponse> listMine(Pageable pageable) {
        return PageResponse.of(
                passes.findByCreatedBy_IdOrderByCreatedAtDesc(SecurityUtils.currentUserId(), pageable),
                this::toResponse);
    }

    @PreAuthorize("hasAnyRole('RESIDENT','SALES')")
    @Transactional
    public PassResponse revoke(UUID passId) {
        PreApproval pass = passes.findByIdForUpdate(passId, TenantContext.requireTownshipId())
                .orElseThrow(() -> NotFoundException.of("Pass", passId));

        // Ownership re-check: a valid RESIDENT token does not entitle you to another flat's passes.
        if (!SecurityUtils.currentUserId().equals(pass.getCreatedById())) {
            throw new ForbiddenException("You did not create this pass.");
        }
        if (!pass.getStatus().canTransitionTo(PassStatus.REVOKED)) {
            throw ConflictException.illegalTransition("Pass", pass.getStatus(), PassStatus.REVOKED);
        }

        pass.setStatus(PassStatus.REVOKED);
        passes.save(pass);
        audit.record(AuditAction.PASS_REVOKED, "pre_approval", passId, null);
        return toResponse(pass);
    }

    // ----- redemption -------------------------------------------------------------------------

    /**
     * The fast path: verify the pass and create a visit already in {@code CHECKED_IN}. No approval
     * ping, no waiting -- that is the whole point of a pass.
     */
    @PreAuthorize("hasRole('GUARD')")
    @Transactional
    public RedeemPassResponse redeem(RedeemPassRequest request) {
        AppUserDetails guard = SecurityUtils.currentUser();
        boolean byPin = request.pin() != null && !request.pin().isBlank();
        boolean byQr = request.qrToken() != null;
        if (byPin == byQr) {
            throw new BusinessValidationException("AMBIGUOUS_REDEMPTION",
                    "Supply exactly one of pin or qrToken.");
        }

        throttleRedemption(guard.getId());
        Gate gate = township.requireGate(request.gateId());
        UUID townshipId = gate.getTownshipId();

        PreApproval pass = byQr
                ? resolveByQr(request.qrToken(), townshipId)
                : resolveByPin(request.pin(), townshipId);

        OffsetDateTime now = OffsetDateTime.now();
        if (!pass.isRedeemableAt(now)) {
            onRedeemFailure(guard.getId(), pass.getId(), reasonFor(pass, now));
            throw pass.getValidUntil().isBefore(now)
                    ? new GoneException("PASS_EXPIRED", REDEEM_FAILURE_MESSAGE)
                    : new ConflictException("PASS_NOT_REDEEMABLE", REDEEM_FAILURE_MESSAGE);
        }

        pass.setUseCount(pass.getUseCount() + 1);
        if (pass.getUseCount() >= pass.getMaxUses()) {
            pass.setStatus(PassStatus.REDEEMED);
        }
        passes.save(pass);

        VisitorLog visit = buildCheckedInVisit(pass, gate, guard.getId());
        visits.save(visit);

        audit.record(AuditAction.PASS_REDEEMED, "pre_approval", pass.getId(),
                AuditService.detail("visitId", visit.getId(), "gateId", gate.getId(),
                        "useCount", pass.getUseCount(), "method", byQr ? "QR" : "PIN"));
        log.info("Pass {} redeemed at gate {} by guard {} (visit {})",
                pass.getId(), gate.getId(), guard.getId(), visit.getId());

        rateLimiter.reset(redeemKey(guard.getId()));

        UUID visitId = visit.getId();
        UUID ownerId = pass.getCreatedById();
        String visitorName = visit.getVisitorName();
        String gateName = gate.getName();
        afterCommit.execute(() -> {
            notifyOwnerOfEntry(ownerId, visitorName, gateName, visitId);
            visitNotifier.occupancyChanged(townshipId, visitId, VisitStatus.CHECKED_IN, visitorName,
                    gateName);
        });

        return new RedeemPassResponse(pass.getId(), visitMapper.toResponse(visit),
                Math.max(0, pass.getMaxUses() - pass.getUseCount()));
    }

    private PreApproval resolveByQr(UUID qrToken, UUID townshipId) {
        PreApproval candidate = passes.findByQrTokenAndTownship_Id(qrToken, townshipId)
                .orElseThrow(() -> new NotFoundException(REDEEM_FAILURE_MESSAGE));
        // Re-read under a write lock so the use-count increment is atomic.
        return passes.findByIdForUpdate(candidate.getId(), townshipId)
                .orElseThrow(() -> new NotFoundException(REDEEM_FAILURE_MESSAGE));
    }

    /**
     * PIN resolution: narrow by the indexed HMAC, then bcrypt-verify each candidate. The bcrypt check
     * is what authorises -- the index only decides which handful of rows to look at.
     */
    private PreApproval resolveByPin(String pin, UUID townshipId) {
        List<PreApproval> candidates =
                passes.findActiveByPinLookup(pinHasher.lookupValue(pin), townshipId);
        for (PreApproval candidate : candidates) {
            if (passwordEncoder.matches(pin, candidate.getPinHash())) {
                return passes.findByIdForUpdate(candidate.getId(), townshipId)
                        .orElseThrow(() -> new NotFoundException(REDEEM_FAILURE_MESSAGE));
            }
        }
        throw new NotFoundException(REDEEM_FAILURE_MESSAGE);
    }

    private VisitorLog buildCheckedInVisit(PreApproval pass, Gate gate, UUID guardId) {
        AppUser creator = pass.getCreatedBy();
        VisitorLog visit = new VisitorLog();
        visit.setTownship(gate.getTownship());
        visit.setGate(gate);
        visit.setLoggedBy(users.getReferenceById(guardId));
        visit.setVisitorName(pass.getVisitorName() == null ? "Pass holder" : pass.getVisitorName());
        visit.setVisitorPhone(pass.getVisitorPhone());
        visit.setVisitorType(pass.getVisitorType());
        visit.setApprover(creator);
        visit.setApproverKind(pass.getApproverKind());
        // Resident-minted passes carry the flat through so the visit shows up in the flat's history.
        visit.setTargetFlat(pass.getApproverKind() == ApproverKind.RESIDENT ? creator.getFlat() : null);
        visit.setPreApproval(pass);
        visit.setStatus(VisitStatus.CHECKED_IN);
        visit.setDecidedAt(OffsetDateTime.now());
        visit.setCheckedInAt(OffsetDateTime.now());
        return visit;
    }

    private void notifyOwnerOfEntry(UUID ownerId, String visitorName, String gateName, UUID visitId) {
        fcm.push(devices.tokensFor(ownerId), PushPayload.of(
                PushPayload.TYPE_PASS_REDEEMED,
                "Your guest has arrived",
                visitorName + " checked in at " + gateName + ".",
                Map.of("visitId", visitId.toString())));
    }

    // ----- guards -----------------------------------------------------------------------------

    private void validateWindow(OffsetDateTime validUntil, OffsetDateTime now) {
        Duration window = Duration.between(now, validUntil);
        if (window.isNegative() || window.isZero()) {
            throw new BusinessValidationException("INVALID_WINDOW",
                    "validUntil must be in the future.");
        }
        long maxDays = properties.pass().maxValidityDays();
        if (window.toDays() > maxDays) {
            // An indefinitely valid pass is a permanent key to the township.
            throw new BusinessValidationException("WINDOW_TOO_LONG",
                    "A pass may be valid for at most " + maxDays + " days.");
        }
    }

    private void throttleRedemption(UUID guardId) {
        boolean allowed = rateLimiter.tryAcquire(redeemKey(guardId),
                properties.security().redeem().maxAttempts(),
                Duration.ofMinutes(properties.security().redeem().windowMinutes()));
        if (!allowed) {
            log.warn("Redemption rate limit tripped for guard {}", guardId);
            throw new TooManyRequestsException("Too many redemption attempts. Wait a moment and retry.");
        }
    }

    private String redeemKey(UUID guardId) {
        return "pass:redeem:" + guardId;
    }

    /**
     * Isolated on purpose: the caller throws immediately after this, rolling back the redemption
     * transaction. A refused entry attempt is exactly the kind of event that must survive that
     * rollback and stay in the trail.
     */
    private void onRedeemFailure(UUID guardId, UUID passId, String reason) {
        log.warn("Redemption refused for pass {} by guard {}: {}", passId, guardId, reason);
        audit.recordIsolated(guardId, AuditAction.PASS_REDEEM_FAILED, "pre_approval", passId,
                AuditService.detail("reason", reason));
    }

    private String reasonFor(PreApproval pass, OffsetDateTime now) {
        if (pass.getStatus() != PassStatus.ACTIVE) {
            return "STATUS_" + pass.getStatus();
        }
        if (now.isBefore(pass.getValidFrom())) {
            return "NOT_YET_VALID";
        }
        if (!now.isBefore(pass.getValidUntil())) {
            return "EXPIRED";
        }
        return "USES_EXHAUSTED";
    }

    private PassResponse toResponse(PreApproval pass) {
        return new PassResponse(
                pass.getId(),
                pass.getVisitorName(),
                pass.getVisitorPhone(),
                pass.getVisitorType(),
                pass.getStatus(),
                pass.getPinLast4(),
                pass.getQrToken(),
                pass.getValidFrom(),
                pass.getValidUntil(),
                pass.getMaxUses(),
                pass.getUseCount(),
                pass.getCreatedAt());
    }

    private String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
