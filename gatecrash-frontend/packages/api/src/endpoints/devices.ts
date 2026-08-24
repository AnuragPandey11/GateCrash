import type { DeviceId, DevicePlatform } from '@gatecrash/core';
import type { ApiClient } from '../client';
import type { DeviceResponse } from '../schemas';

/**
 * FCM device registration — FRONTEND.md §7.4.
 *
 * Two rules that are easy to get subtly wrong:
 *
 *  - **Never log or display the token.** It is a delivery credential. It is not echoed back by
 *    `DeviceResponse` for exactly that reason.
 *  - **De-register before logout**, not after: `GET /devices` → `DELETE /devices/{id}` → *then*
 *    clear the token store. Reversed, the next person to hold a shared gate tablet keeps getting
 *    the previous user's visitor pushes. That ordering lives in `logoutSequence` below so it
 *    cannot be reimplemented differently on two platforms.
 */
export function deviceEndpoints(client: ApiClient) {
  return {
    register(fcmToken: string, platform: DevicePlatform): Promise<DeviceResponse> {
      // Idempotent on the token (unique column), so re-registering after `onTokenRefresh` is
      // safe and also refreshes `last_seen_at`.
      return client.post<DeviceResponse>('devices', { json: { fcmToken, platform } });
    },

    listMine(signal?: AbortSignal): Promise<DeviceResponse[]> {
      return client.get<DeviceResponse[]>('devices', signal ? { signal } : {});
    },

    deregister(id: DeviceId): Promise<void> {
      return client.delete(`devices/${id}`);
    },
  };
}
