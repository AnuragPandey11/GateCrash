import type { Decision, GateId, VisitId } from '@gatecrash/core';
import type { ApiClient } from '../client';
import type { PageArgs, PageResponse } from '../pagination';
import { toPageParams } from '../pagination';
import {
  parseResponse,
  visitResponseSchema,
  type CreateVisitRequest,
  type OccupancyResponse,
  type VisitResponse,
} from '../schemas';
import type { VisitFilters } from '../filters';
import { visitFilterParams } from '../filters';

/** Visits — FRONTEND.md §4.8 and §9.3/§9.4. */
export function visitEndpoints(client: ApiClient) {
  const parseVisit = (raw: unknown) => parseResponse(visitResponseSchema, raw, 'visit') as VisitResponse;

  return {
    /** `GUARD` — logs a walk-in; the server routes it to the flat's residents or a sales agent. */
    async create(body: CreateVisitRequest): Promise<VisitResponse> {
      return parseVisit(await client.post<unknown>('visits', { json: body }));
    },

    /**
     * `RESIDENT`/`SALES`. A `409` here is a *normal* outcome, not a crash: any resident of the
     * flat may decide, so racing a flat-mate is expected (§11.2).
     */
    async decide(id: VisitId, decision: Decision, expectedDurationMinutes?: number): Promise<VisitResponse> {
      return parseVisit(
        await client.patch<unknown>(`visits/${id}/decision`, {
          json: expectedDurationMinutes ? { decision, expectedDurationMinutes } : { decision },
        }),
      );
    },

    /** RESIDENT/SALES — the household's (or agent's) visit history, newest first. */
    async mine(page: PageArgs, signal?: AbortSignal): Promise<PageResponse<VisitResponse>> {
      const raw = await client.get<PageResponse<unknown>>('visits/mine', {
        searchParams: toPageParams(page),
        ...(signal ? { signal } : {}),
      });
      return { ...raw, content: raw.content.map(parseVisit) };
    },

    /** The host extends a stay; clears an overstay alert and tells the gate. */
    async extendStay(id: VisitId, extendMinutes: number): Promise<VisitResponse> {
      return parseVisit(await client.patch<unknown>(`visits/${id}/stay`, { json: { extendMinutes } }));
    },

    /** RESIDENT — a fresh Leave-at-Gate collection code; the previous one stops working. */
    collectionCode(id: VisitId): Promise<{ visitId: VisitId; code: string }> {
      return client.post<{ visitId: VisitId; code: string }>(`visits/${id}/collection-code`);
    },

    /** GUARD — hand a parcel over against the resident's code. */
    async collect(id: VisitId, code: string): Promise<VisitResponse> {
      return parseVisit(await client.post<unknown>(`visits/${id}/collect`, { json: { code } }));
    },

    async checkIn(id: VisitId): Promise<VisitResponse> {
      return parseVisit(await client.patch<unknown>(`visits/${id}/check-in`));
    },

    /** `gateId`: the gate the guard is at, which may not be the one the visitor came in by. */
    async checkOut(id: VisitId, gateId?: GateId | null): Promise<VisitResponse> {
      return parseVisit(
        await client.patch<unknown>(`visits/${id}/check-out`, gateId ? { json: { gateId } } : {}),
      );
    },

    /** Unpaged by design — the caller's open approvals. A reconciliation path (§6.5). */
    async pending(signal?: AbortSignal): Promise<VisitResponse[]> {
      const raw = await client.get<unknown[]>('visits/pending', signal ? { signal } : {});
      return raw.map(parseVisit);
    },

    /** Recent activity at a gate. Server clamps `limit` to `app.visit.gate-feed-max-size`. */
    async byGate(gateId: GateId, limit = 50, signal?: AbortSignal): Promise<VisitResponse[]> {
      const raw = await client.get<unknown[]>(`visits/gate/${gateId}`, {
        searchParams: { limit },
        ...(signal ? { signal } : {}),
      });
      return raw.map(parseVisit);
    },

    /** One visit — the reconciliation path when the socket drops (§6.5). */
    async one(id: VisitId, signal?: AbortSignal): Promise<VisitResponse> {
      return parseVisit(await client.get<unknown>(`visits/${id}`, signal ? { signal } : {}));
    },
  };
}

/** Admin-only visit reads — `/admin/inside` and the filterable log. */
export function adminVisitEndpoints(client: ApiClient) {
  return {
    async inside(signal?: AbortSignal): Promise<OccupancyResponse> {
      const raw = await client.get<{ insideCount: number; visits: unknown[] }>(
        'admin/inside',
        signal ? { signal } : {},
      );
      return {
        insideCount: raw.insideCount,
        visits: raw.visits.map((v) => parseResponse(visitResponseSchema, v, 'visit') as VisitResponse),
      };
    },

    async search(
      filters: VisitFilters,
      page: PageArgs,
      signal?: AbortSignal,
    ): Promise<PageResponse<VisitResponse>> {
      const raw = await client.get<PageResponse<unknown>>('admin/visits', {
        searchParams: { ...visitFilterParams(filters), ...toPageParams(page) },
        ...(signal ? { signal } : {}),
      });
      return {
        ...raw,
        content: raw.content.map((v) => parseResponse(visitResponseSchema, v, 'visit') as VisitResponse),
      };
    },
  };
}
