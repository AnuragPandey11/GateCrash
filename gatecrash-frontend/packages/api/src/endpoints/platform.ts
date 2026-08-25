import type { TownshipId, UserId } from '@gatecrash/core';
import type { ApiClient } from '../client';
import type { PageArgs, PageResponse } from '../pagination';
import { toPageParams } from '../pagination';
import type {
  CreatedTownshipResponse,
  CreatedUserResponse,
  ResetPasswordResponse,
  SuperAdminResponse,
  TownshipResponse,
  UserResponse,
} from '../schemas';

/**
 * The platform surface — everything under `/api/v1/super`, reachable only by a `SUPER_ADMIN`.
 *
 * These endpoints act **on** townships. To act **inside** one, a super admin calls the ordinary
 * `admin/*` endpoints with the `X-Township-Id` header, which `ApiClient` attaches automatically
 * from `actingTownshipId` — so nothing in this module ever sets it by hand.
 *
 * Two payloads here carry a one-time secret and fall under guardrail #3 exactly as
 * `adminUserEndpoints` does: `createTownship` returns the first administrator's generated
 * password, and `createSuperAdmin` returns a peer operator's. Neither may be cached, stored,
 * logged, or put on a URL — they live in one component's state and die with it.
 */
export interface CreateTownshipBody {
  code: string;
  name: string;
  contactEmail?: string;
  contactPhone?: string;
  admin: TownshipAdminBody;
}

export interface TownshipAdminBody {
  loginId: string;
  fullName: string;
  phone?: string;
  email?: string;
}

export interface UpdateTownshipBody {
  name?: string;
  contactEmail?: string;
  contactPhone?: string;
}

export function platformEndpoints(client: ApiClient) {
  return {
    // ── townships ───────────────────────────────────────────────────────────────────────────

    /** Onboards a township and its first admin in one call; the admin's password comes back once. */
    createTownship(body: CreateTownshipBody): Promise<CreatedTownshipResponse> {
      return client.post<CreatedTownshipResponse>('super/townships', { json: body });
    },

    listTownships(
      page: PageArgs,
      includeArchived = false,
      signal?: AbortSignal,
    ): Promise<PageResponse<TownshipResponse>> {
      return client.get<PageResponse<TownshipResponse>>('super/townships', {
        searchParams: { ...toPageParams(page), includeArchived },
        ...(signal ? { signal } : {}),
      });
    },

    getTownship(id: TownshipId, signal?: AbortSignal): Promise<TownshipResponse> {
      return client.get<TownshipResponse>(`super/townships/${id}`, signal ? { signal } : {});
    },

    /** Name and contacts only — the code is part of every resident's credential and is immutable. */
    updateTownship(id: TownshipId, body: UpdateTownshipBody): Promise<TownshipResponse> {
      return client.patch<TownshipResponse>(`super/townships/${id}`, { json: body });
    },

    suspendTownship(id: TownshipId): Promise<TownshipResponse> {
      return client.post<TownshipResponse>(`super/townships/${id}/suspend`);
    },

    /**
     * Archive — the "delete" of a township, and a soft one: nothing is destroyed and `restore`
     * reverses it. `confirmCode` must equal the township's own code, so the UI has to make the
     * operator type it. An unconfirmed DELETE on a mis-pasted id would take an entire community
     * offline in one request.
     */
    archiveTownship(id: TownshipId, confirmCode: string): Promise<TownshipResponse> {
      return client.delete<TownshipResponse>(`super/townships/${id}`, { json: { confirmCode } });
    },

    restoreTownship(id: TownshipId): Promise<TownshipResponse> {
      return client.post<TownshipResponse>(`super/townships/${id}/restore`);
    },

    // ── township administrators ─────────────────────────────────────────────────────────────

    listTownshipAdmins(id: TownshipId, signal?: AbortSignal): Promise<UserResponse[]> {
      return client.get<UserResponse[]>(`super/townships/${id}/admins`, signal ? { signal } : {});
    },

    addTownshipAdmin(id: TownshipId, body: TownshipAdminBody): Promise<CreatedUserResponse> {
      return client.post<CreatedUserResponse>(`super/townships/${id}/admins`, { json: body });
    },

    /** Deactivates, never deletes. Refused (409 `LAST_TOWNSHIP_ADMIN`) for the last active one. */
    removeTownshipAdmin(id: TownshipId, userId: UserId): Promise<UserResponse> {
      return client.delete<UserResponse>(`super/townships/${id}/admins/${userId}`);
    },

    resetTownshipAdminPassword(id: TownshipId, userId: UserId): Promise<ResetPasswordResponse> {
      return client.post<ResetPasswordResponse>(
        `super/townships/${id}/admins/${userId}/reset-password`,
      );
    },

    // ── platform operators ──────────────────────────────────────────────────────────────────

    listSuperAdmins(signal?: AbortSignal): Promise<SuperAdminResponse[]> {
      return client.get<SuperAdminResponse[]>('super/admins', signal ? { signal } : {});
    },

    createSuperAdmin(body: TownshipAdminBody): Promise<CreatedUserResponse> {
      return client.post<CreatedUserResponse>('super/admins', { json: body });
    },

    /** Refused for your own account, and for the last active operator on the platform. */
    deactivateSuperAdmin(userId: UserId): Promise<SuperAdminResponse> {
      return client.delete<SuperAdminResponse>(`super/admins/${userId}`);
    },

    activateSuperAdmin(userId: UserId): Promise<SuperAdminResponse> {
      return client.post<SuperAdminResponse>(`super/admins/${userId}/activate`);
    },

    resetSuperAdminPassword(userId: UserId): Promise<ResetPasswordResponse> {
      return client.post<ResetPasswordResponse>(`super/admins/${userId}/reset-password`);
    },
  };
}
