package com.gatecrash.realtime;

import com.gatecrash.visit.VisitStatus;
import com.gatecrash.visit.VisitorType;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * The WebSocket wire contract.
 *
 * <p>Every frame carries a {@code type} so a client can switch on it without inspecting shape, and
 * carries identifiers plus display text only. These go to a gate tablet and an admin dashboard;
 * visitor phone numbers, photo URLs and approver contact details stay out of them.
 */
public final class RealtimeEvents {

    public static final String VISIT_REQUESTED = "VISIT_REQUESTED";
    public static final String VISIT_DECIDED = "VISIT_DECIDED";
    public static final String VISIT_EXPIRED = "VISIT_EXPIRED";
    public static final String OCCUPANCY_CHANGED = "OCCUPANCY_CHANGED";
    public static final String OVERSTAY_ALERT = "OVERSTAY_ALERT";
    public static final String VISIT_EXTENDED = "VISIT_EXTENDED";
    public static final String SERVICE_UPDATE = "SERVICE_UPDATE";

    private RealtimeEvents() {
    }

    /** To the approver: someone is at the gate asking for them. */
    public record VisitRequestedEvent(
            String type,
            UUID visitId,
            UUID gateId,
            String gateName,
            String visitorName,
            VisitorType visitorType,
            String flatNumber,
            OffsetDateTime createdAt) {

        public static VisitRequestedEvent of(UUID visitId, UUID gateId, String gateName,
                                             String visitorName, VisitorType visitorType,
                                             String flatNumber, OffsetDateTime createdAt) {
            return new VisitRequestedEvent(VISIT_REQUESTED, visitId, gateId, gateName, visitorName,
                    visitorType, flatNumber, createdAt);
        }
    }

    /** To the gate topic: the decision that flips the guard's screen. */
    public record VisitDecidedEvent(
            String type,
            UUID visitId,
            UUID gateId,
            VisitStatus status,
            String visitorName,
            String decidedByName,
            OffsetDateTime decidedAt) {

        public static VisitDecidedEvent of(UUID visitId, UUID gateId, VisitStatus status,
                                           String visitorName, String decidedByName,
                                           OffsetDateTime decidedAt) {
            return new VisitDecidedEvent(VISIT_DECIDED, visitId, gateId, status, visitorName,
                    decidedByName, decidedAt);
        }
    }

    /** To the gate topic: nobody answered in time, so the guard's spinner does not hang forever. */
    public record VisitExpiredEvent(String type, UUID visitId, UUID gateId, String visitorName) {

        public static VisitExpiredEvent of(UUID visitId, UUID gateId, String visitorName) {
            return new VisitExpiredEvent(VISIT_EXPIRED, visitId, gateId, visitorName);
        }
    }

    /** To the admin dashboard: someone entered or left the township. */
    public record OccupancyChangedEvent(
            String type,
            UUID visitId,
            VisitStatus status,
            String visitorName,
            String gateName,
            long insideCount,
            OffsetDateTime at) {

        public static OccupancyChangedEvent of(UUID visitId, VisitStatus status, String visitorName,
                                               String gateName, long insideCount, OffsetDateTime at) {
            return new OccupancyChangedEvent(OCCUPANCY_CHANGED, visitId, status, visitorName, gateName,
                    insideCount, at);
        }
    }

    /**
     * To the gate and to the host: a checked-in visitor is past their expected exit. Carries the
     * flat so the guard knows whose guest it is, and nothing about the visitor beyond their name.
     */
    public record OverstayAlertEvent(
            String type,
            UUID visitId,
            UUID gateId,
            String visitorName,
            String flatNumber,
            OffsetDateTime expectedOutAt) {

        public static OverstayAlertEvent of(UUID visitId, UUID gateId, String visitorName,
                                            String flatNumber, OffsetDateTime expectedOutAt) {
            return new OverstayAlertEvent(OVERSTAY_ALERT, visitId, gateId, visitorName, flatNumber,
                    expectedOutAt);
        }
    }

    /** To the gate: the host extended a stay, so the overstay alarm for this visitor is cleared. */
    public record VisitExtendedEvent(
            String type,
            UUID visitId,
            UUID gateId,
            String visitorName,
            OffsetDateTime expectedOutAt,
            String extendedByName) {

        public static VisitExtendedEvent of(UUID visitId, UUID gateId, String visitorName,
                                            OffsetDateTime expectedOutAt, String extendedByName) {
            return new VisitExtendedEvent(VISIT_EXTENDED, visitId, gateId, visitorName, expectedOutAt,
                    extendedByName);
        }
    }

    /**
     * To one resident: something they raised changed -- a ticket reply, a move decision, a
     * cancelled booking. {@code kind} lets the client refetch the right list.
     */
    public record ServiceUpdateEvent(String type, String kind, UUID entityId, String title, String body) {

        public static ServiceUpdateEvent of(String kind, UUID entityId, String title, String body) {
            return new ServiceUpdateEvent(SERVICE_UPDATE, kind, entityId, title, body);
        }
    }
}
