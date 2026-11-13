import type { GateId, PassId } from '@gatecrash/core';
import type { ApiClient } from '../client';
import type { PageArgs, PageResponse } from '../pagination';
import { toPageParams } from '../pagination';
import {
  parseResponse,
  redeemPassResponseSchema,
  type CreatePassRequest,
  type CreatePassResponse,
  type PassPreviewResponse,
  type PassResponse,
  type RedeemPassResponse,
} from '../schemas';

/** The guard's corrections to a scanned pass before letting the visitor in. */
export interface RedeemCorrections {
  visitorName?: string;
  visitorPhone?: string;
  vehicleNo?: string;
  purpose?: string;
  expectedDurationMinutes?: number;
}

/**
 * Pre-approval passes — FRONTEND.md §9.4 (resident) and §9.3 (guard redeem).
 *
 * `create` returns the PIN **once**; it is never retrievable again (the server stores only a
 * peppered HMAC). Guardrail #3 applies: it goes into one component's state and nowhere else.
 *
 * Redemption is the fast path — the returned visit is already `CHECKED_IN`, with no approval
 * wait at all — which is why its response is one of the four Zod-parsed payloads (§4.2): a
 * silently wrong shape here would let someone through a gate on a mis-render.
 */
export function passEndpoints(client: ApiClient) {
  return {
    create(body: CreatePassRequest): Promise<CreatePassResponse> {
      return client.post<CreatePassResponse>('passes', { json: body });
    },

    /**
     * `GET /passes/mine` has **no status filter** (§15.6), so an "Active passes" tab has to
     * filter within the page — which is wrong across page boundaries. Noted as a backend gap
     * rather than papered over here.
     */
    mine(page: PageArgs, signal?: AbortSignal): Promise<PageResponse<PassResponse>> {
      return client.get<PageResponse<PassResponse>>('passes/mine', {
        searchParams: toPageParams(page),
        ...(signal ? { signal } : {}),
      });
    },

    /**
     * Exactly one of `pin` or `qrToken`; the service rejects both-or-neither. Modelled as one
     * endpoint so the guard's scanner and keypad share a single throttle bucket (10/min).
     */
    /** GUARD — what a scan or a typed PIN resolves to, without using the pass up. */
    lookup(input: { pin?: string; qrToken?: string; gateId: GateId }): Promise<PassPreviewResponse> {
      return client.post<PassPreviewResponse>('passes/lookup', {
        json: input.pin
          ? { pin: input.pin, gateId: input.gateId }
          : { qrToken: input.qrToken, gateId: input.gateId },
      });
    },

    async redeem(
      input: { pin?: string; qrToken?: string; gateId: GateId },
      corrections: RedeemCorrections = {},
    ): Promise<RedeemPassResponse> {
      const credential = input.pin
        ? { pin: input.pin, gateId: input.gateId }
        : { qrToken: input.qrToken, gateId: input.gateId };
      const extra = Object.fromEntries(
        Object.entries(corrections).filter(([, v]) => v !== undefined && v !== ''),
      );
      const raw = await client.post<unknown>('passes/redeem', { json: { ...credential, ...extra } });
      return parseResponse(redeemPassResponseSchema, raw, 'pass redemption') as RedeemPassResponse;
    },

    revoke(id: PassId): Promise<void> {
      return client.delete(`passes/${id}`);
    },
  };
}
