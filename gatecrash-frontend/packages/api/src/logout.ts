import type { DeviceId } from '@gatecrash/core';
import type { QueryClient } from '@tanstack/react-query';
import type { ApiClient } from './client';
import { createEndpoints } from './endpoints';

/**
 * The logout sequence — FRONTEND.md §5.5.
 *
 * The ordering is a real defect if reversed, which is why it lives in one function rather than
 * being re-typed on each platform:
 *
 *   1. **De-register this device first**, while the bearer is still valid. Skip it and the next
 *      person to hold a shared gate tablet keeps receiving the previous user's visitor pushes.
 *   2. Revoke the refresh token server-side.
 *   3. Clear the local token store.
 *   4. Clear the query cache — it holds another user's visitor names and phone numbers.
 *   5. Disconnect the socket (the caller supplies this; it owns the `RealtimeClient`).
 *
 * Every remote step is best-effort; the local teardown is not. If the network is down the user
 * still gets signed out of *this* device — a logout that fails because the server was unreachable
 * is a logout that did not happen, which is worse than an orphaned device row the backend prunes
 * on its next send failure anyway.
 */
export interface LogoutOptions {
  client: ApiClient;
  queryClient?: QueryClient;
  /** This device's registration id, when one was registered (mobile, or opted-in web push). */
  deviceId?: DeviceId | null;
  /** Called after the local teardown, to tear down the STOMP connection. */
  onDisconnect?: () => void;
}

export async function logout({
  client,
  queryClient,
  deviceId,
  onDisconnect,
}: LogoutOptions): Promise<void> {
  const api = createEndpoints(client);

  if (deviceId) {
    try {
      await api.devices.deregister(deviceId);
    } catch {
      // The backend prunes UNREGISTERED tokens on send failure, so a leaked row self-heals.
    }
  }

  let refreshToken: string | null = null;
  try {
    refreshToken = await client.session.getRefreshToken();
  } catch {
    refreshToken = null;
  }

  try {
    // With no token the server revokes every session for the account, which is the safer
    // default when we could not read the stored one.
    await api.auth.logout(refreshToken);
  } catch {
    // Offline, or the token was already revoked. Local teardown proceeds regardless.
  }

  await client.session.clear();
  queryClient?.clear();
  onDisconnect?.();
}
