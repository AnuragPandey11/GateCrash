import type { VisitFilters } from '@gatecrash/api';
import { PAGE_DEFAULTS, type PageArgs } from '@gatecrash/api';
import { asId, type VisitStatus, type VisitorType } from '@gatecrash/core';
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Filters live in the **URL query string** — FRONTEND.md §8.4.
 *
 * Not in component state: an admin will want to send a colleague a link to "all rejected visits
 * at the service gate last Tuesday", and a filter set that only exists in React state cannot be
 * linked, bookmarked, or survive a reload. `useSearchParams` is the source of truth and the query
 * key derives from it, which also means back/forward navigation works for free.
 */
export interface VisitFilterState {
  filters: VisitFilters;
  page: PageArgs;
  setFilter: <K extends keyof VisitFilters>(key: K, value: VisitFilters[K]) => void;
  setPage: (page: number) => void;
  clear: () => void;
  activeCount: number;
}

const DEFAULT_SORT = 'createdAt,desc';

export function useVisitFilters(): VisitFilterState {
  const [params, setParams] = useSearchParams();

  const filters = useMemo<VisitFilters>(
    () => ({
      status: (params.get('status') as VisitStatus | null) || null,
      visitorType: (params.get('visitorType') as VisitorType | null) || null,
      // Tri-state in the URL: absent = either, 'true' = met sales, 'false' = did not.
      meetSalesAgent:
        params.get('meetSalesAgent') === 'true'
          ? true
          : params.get('meetSalesAgent') === 'false'
            ? false
            : null,
      gateId: params.get('gateId') ? asId.gate(params.get('gateId') as string) : null,
      flatId: params.get('flatId') ? asId.flat(params.get('flatId') as string) : null,
      from: params.get('from') || null,
      to: params.get('to') || null,
    }),
    [params],
  );

  const page = useMemo<PageArgs>(
    () => ({
      page: Math.max(1, Number(params.get('page') ?? '1') || 1),
      size: PAGE_DEFAULTS.visits,
      sort: params.get('sort') ?? DEFAULT_SORT,
    }),
    [params],
  );

  const setFilter = useCallback<VisitFilterState['setFilter']>(
    (key, value) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value === null || value === undefined || value === '') next.delete(key);
          else next.set(key, String(value));
          // Any filter change invalidates the current page number — page 7 of the old result
          // set is meaningless against the new one, and often out of range.
          next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const setPage = useCallback(
    (value: number) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value <= 1) next.delete('page');
          else next.set('page', String(value));
          return next;
        },
        { replace: false },
      );
    },
    [setParams],
  );

  const clear = useCallback(() => setParams(new URLSearchParams(), { replace: true }), [setParams]);

  const activeCount = useMemo(
    () => Object.values(filters).filter((v) => v !== null && v !== undefined && v !== '').length,
    [filters],
  );

  return { filters, page, setFilter, setPage, clear, activeCount };
}
