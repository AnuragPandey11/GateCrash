package com.gatecrash.move;

import com.gatecrash.billing.BillingService;
import com.gatecrash.billing.dto.BillingDtos.DuesSummary;
import com.gatecrash.common.AfterCommitExecutor;
import com.gatecrash.common.PageResponse;
import com.gatecrash.common.TownshipClock;
import com.gatecrash.common.audit.AuditAction;
import com.gatecrash.common.audit.AuditService;
import com.gatecrash.common.exception.BusinessValidationException;
import com.gatecrash.common.exception.ConflictException;
import com.gatecrash.common.exception.ForbiddenException;
import com.gatecrash.common.exception.NotFoundException;
import com.gatecrash.common.tenant.TenantContext;
import com.gatecrash.move.dto.MoveDtos.CreateMoveRequest;
import com.gatecrash.move.dto.MoveDtos.MoveDecision;
import com.gatecrash.move.dto.MoveDtos.MoveResponse;
import com.gatecrash.push.UserNotifier;
import com.gatecrash.security.SecurityUtils;
import com.gatecrash.user.AppUser;
import com.gatecrash.user.AppUserRepository;
import com.gatecrash.user.UserRole;
import com.gatecrash.user.UserService;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Pageable;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.EnumSet;
import java.util.List;
import java.util.UUID;

/**
 * Move-in / move-out.
 *
 * <p>The flow: a resident asks for a date and a time window (with the truck and the number of
 * helpers), the society office approves or rejects it -- seeing the unit's unpaid bills while it
 * decides -- and the resident is told. On the day, approved moves appear on the guard's console as
 * the material gate pass. Afterwards the office marks the move completed; completing a move-out can
 * also deactivate the household's accounts, because people who have left must stop being able to
 * approve visitors.
 *
 * <p>A move-in needs the resident's account to exist first: accounts are only ever provisioned by
 * the office, so the office creates the account, and the new resident then books the move.
 */
@Service
@RequiredArgsConstructor
public class MoveService {

    public static final String KIND = "MOVE";

    private static final int MAX_DAYS_AHEAD = 90;

    private final MoveRequestRepository moves;
    private final AppUserRepository users;
    private final UserService userService;
    private final BillingService billing;
    private final TownshipClock clock;
    private final AuditService audit;
    private final UserNotifier notifier;
    private final AfterCommitExecutor afterCommit;

    @PreAuthorize("hasRole('RESIDENT')")
    @Transactional
    public MoveResponse request(CreateMoveRequest request) {
        UUID townshipId = TenantContext.requireTownshipId();
        UUID me = SecurityUtils.currentUserId();
        AppUser resident = users.findByIdAndTownship_Id(me, townshipId)
                .orElseThrow(() -> NotFoundException.of("User", me));
        if (resident.getUnit() == null) {
            throw new BusinessValidationException("NO_UNIT", "Your account is not linked to a home.");
        }
        if (!request.timeTo().isAfter(request.timeFrom())) {
            throw new BusinessValidationException("INVALID_WINDOW", "The end time must be after the start time.");
        }
        if (request.moveDate().isBefore(clock.today())
                || request.moveDate().isAfter(clock.today().plusDays(MAX_DAYS_AHEAD))) {
            throw new BusinessValidationException("INVALID_DATE",
                    "Pick a date between today and " + MAX_DAYS_AHEAD + " days from now.");
        }
        if (moves.existsByUnit_IdAndMoveTypeAndStatusIn(resident.getUnit().getId(), request.moveType(),
                EnumSet.of(MoveStatus.PENDING, MoveStatus.APPROVED))) {
            throw new ConflictException("MOVE_ALREADY_REQUESTED",
                    "Your home already has an open request of this kind.");
        }

        MoveRequest move = new MoveRequest();
        move.setTownshipId(townshipId);
        move.setUnit(resident.getUnit());
        move.setRequestedBy(resident);
        move.setMoveType(request.moveType());
        move.setMoveDate(request.moveDate());
        move.setTimeFrom(request.timeFrom());
        move.setTimeTo(request.timeTo());
        move.setVehicleDetails(blankToNull(request.vehicleDetails()));
        move.setHelpersCount(request.helpersCount());
        move.setNotes(blankToNull(request.notes()));
        moves.save(move);
        audit.record(AuditAction.MOVE_REQUESTED, "move_request", move.getId(),
                AuditService.detail("type", move.getMoveType(), "date", move.getMoveDate().toString()));

        List<UUID> admins = users.findByTownship_IdAndRoleOrderByFullNameAsc(townshipId, UserRole.ADMIN)
                .stream().filter(AppUser::isActive).map(AppUser::getId).toList();
        UUID moveId = move.getId();
        String title = (move.getMoveType() == MoveType.MOVE_IN ? "Move-in" : "Move-out")
                + " request from " + resident.getUnitCode();
        String body = "For " + move.getMoveDate() + ", " + move.getTimeFrom() + "–" + move.getTimeTo();
        afterCommit.execute(() -> notifier.notify(admins, KIND, moveId, title, body));
        return toResponse(move, false);
    }

    @PreAuthorize("hasRole('RESIDENT')")
    @Transactional(readOnly = true)
    public List<MoveResponse> mine() {
        return moves.findTop50ByTownshipIdAndRequestedBy_IdOrderByCreatedAtDesc(
                        TenantContext.requireTownshipId(), SecurityUtils.currentUserId())
                .stream().map(m -> toResponse(m, false)).toList();
    }

