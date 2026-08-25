package com.gatecrash.visit;

import com.gatecrash.common.AfterCommitExecutor;
import com.gatecrash.common.SafeUrl;
import com.gatecrash.common.audit.AuditAction;
import com.gatecrash.common.audit.AuditService;
import com.gatecrash.common.exception.BusinessValidationException;
import com.gatecrash.common.exception.ConflictException;
import com.gatecrash.common.exception.ForbiddenException;
import com.gatecrash.common.exception.NotFoundException;
import com.gatecrash.common.tenant.TenantContext;
import com.gatecrash.security.AppUserDetails;
import com.gatecrash.security.SecurityUtils;
import com.gatecrash.township.Flat;
import com.gatecrash.township.Gate;
import com.gatecrash.township.TownshipService;
import com.gatecrash.user.AppUser;
import com.gatecrash.user.AppUserRepository;
import com.gatecrash.user.UserRole;
import com.gatecrash.visit.dto.VisitDtos.CreateVisitRequest;
import com.gatecrash.visit.dto.VisitDtos.Decision;
import com.gatecrash.visit.dto.VisitDtos.VisitResponse;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

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
    private final VisitMapper mapper;
    private final VisitNotifier notifier;
    private final AuditService audit;
    private final AfterCommitExecutor afterCommit;

    // ----- creation ---------------------------------------------------------------------------

    /**
     * Logs a walk-in and routes it. CLIENT visits must go to an on-duty sales agent; everything else
     * goes to the target flat's residents.
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
        visit.setVehicleNo(blankToNull(request.vehicleNo()));
        visit.setPhotoUrl(SafeUrl.validateHttps(request.photoUrl(), "photoUrl"));
        visit.setStatus(VisitStatus.PENDING);

        List<UUID> notifyUserIds = request.visitorType() == VisitorType.CLIENT
                ? routeToSales(visit, request)
                : routeToFlat(visit, request);

        visits.save(visit);
        audit.record(AuditAction.VISIT_LOGGED, "visitor_log", visit.getId(),
                AuditService.detail(
                        "gateId", gate.getId(),
                        "visitorType", visit.getVisitorType(),
                        "approverKind", visit.getApproverKind(),
                        "targetFlatId", visit.getTargetFlatId(),
                        "approverId", visit.getApproverId()));
        log.info("Visit {} logged at gate {} by guard {}", visit.getId(), gate.getId(), guard.getId());

        UUID visitId = visit.getId();
        afterCommit.execute(() -> notifier.visitRequested(visitId, notifyUserIds));

        return mapper.toResponse(visit);
    }

    /** @return the user ids to notify -- the agent themselves */
    private List<UUID> routeToSales(VisitorLog visit, CreateVisitRequest request) {
        if (request.salesAgentId() == null) {
            throw new BusinessValidationException("SALES_AGENT_REQUIRED",
                    "salesAgentId is required for CLIENT visits.");
        }
        AppUser agent = users
                .findByIdAndTownship_Id(request.salesAgentId(), TenantContext.requireTownshipId())
                .orElseThrow(() -> NotFoundException.of("Sales agent", request.salesAgentId()));

        if (agent.getRole() != UserRole.SALES || !agent.isActive()) {
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

    /** @return the user ids to notify -- every active resident of the flat */
    private List<UUID> routeToFlat(VisitorLog visit, CreateVisitRequest request) {
        if (request.targetFlatId() == null) {
            throw new BusinessValidationException("TARGET_FLAT_REQUIRED",
                    "targetFlatId is required for non-CLIENT visits.");
        }
        Flat flat = township.requireFlat(request.targetFlatId());
        List<AppUser> residents = users.findByFlat_IdAndRoleAndActiveTrue(flat.getId(), UserRole.RESIDENT);
        if (residents.isEmpty()) {
            throw new BusinessValidationException("NO_RESIDENT",
                    "That flat has no active resident account to approve the visit.");
        }

        visit.setTargetFlat(flat);
        visit.setApproverKind(ApproverKind.RESIDENT);
        // A nominated approver is persisted for reporting, but every resident of the flat is notified
        // and any of them may decide -- see the ownership check in decide().
        visit.setApprover(residents.get(0));
        return residents.stream().map(AppUser::getId).toList();
    }

    // ----- transitions ------------------------------------------------------------------------

    @PreAuthorize("hasAnyRole('RESIDENT','SALES')")
    @Transactional
    public VisitResponse decide(UUID visitId, Decision decision) {
        AppUserDetails caller = SecurityUtils.currentUser();
        VisitorLog visit = lockVisit(visitId);

        requireApprover(visit, caller);

        VisitStatus target = decision == Decision.APPROVED ? VisitStatus.APPROVED : VisitStatus.REJECTED;
        transition(visit, target);
        visit.setDecidedAt(OffsetDateTime.now());
        visits.save(visit);

        AppUser decider = users.getReferenceById(caller.getId());
        audit.record(decision == Decision.APPROVED ? AuditAction.VISIT_APPROVED : AuditAction.VISIT_REJECTED,
                "visitor_log", visitId, AuditService.detail("decidedBy", caller.getId()));
        log.info("Visit {} {} by user {}", visitId, target, caller.getId());

        UUID gateId = visit.getGate().getId();
        String visitorName = visit.getVisitorName();
        String deciderName = decider.getFullName();
        OffsetDateTime decidedAt = visit.getDecidedAt();
        afterCommit.execute(() ->
                notifier.visitDecided(visitId, gateId, target, visitorName, deciderName, decidedAt));

        return mapper.toResponse(visit);
    }

    @PreAuthorize("hasRole('GUARD')")
    @Transactional
    public VisitResponse checkIn(UUID visitId) {
        VisitorLog visit = lockVisit(visitId);
        transition(visit, VisitStatus.CHECKED_IN);
        visit.setCheckedInAt(OffsetDateTime.now());
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

    // ----- reads ------------------------------------------------------------------------------

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
            case RESIDENT, SALES -> isApprover(visit, caller);
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
        return visits.findByTargetFlat_IdAndStatusOrderByCreatedAtDesc(caller.getFlatId(), VisitStatus.PENDING);
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
            return caller.getRole() == UserRole.SALES
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

    private String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
