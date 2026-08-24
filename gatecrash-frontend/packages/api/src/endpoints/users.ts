import type { UserId } from '@gatecrash/core';
import type { ApiClient } from '../client';
import type { UserFilters } from '../filters';
import { userFilterParams } from '../filters';
import type { PageArgs, PageResponse } from '../pagination';
import { toPageParams } from '../pagination';
import type {
  CreateUserRequest,
  CreatedUserResponse,
  ResetPasswordResponse,
  UpdateUserRequest,
  UserResponse,
} from '../schemas';

/**
 * Account provisioning — FRONTEND.md §8.7.
 *
 * `create` and `resetPassword` return a `generatedPassword` **exactly once**. Guardrail #3: that
 * value must never be written to a store, a log, an analytics event or a URL. It exists in one
 * component's local state and dies with it — which is why these return it plainly and the query
 * layer deliberately does *not* cache the result (see `queries/users.ts`).
 */
export function adminUserEndpoints(client: ApiClient) {
  return {
    create(body: CreateUserRequest): Promise<CreatedUserResponse> {
      return client.post<CreatedUserResponse>('admin/users', { json: body });
    },

    resetPassword(id: UserId): Promise<ResetPasswordResponse> {
      return client.post<ResetPasswordResponse>(`admin/users/${id}/reset-password`);
    },

    list(
      filters: UserFilters,
      page: PageArgs,
      signal?: AbortSignal,
    ): Promise<PageResponse<UserResponse>> {
      return client.get<PageResponse<UserResponse>>('admin/users', {
        searchParams: { ...userFilterParams(filters), ...toPageParams(page) },
        ...(signal ? { signal } : {}),
      });
    },

    get(id: UserId, signal?: AbortSignal): Promise<UserResponse> {
      return client.get<UserResponse>(`admin/users/${id}`, signal ? { signal } : {});
    },

    /**
     * Edits `fullName`, `phone`, `email` **only**. The body is built explicitly from those three
     * fields — never a spread of a `UserResponse`, which would carry `role`, `active` and
     * `createdAt` into a request Jackson rejects outright with `MALFORMED_BODY` (§4.3.1).
     */
    update(id: UserId, body: UpdateUserRequest): Promise<UserResponse> {
      return client.patch<UserResponse>(`admin/users/${id}`, {
        json: { fullName: body.fullName, phone: body.phone, email: body.email },
      });
    },

    /**
     * Soft delete — history is preserved. Note this returns the updated `UserResponse` rather
     * than a 204, and it invalidates the account's tokens server-side, so they are signed out
     * immediately (which is what the confirm dialog's copy has to say).
     */
    deactivate(id: UserId): Promise<UserResponse> {
      return client.delete<UserResponse>(`admin/users/${id}`);
    },

    activate(id: UserId): Promise<UserResponse> {
      return client.post<UserResponse>(`admin/users/${id}/activate`);
    },
  };
}
