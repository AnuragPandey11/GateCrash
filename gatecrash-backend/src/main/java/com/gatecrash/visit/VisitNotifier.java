package com.gatecrash.visit;

import com.gatecrash.user.UserRole;
import com.gatecrash.user.AppUserRepository;
import com.gatecrash.township.GateRepository;
import com.gatecrash.user.AppUser;
import com.gatecrash.device.DeviceService;
import com.gatecrash.push.FcmService;
import com.gatecrash.push.PushPayload;
import com.gatecrash.realtime.RealtimeEvents;
import com.gatecrash.realtime.RealtimeService;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * The dual-dispatch layer: FCM to wake a backgrounded phone, WebSocket to move a screen that is
 * already open. They are complementary, not redundant -- FCM cannot repaint the guard's tablet in
 * sub-second time, and a WebSocket frame cannot reach an app the OS has killed.
 *
 * <p>Everything here runs <em>after</em> the business transaction commits, so it re-reads the state
 * it is announcing in its own short read-only transaction. That keeps this class honest: it can only
 * announce what is actually durable.
 *
 * <p><b>Tenancy:</b> these methods run on a pool thread with no request behind them, so there is no
 * {@code TenantContext} to read. Every id they touch was handed to them by the transaction that just
 * committed -- never resolved from caller input -- so they use the unscoped detail fetch, and the
 * township is passed in explicitly where a destination needs it.
 */
@Service
@RequiredArgsConstructor
public class VisitNotifier {

    private static final Logger log = LoggerFactory.getLogger(VisitNotifier.class);

    private final VisitorLogRepository visits;
    private final DeviceService devices;
    private final FcmService fcm;
    private final RealtimeService realtime;
    private final AppUserRepository users;
    private final GateRepository gates;

    /** Step 4 of the approval loop: tell the routed approver(s) that someone is at the gate. */
    @Transactional(propagation = Propagation.REQUIRES_NEW, readOnly = true)
    public void visitRequested(UUID visitId, List<UUID> approverUserIds) {
        VisitorLog visit = visits.findDetailedByIdUnscoped(visitId).orElse(null);
        if (visit == null) {
            log.warn("Visit {} vanished before notification", visitId);
            return;
        }

        String gateName = visit.getGate().getName();
        String flatNumber = visit.getTargetUnit() == null ? null : visit.getTargetUnit().getCode();

        RealtimeEvents.VisitRequestedEvent event = RealtimeEvents.VisitRequestedEvent.of(
                visit.getId(), visit.getGate().getId(), gateName, visit.getVisitorName(),
                visit.getVisitorType(), flatNumber, visit.getCreatedAt());
        approverUserIds.forEach(userId -> realtime.toUser(userId, RealtimeService.QUEUE_VISITS, event));

        Map<String, String> data = new HashMap<>();
        data.put("visitId", visit.getId().toString());
        data.put("gateId", visit.getGate().getId().toString());
        data.put("gateName", gateName);
        data.put("visitorName", visit.getVisitorName());
        data.put("visitorType", visit.getVisitorType().name());
        if (flatNumber != null) {
            data.put("flatNumber", flatNumber);
        }

        fcm.push(devices.tokensFor(approverUserIds), PushPayload.of(
                PushPayload.TYPE_VISIT_REQUESTED,
                "Visitor at " + gateName,
                visit.getVisitorName() + " is asking to come in.",
                data));
    }

