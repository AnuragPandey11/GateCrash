package com.gatecrash.notification.dto;

import com.gatecrash.notification.NotifStatus;
import com.gatecrash.user.UserRole;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

public final class NotificationDtos {

    private NotificationDtos() {
    }

    /**
     * The admin's targeting filter.
     *
     * <p>The lists are bounded: an unbounded {@code flatIds} would let one request build an IN clause
     * with tens of thousands of parameters. Which list is required depends on {@code mode}, and that
     * is checked in {@code AudienceResolver} rather than with annotations, because bean validation
     * cannot express "required only when mode is FLATS".
     */
    public record AudienceRule(
            @NotNull Mode mode,
            @Size(max = 4) List<UserRole> roles,
            @Size(max = 2000) List<UUID> flatIds,
            @Size(max = 200) List<UUID> blockIds,
            @Size(max = 2000) List<UUID> nodeIds) {

        public enum Mode {
            /** Every active account. */
            ALL,
            /** Every active account except the listed roles. */
            ALL_EXCEPT,
            /** Only the listed roles. */
            ROLES,
            /** Residents of the listed flats. Kept for existing clients; NODES supersedes it. */
            FLATS,
            /** Residents of every flat in the listed blocks. Kept for existing clients; NODES supersedes it. */
            BLOCKS,
            /**
             * Residents anywhere beneath the listed property nodes, at any level, in one rule:
             * a whole tower, one floor of another, and three individual flats of a third. This is
             * what the drill-down picker (building, then floor, then unit) sends.
             */
            NODES,
            /** Every active member of the sales team -- accounts with the sales flag, whatever their role. */
            SALES_TEAM
        }
    }

    public record CreateNotificationRequest(
            @NotBlank @Size(max = 200) String title,
            @NotBlank @Size(max = 2000) String body,
            @NotNull @Valid AudienceRule audienceRule) {
    }

    public record NotificationResponse(
            UUID id,
            String title,
            String body,
            AudienceRule audienceRule,
            NotifStatus status,
            int recipientCount,
            int deliveredCount,
            OffsetDateTime sentAt,
            OffsetDateTime createdAt) {
    }

    /** Dry run: the blast radius, before anyone's phone buzzes. */
    public record AudiencePreviewResponse(int recipientCount, int deviceCount) {
    }

    /** One row in a recipient's inbox. */
    public record InboxItemResponse(
            UUID id,
            UUID notificationId,
            String title,
            String body,
            boolean read,
            OffsetDateTime readAt,
            OffsetDateTime sentAt) {
    }

    public record UnreadCountResponse(long unread) {
    }
}
