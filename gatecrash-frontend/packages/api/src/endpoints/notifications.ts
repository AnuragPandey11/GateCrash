import type { AudienceRule } from '@gatecrash/core';
import { buildAudienceRule } from '@gatecrash/core';
import type { InboxItemId } from '@gatecrash/core';
import type { ApiClient } from '../client';
import type { PageArgs, PageResponse } from '../pagination';
import { toPageParams } from '../pagination';
import type {
  AudiencePreviewResponse,
  CreateNotificationRequest,
  InboxItemResponse,
  NotificationResponse,
  UnreadCountResponse,
} from '../schemas';

/**
 * Notifications — FRONTEND.md §8.5.
 *
 * `preview` runs the *same* `AudienceResolver` as `send`, read-only. That is what lets an admin
 * see the blast radius before thousands of phones buzz, and it is why the composer keeps Send
 * disabled until a preview has resolved for the rule currently in the form.
 *
 * Both calls normalise the rule through `buildAudienceRule` so a list left over from a mode the
 * admin has since switched away from can never reach the resolver.
 */
export function notificationEndpoints(client: ApiClient) {
  return {
    send(body: CreateNotificationRequest): Promise<NotificationResponse> {
      return client.post<NotificationResponse>('notifications', {
        json: {
          title: body.title,
          body: body.body,
          audienceRule: buildAudienceRule(body.audienceRule as AudienceRule),
        },
      });
    },

    preview(rule: AudienceRule, signal?: AbortSignal): Promise<AudiencePreviewResponse> {
      return client.post<AudiencePreviewResponse>('notifications/preview', {
        json: buildAudienceRule(rule),
        ...(signal ? { signal } : {}),
      });
    },

    history(page: PageArgs, signal?: AbortSignal): Promise<PageResponse<NotificationResponse>> {
      return client.get<PageResponse<NotificationResponse>>('notifications', {
        searchParams: toPageParams(page),
        ...(signal ? { signal } : {}),
      });
    },

    /** The caller's own inbox — every role has one. A reconciliation path after a dropped push. */
    inbox(page: PageArgs, signal?: AbortSignal): Promise<PageResponse<InboxItemResponse>> {
      return client.get<PageResponse<InboxItemResponse>>('notifications/mine', {
        searchParams: toPageParams(page),
        ...(signal ? { signal } : {}),
      });
    },

    unreadCount(signal?: AbortSignal): Promise<UnreadCountResponse> {
      return client.get<UnreadCountResponse>('notifications/mine/unread-count', signal ? { signal } : {});
    },

    markRead(id: InboxItemId): Promise<InboxItemResponse> {
      return client.patch<InboxItemResponse>(`notifications/mine/${id}/read`);
    },
  };
}
