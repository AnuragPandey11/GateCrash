package com.gatecrash.visit;

import com.gatecrash.common.AfterCommitExecutor;
import com.gatecrash.common.PageResponse;
import com.gatecrash.common.SafeUrl;
import com.gatecrash.common.audit.AuditAction;
import com.gatecrash.common.audit.AuditService;
import com.gatecrash.common.exception.BusinessValidationException;
import com.gatecrash.common.exception.ConflictException;
import com.gatecrash.common.exception.ForbiddenException;
import com.gatecrash.common.exception.TooManyRequestsException;
import com.gatecrash.common.exception.NotFoundException;
import com.gatecrash.common.tenant.TenantContext;
import com.gatecrash.pass.PinHasher;
import com.gatecrash.push.UserNotifier;
import com.gatecrash.rules.EntryRule;
import com.gatecrash.rules.EntryRuleService;
import com.gatecrash.security.AppUserDetails;
import com.gatecrash.security.FixedWindowRateLimiter;
import com.gatecrash.security.SecurityUtils;
import com.gatecrash.property.PropertyNode;
import com.gatecrash.property.PropertyService;
import com.gatecrash.township.Gate;
import com.gatecrash.township.TownshipService;
import com.gatecrash.user.AppUser;
import com.gatecrash.user.AppUserRepository;
import com.gatecrash.user.PasswordGenerator;
import com.gatecrash.user.UserRole;
import com.gatecrash.visit.dto.VisitDtos.CollectionCodeResponse;
import com.gatecrash.visit.dto.VisitDtos.CreateVisitRequest;
import com.gatecrash.visit.dto.VisitDtos.Decision;
import com.gatecrash.visit.dto.VisitDtos.VisitResponse;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

/**
 * The visitor-management core: logging an arrival, routing it, and driving it through the FSM.
 *
 * <p>Authorization is layered, and every layer is load-bearing:
 * <ol>
 *   <li>{@code @PreAuthorize} settles what <em>role</em> may call the method at all.</li>
 *   <li>An ownership re-check settles whether this specific caller may touch this specific row.
 *       A resident holding a valid RESIDENT token still cannot decide a visit routed to a different
 *       flat -- the visit id in the URL is attacker-controlled and is never trusted on its own.</li>
 *   <li>{@link VisitStatus#canTransitionTo} settles whether the move is legal at all, so an already
 *       rejected visit cannot be flipped to approved by replaying a request.</li>
 * </ol>
 *
 * <p>Underneath all three sits the tenant boundary: every lookup here resolves by
 * {@code (id, townshipId)}, so a visit id belonging to another township is a 404 before any of the
 * checks above even run. And because {@code visitor_log} carries composite foreign keys back to its
 * gate, guard, approver, flat and pass, a visit that mixed two townships could not be persisted even
 * if all three layers were bypassed.
 *
 * <p>Every transition takes a pessimistic row lock, writes an audit row inside the same transaction,
 * and dispatches its notifications only after that transaction commits.
 */
@Service
@RequiredArgsConstructor
public class VisitService {

    private static final Logger log = LoggerFactory.getLogger(VisitService.class);

    private final VisitorLogRepository visits;
    private final AppUserRepository users;
    private final TownshipService township;
    private final PropertyService property;
    private final VisitMapper mapper;
    private final VisitNotifier notifier;
    private final AuditService audit;
    private final AfterCommitExecutor afterCommit;
    private final PinHasher codeHasher;
    private final PasswordGenerator generator;
    private final FixedWindowRateLimiter rateLimiter;
    private final EntryRuleService entryRules;
    private final UserNotifier userNotifier;

    /** Wrong collection codes allowed per visit per window: six digits must not be guessable. */
    private static final int COLLECT_MAX_ATTEMPTS = 5;
    private static final Duration COLLECT_WINDOW = Duration.ofMinutes(15);

    // ----- creation ---------------------------------------------------------------------------