    /**
     * Step 8: flip the guard's screen. The WebSocket broadcast is the primary path; the FCM push to
     * the guard who logged the visit is the fallback for a dropped socket.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW, readOnly = true)
    public void visitDecided(UUID visitId, UUID gateId, VisitStatus status, String visitorName,
                             String decidedByName, OffsetDateTime decidedAt) {
        realtime.toGate(gateId, RealtimeEvents.VisitDecidedEvent.of(
                visitId, gateId, status, visitorName, decidedByName, decidedAt));

        visits.findDetailedByIdUnscoped(visitId).ifPresent(visit -> {
            UUID guardId = visit.getLoggedBy() == null ? null : visit.getLoggedBy().getId();
            if (guardId == null) {
                return;
            }
            fcm.push(devices.tokensFor(guardId), PushPayload.of(
                    PushPayload.TYPE_VISIT_DECIDED,
                    switch (status) {
                        case APPROVED -> "Visit approved";
                        case LEFT_AT_GATE -> "Leave at gate";
                        default -> "Visit rejected";
                    },
                    status == VisitStatus.LEFT_AT_GATE
                            ? "Keep the parcel from " + visitorName + " at the gate for collection."
                            : visitorName + " was " + status.name().toLowerCase() + ".",
                    Map.of("visitId", visitId.toString(),
                            "gateId", gateId.toString(),
                            "status", status.name())));
        });
    }

    /** Nobody answered within the TTL: unstick the gate screen rather than leaving it spinning. */
    public void visitExpired(UUID visitId, UUID gateId, String visitorName) {
        realtime.toGate(gateId, RealtimeEvents.VisitExpiredEvent.of(visitId, gateId, visitorName));
    }

    /**
     * Live occupancy for one township's admin dashboards. The count is scoped to the township too --
     * a platform-wide "currently inside" figure would be meaningless to every admin who saw it.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW, readOnly = true)
    public void occupancyChanged(UUID townshipId, UUID visitId, VisitStatus status, String visitorName,
                                 String gateName) {
        long inside = visits.countByTownship_IdAndStatus(townshipId, VisitStatus.CHECKED_IN);
        realtime.toAdminInside(townshipId, RealtimeEvents.OccupancyChangedEvent.of(
                visitId, status, visitorName, gateName, inside, OffsetDateTime.now()));
    }

    /**
     * The host extended a stay: clear the alarm and show the new exit time -- at every gate, since
     * the visitor may leave by any of them.
     */
    public void stayExtended(UUID townshipId, UUID visitId, UUID gateId, String visitorName,
                             OffsetDateTime expectedOutAt, String extendedByName) {
        toAllGates(townshipId, RealtimeEvents.VisitExtendedEvent.of(
                visitId, gateId, visitorName, expectedOutAt, extendedByName));
    }

    /** One frame to every gate of the township. Gates are few, and each guard watches their own. */
    private void toAllGates(UUID townshipId, Object event) {
        gates.findByTownship_IdOrderByNameAsc(townshipId).forEach(g -> realtime.toGate(g.getId(), event));
    }

    /**
     * A visitor is past their expected exit. Two audiences, by decision: the guard at the gate
     * (a live alarm on the console) and the hosts -- every active resident of the flat, or the
     * sales agent -- who can extend the stay from their own screen.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW, readOnly = true)
    public void overstay(UUID visitId) {
        VisitorLog visit = visits.findDetailedByIdUnscoped(visitId).orElse(null);
        if (visit == null) {
            return;
        }
        UUID gateId = visit.getGate().getId();
        String flatNumber = visit.getTargetUnit() == null ? null : visit.getTargetUnit().getCode();
        RealtimeEvents.OverstayAlertEvent event = RealtimeEvents.OverstayAlertEvent.of(
                visitId, gateId, visit.getVisitorName(), flatNumber, visit.getExpectedOutAt());
        // Every gate's guard hears it: the visitor may be heading for any exit.
        toAllGates(visit.getTownshipId(), event);

        List<UUID> hosts = visit.getTargetUnit() != null
                ? users.findByUnit_IdAndRoleAndActiveTrue(visit.getTargetUnit().getId(), UserRole.RESIDENT)
                        .stream().map(AppUser::getId).toList()
                : (visit.getApproverId() == null ? List.of() : List.of(visit.getApproverId()));
        hosts.forEach(userId -> realtime.toUser(userId, RealtimeService.QUEUE_VISITS, event));
        fcm.push(devices.tokensFor(hosts), PushPayload.of(
                PushPayload.TYPE_OVERSTAY_ALERT,
                visit.getVisitorName() + " has overstayed",
                "Their expected exit time has passed. Extend the stay or let the gate know.",
                Map.of("visitId", visitId.toString(), "gateId", gateId.toString())));
    }
}
