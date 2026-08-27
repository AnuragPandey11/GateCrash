import type { PropertyLevelId, PropertyNodeId } from '@gatecrash/core';
import type { ApiClient } from '../client';
import type {
  BulkCreateResponse,
  OccupancySummaryResponse,
  PropertyNodeResponse,
  PropertyProfileResponse,
  PropertyTypeOption,
} from '../schemas';
import type {
  BulkCreateRequest,
  CreateNodeRequest,
  DefineLevelsRequest,
  RenameLevelRequest,
  SetOccupancyRequest,
  UpdateNodeRequest,
} from '../schemas/requests';

/**
 * The property tree — the per-developer replacement for the fixed `/admin/blocks` + `/admin/flats`
 * pair, which could only describe a project built as blocks of flats.
 *
 * `profile()` is the call that makes the console adapt: it returns the township's ordered levels
 * with the developer's own words for them, and the structure screen renders one tab per level from
 * that rather than from hardcoded strings. Read it before rendering anything structural.
 *
 * `profile()` and `listNodes()` are authorised for `ADMIN, GUARD` on the backend despite the
 * `/admin` path prefix — the guard app needs the unit list to route a walk-in. Everything that
 * writes, and the occupancy summary, is admin-only.
 */
export function propertyEndpoints(client: ApiClient) {
  return {
    /** The township's project type and its ordered, labelled levels. */
    profile(signal?: AbortSignal): Promise<PropertyProfileResponse> {
      return client.get<PropertyProfileResponse>(
        'admin/property/profile',
        signal ? { signal } : {},
      );
    },

    /** Static reference data: the presets offered when onboarding or reshaping a project. */
    types(signal?: AbortSignal): Promise<PropertyTypeOption[]> {
      return client.get<PropertyTypeOption[]>('admin/property/types', signal ? { signal } : {});
    },

    /** Replaces the whole level set. `409 PROPERTY_TREE_NOT_EMPTY` once any node exists. */
    defineLevels(body: DefineLevelsRequest): Promise<PropertyProfileResponse> {
      return client.put<PropertyProfileResponse>('admin/property/levels', { json: body });
    },

    /** Wording only, and therefore available at any time — unlike {@link defineLevels}. */
    renameLevel(id: PropertyLevelId, body: RenameLevelRequest): Promise<PropertyProfileResponse> {
      return client.patch<PropertyProfileResponse>(`admin/property/levels/${id}`, { json: body });
    },

    /**
     * `parentId` lists one node's children; `depth` lists a whole level at once ("every unit").
     * Passing neither returns the entire tree.
     */
    listNodes(
      params: { parentId?: PropertyNodeId | null; depth?: number | null } = {},
      signal?: AbortSignal,
    ): Promise<PropertyNodeResponse[]> {
      return client.get<PropertyNodeResponse[]>('admin/property/nodes', {
        searchParams: {
          parentId: params.parentId ?? undefined,
          depth: params.depth ?? undefined,
        },
        ...(signal ? { signal } : {}),
      });
    },

    createNode(body: CreateNodeRequest): Promise<PropertyNodeResponse> {
      return client.post<PropertyNodeResponse>('admin/property/nodes', { json: body });
    },

    updateNode(id: PropertyNodeId, body: UpdateNodeRequest): Promise<PropertyNodeResponse> {
      return client.patch<PropertyNodeResponse>(`admin/property/nodes/${id}`, { json: body });
    },

    deleteNode(id: PropertyNodeId): Promise<void> {
      return client.delete(`admin/property/nodes/${id}`);
    },

    /** Generates a building's floors and units in one transaction — all or nothing. */
    bulkCreate(body: BulkCreateRequest): Promise<BulkCreateResponse> {
      return client.post<BulkCreateResponse>('admin/property/nodes/bulk', { json: body });
    },

    /** How many people live in a unit, including those with no app account. */
    setOccupancy(id: PropertyNodeId, body: SetOccupancyRequest): Promise<PropertyNodeResponse> {
      return client.put<PropertyNodeResponse>(`admin/property/nodes/${id}/occupancy`, {
        json: body,
      });
    },

    /**
     * Unit occupancy, resident headcount and visitors on site, reported separately.
     *
     * Distinct from `adminVisits.inside()`, which is the live gate roll — that one is the guard's
     * screen, this one is the developer's.
     */
    occupancy(signal?: AbortSignal): Promise<OccupancySummaryResponse> {
      return client.get<OccupancySummaryResponse>(
        'admin/property/occupancy',
        signal ? { signal } : {},
      );
    },
  };
}