    /**
     * Logs a walk-in and routes it. A visitor with "Meet Sales Agent" ticked goes to the chosen
     * on-duty sales agent; everyone else goes to the target unit's residents.
     */
    @PreAuthorize("hasRole('GUARD')")
    @Transactional
    public VisitResponse createVisit(CreateVisitRequest request) {
        AppUserDetails guard = SecurityUtils.currentUser();
        // Resolved within the caller's township, so a gate id from elsewhere is a 404, not a route.
        Gate gate = township.requireGate(request.gateId());

        VisitorLog visit = new VisitorLog();
        // Taken from the gate rather than from the context, so the visit's tenant and its gate's
        // tenant are the same value by construction, not by coincidence.
        visit.setTownship(gate.getTownship());
        visit.setGate(gate);
        visit.setLoggedBy(users.getReferenceById(guard.getId()));
        visit.setVisitorName(request.visitorName().trim());
        visit.setVisitorPhone(blankToNull(request.visitorPhone()));
        visit.setVisitorType(request.visitorType());
        visit.setMeetSalesAgent(request.isMeetSalesAgent());
        visit.setVehicleNo(blankToNull(request.vehicleNo()));
        visit.setPhotoUrl(SafeUrl.validateHttps(request.photoUrl(), "photoUrl"));
        visit.setPurpose(blankToNull(request.purpose()));
        visit.setExpectedDurationMinutes(request.expectedDurationMinutes());
        visit.setStatus(VisitStatus.PENDING);

        List<UUID> notifyUserIds = request.isMeetSalesAgent()
                ? routeToSales(visit, request)
                : routeToFlat(visit, request);

        // A society rule the household has had approved lets this visitor straight in: the visit is
        // born APPROVED and nobody's phone has to ring for a decision. Sales visits never qualify.
        EntryRule rule = visit.getApproverKind() == ApproverKind.RESIDENT
                ? entryRules.findMatching(visit.getTargetFlatId(), visit.getVisitorType(),
                        visit.getVisitorName(), visit.getPurpose(), visit.getVisitorPhone()).orElse(null)
                : null;
        if (rule != null) {
            transition(visit, VisitStatus.APPROVED);
            visit.setDecidedAt(OffsetDateTime.now());
            visit.setEntryRuleId(rule.getId());
        }

        visits.save(visit);
        audit.record(AuditAction.VISIT_LOGGED, "visitor_log", visit.getId(),
                AuditService.detail(
                        "gateId", gate.getId(),
                        "visitorType", visit.getVisitorType(),
                        "meetSalesAgent", visit.isMeetSalesAgent(),
                        "approverKind", visit.getApproverKind(),
                        "targetFlatId", visit.getTargetFlatId(),
                        "approverId", visit.getApproverId()));
        log.info("Visit {} logged at gate {} by guard {}", visit.getId(), gate.getId(), guard.getId());

        UUID visitId = visit.getId();
        if (rule != null) {
            audit.record(AuditAction.VISIT_AUTO_APPROVED, "visitor_log", visitId,
                    AuditService.detail("entryRuleId", rule.getId()));
            UUID gateId = gate.getId();
            String visitorName = visit.getVisitorName();
            String ruleLabel = rule.getLabel();
            OffsetDateTime decidedAt = visit.getDecidedAt();
            afterCommit.execute(() -> {
                // Other devices at this gate flip too; the household is told, not asked.
                notifier.visitDecided(visitId, gateId, VisitStatus.APPROVED, visitorName, "Society rule", decidedAt);
                userNotifier.notify(notifyUserIds, "VISIT", visitId, visitorName + " was let in",
                        "Allowed by your rule: " + ruleLabel);
            });
        } else {
            afterCommit.execute(() -> notifier.visitRequested(visitId, notifyUserIds));
        }

        return mapper.toResponse(visit);
    }

    /** @return the user ids to notify -- the agent themselves */
    private List<UUID> routeToSales(VisitorLog visit, CreateVisitRequest request) {
        if (request.salesAgentId() == null) {
            throw new BusinessValidationException("SALES_AGENT_REQUIRED",
                    "salesAgentId is required when the visitor is here to meet a sales agent.");
        }
        AppUser agent = users
                .findByIdAndTownship_Id(request.salesAgentId(), TenantContext.requireTownshipId())
                .orElseThrow(() -> NotFoundException.of("Sales agent", request.salesAgentId()));

        if (!agent.isSales() || !agent.isActive()) {
            throw new BusinessValidationException("NOT_A_SALES_AGENT",
                    "The selected approver is not an active sales agent.");
        }
        if (!agent.isOnDuty()) {
            // The dropdown only offers on-duty agents; a request naming an off-duty one is either a
            // stale client or someone editing the payload, and would strand the visitor at the gate.
            throw new BusinessValidationException("AGENT_OFF_DUTY",
                    "That sales agent is not currently on duty.");
        }

        visit.setApprover(agent);
        visit.setApproverKind(ApproverKind.SALES);
        return List.of(agent.getId());
    }

