package com.gatecrash.notification;

import com.gatecrash.common.AfterCommitExecutor;
import com.gatecrash.common.PageResponse;
import com.gatecrash.common.audit.AuditAction;
import com.gatecrash.common.audit.AuditService;
import com.gatecrash.common.exception.BusinessValidationException;
import com.gatecrash.common.exception.NotFoundException;
import com.gatecrash.device.DeviceService;
import com.gatecrash.notification.dto.NotificationDtos.AudiencePreviewResponse;
import com.gatecrash.notification.dto.NotificationDtos.AudienceRule;
import com.gatecrash.notification.dto.NotificationDtos.AudienceUserResponse;
import com.gatecrash.notification.dto.NotificationDtos.CreateNotificationRequest;
import com.gatecrash.notification.dto.NotificationDtos.InboxItemResponse;
import com.gatecrash.notification.dto.NotificationDtos.NotificationResponse;
import com.gatecrash.common.tenant.TenantContext;
import com.gatecrash.security.SecurityUtils;
import com.gatecrash.user.AppUserRepository;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Targeted notifications: resolve an audience, materialise the recipients, then fan out.
 *
 * <p>The two halves are separated deliberately. Persisting the notification and its recipient rows is
 * transactional and is what the system considers "sent" -- the inbox works from those rows, so a
 * push that never arrives still leaves the message readable in the app. The FCM fan-out then runs
 * after commit, in batches, and updates delivery flags on a best-effort basis.
 *
 * <p>Recipient rows are inserted in chunks. A township-wide broadcast is thousands of rows, and one
 * statement per row would hold a write transaction open far longer than the admin's request should.
 *
 * <p>The audience is resolved within the sending township and nowhere else -- see
 * {@link AudienceResolver}. The inbox side needs no tenant predicate: a recipient row is keyed on a
 * user id, and a user belongs to exactly one township, so reading your own inbox cannot reach
 * another's.
 */
@Service
@RequiredArgsConstructor
public class NotificationService {

    private static final Logger log = LoggerFactory.getLogger(NotificationService.class);

    /** Batch size for both recipient inserts and token lookups. */
    private static final int CHUNK_SIZE = 500;

    private final NotificationRepository notifications;
    private final NotificationRecipientRepository recipients;
    private final AudienceResolver audienceResolver;
    private final NotificationDispatcher dispatcher;
    private final DeviceService devices;
    private final AuditService audit;
    private final AfterCommitExecutor afterCommit;
    private final AppUserRepository users;

    @PreAuthorize("hasRole('ADMIN')")
    @Transactional
    public NotificationResponse send(CreateNotificationRequest request) {
        List<UUID> userIds = audienceResolver.resolve(request.audienceRule());
        if (userIds.isEmpty()) {
            throw new BusinessValidationException("EMPTY_AUDIENCE",
                    "That audience rule matches no active users.");
        }

        Notification notification = new Notification();
        notification.setTownshipId(TenantContext.requireTownshipId());
        notification.setAuthorId(SecurityUtils.currentUserId());
        notification.setTitle(request.title().trim());
        notification.setBody(request.body().trim());
        notification.setAudienceRule(request.audienceRule());
        notification.setStatus(NotifStatus.QUEUED);
        notification.setRecipientCount(userIds.size());
        notifications.save(notification);

        materialiseRecipients(notification.getId(), userIds);

        notification.setStatus(NotifStatus.SENT);
        notification.setSentAt(OffsetDateTime.now());
        notifications.save(notification);

        audit.record(AuditAction.NOTIFICATION_SENT, "notification", notification.getId(),
                AuditService.detail("mode", request.audienceRule().mode(),
                        "recipientCount", userIds.size()));
        log.info("Notification {} queued for {} recipient(s)", notification.getId(), userIds.size());

        UUID notificationId = notification.getId();
        String title = notification.getTitle();
        String body = notification.getBody();
        afterCommit.execute(() -> dispatcher.dispatch(notificationId, title, body, userIds));

        return toResponse(notification, 0);
    }

    /** Dry run. Same resolver, no writes -- the admin sees the blast radius before committing to it. */
    @PreAuthorize("hasRole('ADMIN')")
    @Transactional(readOnly = true)
    public AudiencePreviewResponse preview(AudienceRule rule) {
        List<UUID> userIds = audienceResolver.resolve(rule);
        int deviceCount = 0;
        for (int start = 0; start < userIds.size(); start += CHUNK_SIZE) {
            deviceCount += devices.tokensFor(
                    userIds.subList(start, Math.min(start + CHUNK_SIZE, userIds.size()))).size();
        }
        return new AudiencePreviewResponse(userIds.size(), deviceCount);
    }

