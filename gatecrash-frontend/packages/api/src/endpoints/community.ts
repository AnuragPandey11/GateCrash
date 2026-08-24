import type { PostId } from '@gatecrash/core';
import type { ApiClient } from '../client';
import type { PageArgs, PageResponse } from '../pagination';
import { toPageParams } from '../pagination';
import type { CreatePostRequest, PostResponse } from '../schemas';

/**
 * Community feed — FRONTEND.md §8.6.
 *
 * `CommunityService` authorises `ADMIN, RESIDENT, SALES`; guards have no reading surface at the
 * gate. Writes are `ADMIN` only.
 *
 * `imageUrl` is a pasted https URL, not an upload: there is no upload endpoint (§15.1), and
 * building an uploader against an endpoint that does not exist is how you ship a broken button.
 */
export function communityEndpoints(client: ApiClient) {
  return {
    feed(page: PageArgs, signal?: AbortSignal): Promise<PageResponse<PostResponse>> {
      return client.get<PageResponse<PostResponse>>('community/posts', {
        searchParams: toPageParams(page),
        ...(signal ? { signal } : {}),
      });
    },

    create(body: CreatePostRequest): Promise<PostResponse> {
      return client.post<PostResponse>('community/posts', {
        json: {
          title: body.title,
          body: body.body,
          imageUrl: body.imageUrl,
          pinned: body.pinned,
        },
      });
    },

    /** Permanent — it disappears from every resident's feed. The UI confirms by title first. */
    remove(id: PostId): Promise<void> {
      return client.delete(`community/posts/${id}`);
    },
  };
}