    /** @return the user ids to notify -- every active resident of the unit */
    private List<UUID> routeToFlat(VisitorLog visit, CreateVisitRequest request) {
        if (request.targetFlatId() == null) {
            throw new BusinessValidationException("TARGET_FLAT_REQUIRED",
                    "targetFlatId is required unless the visitor is here to meet a sales agent.");
        }
        // requireUnit, not requireNode: a visit is routed to the people who live somewhere, so a
        // guard naming a whole tower is a request that cannot be satisfied, not one to route wide.
        PropertyNode unit = property.requireUnit(request.targetFlatId());
        List<AppUser> residents = users.findByUnit_IdAndRoleAndActiveTrue(unit.getId(), UserRole.RESIDENT);
        if (residents.isEmpty()) {
            throw new BusinessValidationException("NO_RESIDENT",
                    "That unit has no active resident account to approve the visit.");
        }

        visit.setTargetUnit(unit);
        visit.setApproverKind(ApproverKind.RESIDENT);
        // A nominated approver is persisted for reporting, but every resident of the unit is notified
        // and any of them may decide -- see the ownership check in decide().
        visit.setApprover(residents.get(0));
        return residents.stream().map(AppUser::getId).toList();
    }

    // ----- transitions ------------------------------------------------------------------------

    @PreAuthorize("hasAnyRole('RESIDENT','SALES')")
    @Transactional
    public VisitResponse decide(UUID visitId, Decision decision) {
        return decide(visitId, decision, null);
    }

    /**
     * The approver's answer. Three outcomes:
     * <ul>
     *   <li>{@code APPROVED} -- optionally with how long the visitor will stay, if the guard did
     *       not say. That duration is what the overstay alert later measures against.</li>
     *   <li>{@code REJECTED}.</li>
     *   <li>{@code LEAVE_AT_GATE} -- deliveries to a household only. The courier stays out, security
     *       keeps the parcel, and the response carries a six-digit collection code exactly once.</li>
     * </ul>
     */
    @PreAuthorize("hasAnyRole('RESIDENT','SALES')")
    @Transactional
    public VisitResponse decide(UUID visitId, Decision decision, Integer expectedDurationMinutes) {
        AppUserDetails caller = SecurityUtils.currentUser();
        VisitorLog visit = lockVisit(visitId);

        requireApprover(visit, caller);

        VisitStatus target = switch (decision) {
            case APPROVED -> VisitStatus.APPROVED;
            case REJECTED -> VisitStatus.REJECTED;
            case LEAVE_AT_GATE -> VisitStatus.LEFT_AT_GATE;
        };
        if (decision == Decision.LEAVE_AT_GATE
                && (visit.getVisitorType() != VisitorType.DELIVERY
                    || visit.getApproverKind() != ApproverKind.RESIDENT)) {
            throw new BusinessValidationException("LEAVE_AT_GATE_DELIVERY_ONLY",
                    "Only a delivery to a household can be left at the gate.");
        }
        transition(visit, target);
        visit.setDecidedAt(OffsetDateTime.now());
        if (decision == Decision.APPROVED && expectedDurationMinutes != null
                && visit.getExpectedDurationMinutes() == null) {
            visit.setExpectedDurationMinutes(expectedDurationMinutes);
        }
        String collectionCode = null;
        if (decision == Decision.LEAVE_AT_GATE) {
            collectionCode = issueCollectionCode(visit);
        }
        visits.save(visit);

        AppUser decider = users.getReferenceById(caller.getId());
        String action = switch (decision) {
            case APPROVED -> AuditAction.VISIT_APPROVED;
            case REJECTED -> AuditAction.VISIT_REJECTED;
            case LEAVE_AT_GATE -> AuditAction.VISIT_LEFT_AT_GATE;
        };
        audit.record(action, "visitor_log", visitId, AuditService.detail("decidedBy", caller.getId()));
        log.info("Visit {} {} by user {}", visitId, target, caller.getId());

        UUID gateId = visit.getGate().getId();
        String visitorName = visit.getVisitorName();
        String deciderName = decider.getFullName();
        OffsetDateTime decidedAt = visit.getDecidedAt();
        afterCommit.execute(() ->
                notifier.visitDecided(visitId, gateId, target, visitorName, deciderName, decidedAt));

        return mapper.toResponse(visit, collectionCode);
    }