    @PreAuthorize("hasRole('RESIDENT')")
    @Transactional
    public MoveResponse cancel(UUID moveId) {
        MoveRequest move = lock(moveId);
        if (!move.getRequestedBy().getId().equals(SecurityUtils.currentUserId())) {
            throw new ForbiddenException("This is not your request.");
        }
        transition(move, MoveStatus.CANCELLED);
        audit.record(AuditAction.MOVE_CANCELLED, "move_request", moveId, null);
        return toResponse(move, false);
    }

    /** The guard's material gate pass: approved moves happening today. */
    @PreAuthorize("hasAnyRole('GUARD','ADMIN')")
    @Transactional(readOnly = true)
    public List<MoveResponse> today() {
        return moves.findByTownshipIdAndStatusAndMoveDateOrderByTimeFromAsc(
                        TenantContext.requireTownshipId(), MoveStatus.APPROVED, clock.today())
                .stream().map(m -> toResponse(m, false)).toList();
    }

    @PreAuthorize("hasRole('ADMIN')")
    @Transactional(readOnly = true)
    public PageResponse<MoveResponse> list(MoveStatus status, Pageable pageable) {
        UUID townshipId = TenantContext.requireTownshipId();
        return PageResponse.of(status == null
                ? moves.findByTownshipIdOrderByMoveDateDescCreatedAtDesc(townshipId, pageable)
                : moves.findByTownshipIdAndStatusOrderByMoveDateAscCreatedAtAsc(townshipId, status, pageable),
                m -> toResponse(m, true));
    }

    @PreAuthorize("hasRole('ADMIN')")
    @Transactional
    public MoveResponse decide(UUID moveId, MoveDecision decision, String note) {
        MoveRequest move = lock(moveId);
        MoveStatus target = decision == MoveDecision.APPROVED ? MoveStatus.APPROVED : MoveStatus.REJECTED;
        if (target == MoveStatus.REJECTED && (note == null || note.isBlank())) {
            throw new BusinessValidationException("REASON_REQUIRED", "Tell the resident why it was rejected.");
        }
        transition(move, target);
        move.setAdminNote(blankToNull(note));
        move.setDecidedBy(users.getReferenceById(SecurityUtils.currentUserId()));
        move.setDecidedAt(OffsetDateTime.now());
        moves.save(move);
        audit.record(AuditAction.MOVE_DECIDED, "move_request", moveId, AuditService.detail("decision", target));

        UUID residentId = move.getRequestedBy().getId();
        String label = move.getMoveType() == MoveType.MOVE_IN ? "move-in" : "move-out";
        String title = "Your " + label + " was " + (target == MoveStatus.APPROVED ? "approved" : "rejected");
        String body = move.getAdminNote() != null ? move.getAdminNote()
                : "For " + move.getMoveDate() + ", " + move.getTimeFrom() + "–" + move.getTimeTo();
        afterCommit.execute(() -> notifier.notify(List.of(residentId), KIND, moveId, title, body));
        return toResponse(move, true);
    }

    @PreAuthorize("hasRole('ADMIN')")
    @Transactional
    public MoveResponse complete(UUID moveId, boolean deactivateResidents) {
        MoveRequest move = lock(moveId);
        transition(move, MoveStatus.COMPLETED);
        move.setCompletedAt(OffsetDateTime.now());
        moves.saveAndFlush(move);
        // Built before any deactivation: ending sessions clears the persistence context (a bulk
        // token-version update), after which this request's entities are detached.
        MoveResponse response = toResponse(move, true);
        UUID unitId = move.getUnit().getId();
        boolean moveOut = move.getMoveType() == MoveType.MOVE_OUT;

        int deactivated = 0;
        if (deactivateResidents && moveOut) {
            for (AppUser resident : users.findByUnit_IdAndRoleAndActiveTrue(unitId, UserRole.RESIDENT)) {
                // Through UserService so it ends their sessions exactly as a manual deactivation does.
                userService.setActive(resident.getId(), false);
                deactivated++;
            }
        }
        audit.record(AuditAction.MOVE_COMPLETED, "move_request", moveId,
                AuditService.detail("deactivatedResidents", deactivated));
        return response;
    }

    private MoveRequest lock(UUID moveId) {
        return moves.findByIdForUpdate(moveId, TenantContext.requireTownshipId())
                .orElseThrow(() -> NotFoundException.of("Move request", moveId));
    }

    private void transition(MoveRequest move, MoveStatus target) {
        if (!move.getStatus().canTransitionTo(target)) {
            throw ConflictException.illegalTransition("Move request", move.getStatus(), target);
        }
        move.setStatus(target);
    }

    private MoveResponse toResponse(MoveRequest m, boolean withDues) {
        DuesSummary dues = withDues ? billing.duesFor(m.getUnit().getId()) : null;
        return new MoveResponse(m.getId(), m.getUnit().getId(), m.getUnit().getCode(),
                m.getRequestedBy().getFullName(), m.getMoveType(), m.getMoveDate(), m.getTimeFrom(),
                m.getTimeTo(), m.getVehicleDetails(), m.getHelpersCount(), m.getNotes(), m.getStatus(),
                m.getAdminNote(), m.getDecidedBy() == null ? null : m.getDecidedBy().getFullName(),
                m.getDecidedAt(), m.getCompletedAt(), m.getCreatedAt(),
                dues == null ? null : dues.unpaidCount(), dues == null ? null : dues.unpaidAmountPaise());
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
