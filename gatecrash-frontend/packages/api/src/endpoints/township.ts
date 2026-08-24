import type { BlockId, FlatId, GateId } from '@gatecrash/core';
import type { ApiClient } from '../client';
import type { BlockResponse, FlatResponse, GateResponse } from '../schemas';
import { type z } from 'zod';
import {
  type createBlockRequestSchema,
  type createFlatRequestSchema,
  type createGateRequestSchema,
} from '../schemas/requests';

/**
 * Blocks, flats and gates — FRONTEND.md §8.8.
 *
 * The three *list* methods are authorised for `ADMIN, GUARD` on the backend, despite the
 * `/admin` path prefix (§4.8). The guard app reads gates and flats through exactly these calls;
 * a route guard that blocks them because the URL says "admin" would break the walk-in wizard.
 *
 * Create and delete only — the backend has no update endpoints for any of the three.
 */
export function townshipEndpoints(client: ApiClient) {
  return {
    listBlocks(signal?: AbortSignal): Promise<BlockResponse[]> {
      return client.get<BlockResponse[]>('admin/blocks', signal ? { signal } : {});
    },
    createBlock(body: z.infer<typeof createBlockRequestSchema>): Promise<BlockResponse> {
      return client.post<BlockResponse>('admin/blocks', { json: body });
    },
    deleteBlock(id: BlockId): Promise<void> {
      return client.delete(`admin/blocks/${id}`);
    },

    /** `blockId` filters server-side; omit it for every flat in the township. */
    listFlats(blockId?: BlockId | null, signal?: AbortSignal): Promise<FlatResponse[]> {
      return client.get<FlatResponse[]>('admin/flats', {
        searchParams: { blockId: blockId ?? undefined },
        ...(signal ? { signal } : {}),
      });
    },
    createFlat(body: z.infer<typeof createFlatRequestSchema>): Promise<FlatResponse> {
      return client.post<FlatResponse>('admin/flats', { json: body });
    },
    deleteFlat(id: FlatId): Promise<void> {
      return client.delete(`admin/flats/${id}`);
    },

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