    @PreAuthorize("hasRole('GUARD')")
    @Transactional
    public VisitResponse checkIn(UUID visitId) {
        VisitorLog visit = lockVisit(visitId);
        transition(visit, VisitStatus.CHECKED_IN);
        OffsetDateTime now = OffsetDateTime.now();
        visit.setCheckedInAt(now);
        if (visit.getExpectedDurationMinutes() != null && visit.getExpectedOutAt() == null) {
            visit.setExpectedOutAt(now.plusMinutes(visit.getExpectedDurationMinutes()));
        }
        visits.save(visit);

        audit.record(AuditAction.VISIT_CHECKED_IN, "visitor_log", visitId, null);
        publishOccupancy(visit);
        return mapper.toResponse(visit);
    }

    @PreAuthorize("hasRole('GUARD')")
    @Transactional
    public VisitResponse checkOut(UUID visitId) {
        VisitorLog visit = lockVisit(visitId);
        transition(visit, VisitStatus.CHECKED_OUT);
        visit.setCheckedOutAt(OffsetDateTime.now());
        visits.save(visit);

        audit.record(AuditAction.VISIT_CHECKED_OUT, "visitor_log", visitId, null);
        publishOccupancy(visit);
        return mapper.toResponse(visit);
    }

    // ----- Leave at Gate ----------------------------------------------------------------------

    /**
     * A resident who lost the code asks for a new one. The old code stops working at once -- only
     * the latest digest is kept -- so a code read over someone's shoulder cannot be replayed.
     */
    @PreAuthorize("hasRole('RESIDENT')")
    @Transactional
    public CollectionCodeResponse reissueCollectionCode(UUID visitId) {
        AppUserDetails caller = SecurityUtils.currentUser();
        VisitorLog visit = lockVisit(visitId);
        requireApprover(visit, caller);
        if (visit.getStatus() != VisitStatus.LEFT_AT_GATE) {
            throw new ConflictException("NOT_AT_GATE", "There is no parcel waiting at the gate for this visit.");
        }
        String code = issueCollectionCode(visit);
        visits.save(visit);
        audit.record(AuditAction.VISIT_COLLECTION_CODE_REISSUED, "visitor_log", visitId, null);
        return new CollectionCodeResponse(visitId, code);
    }

    /**
     * The guard hands a parcel over against the resident's code. Attempts are rate-limited per
     * visit, and every wrong code is audited, because a million combinations is only safe when
     * nobody can try them all.
     */
    @PreAuthorize("hasRole('GUARD')")
    @Transactional
    public VisitResponse collectParcel(UUID visitId, String code) {
        VisitorLog visit = lockVisit(visitId);
        if (visit.getStatus() != VisitStatus.LEFT_AT_GATE) {
            throw new ConflictException("NOT_AT_GATE", "There is no parcel waiting at the gate for this visit.");
        }
        String key = "collect:" + visitId;
        if (!rateLimiter.tryAcquire(key, COLLECT_MAX_ATTEMPTS, COLLECT_WINDOW)) {
            throw new TooManyRequestsException("Too many wrong codes for this parcel. Try again later.");
        }
        String expected = visit.getCollectionCodeLookup();
        String supplied = codeHasher.lookupValue(code);
        if (expected == null || !MessageDigest.isEqual(
                expected.getBytes(StandardCharsets.UTF_8), supplied.getBytes(StandardCharsets.UTF_8))) {
            audit.record(AuditAction.VISIT_PARCEL_COLLECT_FAILED, "visitor_log", visitId, null);
            throw new BusinessValidationException("WRONG_COLLECTION_CODE", "That collection code is not correct.");
        }
        rateLimiter.reset(key);
        transition(visit, VisitStatus.COLLECTED);
        visit.setCollectedAt(OffsetDateTime.now());
        visit.setCollectionCodeLookup(null);
        visits.save(visit);
        audit.record(AuditAction.VISIT_PARCEL_COLLECTED, "visitor_log", visitId, null);
        return mapper.toResponse(visit);
    }

    // ----- duration -----------------------------------------------------------------------------

