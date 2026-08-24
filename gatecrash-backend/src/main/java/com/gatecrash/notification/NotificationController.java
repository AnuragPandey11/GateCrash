package com.gatecrash.notification;

import com.gatecrash.common.PageResponse;
import com.gatecrash.notification.dto.NotificationDtos.AudiencePreviewResponse;
import com.gatecrash.notification.dto.NotificationDtos.AudienceRule;
import com.gatecrash.notification.dto.NotificationDtos.CreateNotificationRequest;
import com.gatecrash.notification.dto.NotificationDtos.InboxItemResponse;
import com.gatecrash.notification.dto.NotificationDtos.NotificationResponse;
import com.gatecrash.notification.dto.NotificationDtos.UnreadCountResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * Admin broadcast endpoints plus the recipient's own inbox. The inbox routes are open to every
 * authenticated role -- each caller only ever sees rows scoped to their own user id.
 */
@RestController
@RequestMapping("/api/v1/notifications")
@RequiredArgsConstructor
@Tag(name = "Notifications")
public class NotificationController {

    private final NotificationService notifications;

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Resolve the audience, record recipients and dispatch")
    public NotificationResponse send(@Valid @RequestBody CreateNotificationRequest request) {
        return notifications.send(request);
    }

    @PostMapping("/preview")
    @Operation(summary = "Dry run: how many people and devices this rule would reach")
    public AudiencePreviewResponse preview(@Valid @RequestBody AudienceRule rule) {
        return notifications.preview(rule);
    }

    @GetMapping
    @Operation(summary = "Sent history with recipient and delivery counts")
    public PageResponse<NotificationResponse> history(
            @PageableDefault(size = 25) Pageable pageable) {
        return notifications.history(pageable);
    }

    @GetMapping("/mine")
    @Operation(summary = "The caller's inbox")
    public PageResponse<InboxItemResponse> mine(@PageableDefault(size = 25) Pageable pageable) {
        return notifications.inbox(pageable);
    }

    @GetMapping("/mine/unread-count")
    @Operation(summary = "Unread badge count")
    public UnreadCountResponse unreadCount() {
        return new UnreadCountResponse(notifications.unreadCount());
    }

    @PatchMapping("/mine/{id}/read")
    @Operation(summary = "Mark one inbox item read")
    public InboxItemResponse markRead(@PathVariable UUID id) {
        return notifications.markRead(id);
    }
}
