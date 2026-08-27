import type { GateId } from '@gatecrash/core';
import type { ApiClient } from '../client';
import type { GateResponse } from '../schemas';
import { type z } from 'zod';
import { type createGateRequestSchema } from '../schemas/requests';

/**
 * Gates — FRONTEND.md §8.8.
 *
 * `listGates` is authorised for `ADMIN, GUARD` on the backend despite the `/admin` path prefix
 * (§4.8): the guard app reads gates through exactly this call, and a route guard that blocks it
 * because the URL says "admin" would break the walk-in wizard.
 *
 * Blocks and flats used to live here. They became the property tree in V4 — see
 * `endpoints/property.ts` — because a fixed block-then-flat pair could only describe one shape of
 * project. Gates stayed: a gate is a gate whether the project sells villas or offices.
 *
 * Create and delete only — the backend has no update endpoint for a gate.
 */
export function townshipEndpoints(client: ApiClient) {
  return {
    listGates(signal?: AbortSignal): Promise<GateResponse[]> {
      return client.get<GateResponse[]>('admin/gates', signal ? { signal } : {});
    },
    createGate(body: z.infer<typeof createGateRequestSchema>): Promise<GateResponse> {
      return client.post<GateResponse>('admin/gates', { json: body });
    },
    deleteGate(id: GateId): Promise<void> {
      return client.delete(`admin/gates/${id}`);
    },
  };
}