    /**
     * The host extends a stay. Counted from the later of now and the current expected exit, so
     * extending an already-overdue visit by an hour means "an hour from now", not "an hour after a
     * time that has passed". Clearing the alert stamp is what lets the alarm fire again later.
     */
    @PreAuthorize("hasAnyRole('RESIDENT','SALES')")
    @Transactional
    public VisitResponse extendStay(UUID visitId, int extendMinutes) {
        AppUserDetails caller = SecurityUtils.currentUser();
        VisitorLog visit = lockVisit(visitId);
        requireApprover(visit, caller);
        if (visit.getStatus() != VisitStatus.CHECKED_IN && visit.getStatus() != VisitStatus.APPROVED) {
            throw new ConflictException("NOT_INSIDE", "Only a visitor who is approved or inside can have their stay extended.");
        }

        OffsetDateTime now = OffsetDateTime.now();
        if (visit.getStatus() == VisitStatus.APPROVED) {
            int base = visit.getExpectedDurationMinutes() == null ? 0 : visit.getExpectedDurationMinutes();
            visit.setExpectedDurationMinutes(clampDuration(base + extendMinutes));
        } else {
            OffsetDateTime from = visit.getExpectedOutAt() == null || visit.getExpectedOutAt().isBefore(now)
                    ? now : visit.getExpectedOutAt();
            OffsetDateTime newOut = from.plusMinutes(extendMinutes);
            long total = Duration.between(visit.getCheckedInAt(), newOut).toMinutes();
            if (total > VisitDtosBounds.MAX) {
                throw new BusinessValidationException("STAY_TOO_LONG", "A visit cannot be extended beyond seven days.");
            }
            visit.setExpectedOutAt(newOut);
            visit.setExpectedDurationMinutes(clampDuration((int) total));
            visit.setOverstayAlertedAt(null);
        }
        visits.save(visit);
        audit.record(AuditAction.VISIT_STAY_EXTENDED, "visitor_log", visitId,
                AuditService.detail("extendMinutes", extendMinutes, "by", caller.getId()));

        UUID gateId = visit.getGate().getId();
        String visitorName = visit.getVisitorName();
        OffsetDateTime expectedOut = visit.getExpectedOutAt();
        String byName = users.findById(caller.getId()).map(AppUser::getFullName).orElse(null);
        afterCommit.execute(() -> notifier.stayExtended(visitId, gateId, visitorName, expectedOut, byName));
        return mapper.toResponse(visit);
    }

    // ----- reads ------------------------------------------------------------------------------

    /**
     * The caller's own visit history: their household's for a resident, their own for a sales
     * agent. Every visit, every outcome, newest first.
     */
    @PreAuthorize("hasAnyRole('RESIDENT','SALES')")
    @Transactional(readOnly = true)
    public PageResponse<VisitResponse> historyForCurrentUser(Pageable pageable) {
        AppUserDetails caller = SecurityUtils.currentUser();
        if (caller.getRole() == UserRole.RESIDENT) {
            if (caller.getFlatId() == null) {
                return PageResponse.of(org.springframework.data.domain.Page.<VisitorLog>empty(pageable),
                        (VisitorLog v) -> mapper.toResponse(v));
            }
            return PageResponse.of(
                    visits.findByTargetUnit_IdOrderByCreatedAtDesc(caller.getFlatId(), pageable),
                    (VisitorLog v) -> mapper.toResponse(v));
        }
        return PageResponse.of(visits.findByApprover_IdAndApproverKindOrderByCreatedAtDesc(
                caller.getId(), ApproverKind.SALES, pageable), (VisitorLog v) -> mapper.toResponse(v));
    }

    /**
     * A single visit. Readable by the guard force, the routed approver, and admins -- and by nobody
     * else, because the record names a visitor, a flat and a vehicle.
     */
    @Transactional(readOnly = true)
    public VisitResponse get(UUID visitId) {
        VisitorLog visit = visits.findDetailedById(visitId, TenantContext.requireTownshipId())
                .orElseThrow(() -> NotFoundException.of("Visit", visitId));

        AppUserDetails caller = SecurityUtils.currentUser();
        boolean permitted = switch (caller.getRole()) {
            // SUPER_ADMIN reaches this only through a township it named explicitly, and the lookup
            // above has already confined the row to that township.
            case SUPER_ADMIN, ADMIN, GUARD -> true;
            case RESIDENT -> isApprover(visit, caller);
        };
        if (!permitted) {
            throw new ForbiddenException("This visit is not routed to you.");
        }
        return mapper.toResponse(visit);
    }