    @PreAuthorize("hasRole('ADMIN')")
    @Transactional(readOnly = true)
    public PageResponse<NotificationResponse> history(Pageable pageable) {
        return PageResponse.of(
                notifications.findByTownshipIdOrderByCreatedAtDesc(
                        TenantContext.requireTownshipId(), pageable),
                notification -> toResponse(notification,
                        (int) recipients.countByNotificationIdAndDeliveredTrue(notification.getId())));
    }

    // ----- recipient inbox --------------------------------------------------------------------

    @Transactional(readOnly = true)
    public PageResponse<InboxItemResponse> inbox(Pageable pageable) {
        UUID userId = SecurityUtils.currentUserId();
        Page<NotificationRecipient> page = recipients.inboxOf(userId, pageable);

        // One lookup for the whole page rather than one per row.
        Map<UUID, Notification> byId = notifications
                .findAllById(page.getContent().stream().map(NotificationRecipient::getNotificationId).toList())
                .stream()
                .collect(Collectors.toMap(Notification::getId, Function.identity()));

        return PageResponse.of(page, row -> toInboxItem(row, byId.get(row.getNotificationId())));
    }

    /** Everything in the caller's inbox, read at once. Returns how many rows changed. */
    @Transactional
    public int markAllRead() {
        return recipients.markAllRead(SecurityUtils.currentUserId(), OffsetDateTime.now());
    }

    /**
     * The people list the composer shows under "Everyone": every active account of the township,
     * which the admin can then narrow by unticking. Anchored on the acting township like every
     * other read.
     */
    @PreAuthorize("hasRole('ADMIN')")
    @Transactional(readOnly = true)
    public List<AudienceUserResponse> audienceUsers() {
        return users.findActiveForAudience(TenantContext.requireTownshipId()).stream()
                .map(u -> new AudienceUserResponse(u.getId(), u.getFullName(), u.getLoginId(), u.getRole(),
                        u.isSales(), u.getUnit() == null ? null : u.getUnit().getCode()))
                .toList();
    }

    @Transactional(readOnly = true)
    public long unreadCount() {
        return recipients.countByUserIdAndReadAtIsNull(SecurityUtils.currentUserId());
    }

    /**
     * Marks one inbox row read. Scoped by user id in the query itself, so a caller cannot mark
     * someone else's row read by guessing its id -- and gets a 404, not a 403, for the attempt.
     */
    @Transactional
    public InboxItemResponse markRead(UUID recipientId) {
        UUID userId = SecurityUtils.currentUserId();
        NotificationRecipient row = recipients.findByIdAndUserId(recipientId, userId)
                .orElseThrow(() -> NotFoundException.of("Notification", recipientId));

        if (row.getReadAt() == null) {
            row.setReadAt(OffsetDateTime.now());
            recipients.save(row);
        }
        return toInboxItem(row, notifications.findById(row.getNotificationId()).orElse(null));
    }

    // ----- internals --------------------------------------------------------------------------

    private void materialiseRecipients(UUID notificationId, List<UUID> userIds) {
        for (int start = 0; start < userIds.size(); start += CHUNK_SIZE) {
            List<UUID> chunk = userIds.subList(start, Math.min(start + CHUNK_SIZE, userIds.size()));
            List<NotificationRecipient> rows = new ArrayList<>(chunk.size());
            for (UUID userId : chunk) {
                NotificationRecipient row = new NotificationRecipient();
                row.setNotificationId(notificationId);
                row.setUserId(userId);
                rows.add(row);
            }
            recipients.saveAll(rows);
        }
    }

    private NotificationResponse toResponse(Notification notification, int deliveredCount) {
        return new NotificationResponse(
                notification.getId(),
                notification.getTitle(),
                notification.getBody(),
                notification.getAudienceRule(),
                notification.getStatus(),
                notification.getRecipientCount(),
                deliveredCount,
                notification.getSentAt(),
                notification.getCreatedAt());
    }

    private InboxItemResponse toInboxItem(NotificationRecipient row, Notification notification) {
        return new InboxItemResponse(
                row.getId(),
                row.getNotificationId(),
                notification == null ? null : notification.getTitle(),
                notification == null ? null : notification.getBody(),
                row.getReadAt() != null,
                row.getReadAt(),
                notification == null ? null : notification.getSentAt());
    }
}
