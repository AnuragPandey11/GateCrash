import type { ApiClient } from '../client';
import type { SalesAgentResponse, UserResponse } from '../schemas';

/**
 * Sales duty — FRONTEND.md §9.5.
 *
 * `onDuty` is what decides whether the agent appears in the guard's routing dropdown, so the
 * toggle is not cosmetic: switching off while client visits are pending strands them.
 */
export function salesEndpoints(client: ApiClient) {
  return {
    setDuty(onDuty: boolean): Promise<UserResponse> {
      return client.patch<UserResponse>('sales/me/duty', { json: { onDuty } });
    },

    /** `GUARD` — the routing dropdown. Trimmed projection; no contact details reach the gate. */
    onDuty(signal?: AbortSignal): Promise<SalesAgentResponse[]> {
      return client.get<SalesAgentResponse[]>('sales/on-duty', signal ? { signal } : {});
    },
  };
}