    /** The approver's open queue: their own for sales, the whole flat's for residents. */
    @PreAuthorize("hasAnyRole('RESIDENT','SALES')")
    @Transactional(readOnly = true)
    public List<VisitResponse> pendingForCurrentUser() {
        AppUserDetails caller = SecurityUtils.currentUser();
        List<VisitorLog> pending = caller.getRole() == UserRole.RESIDENT
                ? residentPending(caller)
                : visits.findByApprover_IdAndStatusOrderByCreatedAtDesc(caller.getId(), VisitStatus.PENDING);
        return pending.stream().map(mapper::toResponse).toList();
    }

    @PreAuthorize("hasAnyRole('GUARD','ADMIN')")
    @Transactional(readOnly = true)
    public List<VisitResponse> recentForGate(UUID gateId, int limit) {
        township.requireGate(gateId);
        return visits.findByGate_IdOrderByCreatedAtDesc(gateId, PageRequest.of(0, limit))
                .map(mapper::toResponse)
                .getContent();
    }

    @PreAuthorize("hasRole('ADMIN')")
    @Transactional(readOnly = true)
    public List<VisitResponse> currentlyInside() {
        return visits.findByTownship_IdAndStatusOrderByCheckedInAtDesc(
                        TenantContext.requireTownshipId(), VisitStatus.CHECKED_IN).stream()
                .map(mapper::toResponse)
                .toList();
    }

    @PreAuthorize("hasRole('ADMIN')")
    @Transactional(readOnly = true)
    public long insideCount() {
        return visits.countByTownship_IdAndStatus(TenantContext.requireTownshipId(),
                VisitStatus.CHECKED_IN);
    }

    // ----- internals --------------------------------------------------------------------------

    private List<VisitorLog> residentPending(AppUserDetails caller) {
        if (caller.getFlatId() == null) {
            // resident_needs_flat makes this unreachable through normal provisioning.
            return List.of();
        }
        return visits.findByTargetUnit_IdAndStatusOrderByCreatedAtDesc(caller.getFlatId(), VisitStatus.PENDING);
    }

    private VisitorLog lockVisit(UUID visitId) {
        return visits.findByIdForUpdate(visitId, TenantContext.requireTownshipId())
                .orElseThrow(() -> NotFoundException.of("Visit", visitId));
    }

    /**
     * The ownership re-check. Resident routing is checked against the <em>flat</em>, not the nominated
     * approver id, because the household shares the decision -- a spouse must be able to answer. Sales
     * routing is personal, so it is checked against the user id.
     */
    private void requireApprover(VisitorLog visit, AppUserDetails caller) {
        if (!isApprover(visit, caller)) {
            log.warn("User {} attempted to decide visit {} routed elsewhere", caller.getId(), visit.getId());
            throw new ForbiddenException("This visit is not routed to you.");
        }
    }

    private boolean isApprover(VisitorLog visit, AppUserDetails caller) {
        if (visit.getApproverKind() == ApproverKind.RESIDENT) {
            UUID flatId = visit.getTargetFlatId();
            return caller.getRole() == UserRole.RESIDENT
                    && flatId != null
                    && flatId.equals(caller.getFlatId());
        }
        if (visit.getApproverKind() == ApproverKind.SALES) {
            return caller.isSales()
                    && caller.getId().equals(visit.getApproverId());
        }
        return false;
    }

    private void transition(VisitorLog visit, VisitStatus target) {
        VisitStatus current = visit.getStatus();
        if (!current.canTransitionTo(target)) {
            throw ConflictException.illegalTransition("Visit", current, target);
        }
        visit.setStatus(target);
    }

    private void publishOccupancy(VisitorLog visit) {
        UUID townshipId = visit.getTownshipId();
        UUID visitId = visit.getId();
        VisitStatus status = visit.getStatus();
        String visitorName = visit.getVisitorName();
        String gateName = visit.getGate().getName();
        afterCommit.execute(() ->
                notifier.occupancyChanged(townshipId, visitId, status, visitorName, gateName));
    }

    private String issueCollectionCode(VisitorLog visit) {
        String code = generator.generateNumericPin(6);
        visit.setCollectionCodeLookup(codeHasher.lookupValue(code));
        return code;
    }

    private static int clampDuration(int minutes) {
        return Math.max(VisitDtosBounds.MIN, Math.min(VisitDtosBounds.MAX, minutes));
    }

    /** Local aliases so the bounds read naturally in the arithmetic above. */
    private static final class VisitDtosBounds {
        static final int MIN = com.gatecrash.visit.dto.VisitDtos.MIN_DURATION_MINUTES;
        static final int MAX = com.gatecrash.visit.dto.VisitDtos.MAX_DURATION_MINUTES;
    }

    private String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
