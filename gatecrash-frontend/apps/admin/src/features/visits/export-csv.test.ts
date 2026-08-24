import type { VisitResponse } from '@gatecrash/api';
import { insideVisitFixture } from '@gatecrash/api/mocks';
import { CLIENT_LIMITS } from '@gatecrash/core';
import { describe, expect, it, vi } from 'vitest';
import { ExportTooLargeError, escapeCsv, exportVisitsCsv, toCsv } from './export-csv';

/**
 * CSV export — FRONTEND.md §8.4.
 *
 * The cap is the point: without a server export endpoint (§15.4), an unfiltered twelve-month
 * export would page the API hundreds of times. Refusing early, in one round-trip, is what keeps
 * an admin from DoSing the box by accident.
 */

describe('escapeCsv', () => {
  it('quotes values containing a comma, a quote or a newline', () => {
    expect(escapeCsv('Suresh Iyer')).toBe('Suresh Iyer');
    expect(escapeCsv('Iyer, Suresh')).toBe('"Iyer, Suresh"');
    expect(escapeCsv('He said "hi"')).toBe('"He said ""hi"""');
    expect(escapeCsv('line1\nline2')).toBe('"line1\nline2"');
  });

  it('renders a missing value as empty rather than "null"', () => {
    expect(escapeCsv(null)).toBe('');
    expect(escapeCsv(undefined)).toBe('');
  });
});

describe('toCsv', () => {
  it('writes a header and one row per visit', () => {
    const csv = toCsv([insideVisitFixture as VisitResponse]);
    const lines = csv.split('\r\n');

    expect(lines[0]).toContain('Visitor');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('Suresh Iyer');
    expect(lines[1]).toContain('MH12AB1234');
  });

  it('produces only a header for an empty result', () => {
    expect(toCsv([]).split('\r\n')).toHaveLength(1);
  });
});

describe('exportVisitsCsv', () => {
  const visit = insideVisitFixture as VisitResponse;

  function fakeEndpoints(totalElements: number, totalPages: number, perPage = 2) {
    const search = vi.fn(async (_filters: unknown, page: { page: number }) => ({
      content: Array.from({ length: perPage }, (_, i) => ({
        ...visit,
        id: `${page.page}-${i}`,
      })) as VisitResponse[],
      page: page.page - 1,
      size: perPage,
      totalElements,
      totalPages,
      first: page.page === 1,
      last: page.page === totalPages,
    }));
    return { endpoints: { adminVisits: { search } } as never, search };
  }

  it('pages through every page sequentially and reports progress', async () => {
    const { endpoints, search } = fakeEndpoints(6, 3);
    const progress: number[] = [];

    const { rows } = await exportVisitsCsv(endpoints, {}, (p) => progress.push(p.done));

    expect(rows).toBe(6);
    expect(search).toHaveBeenCalledTimes(3);
    // Sequential and observable — a silent burst of requests is indistinguishable from a hang.
    expect(progress).toEqual([2, 4, 6]);
    expect(search.mock.calls.map((c) => (c[1] as { page: number }).page)).toEqual([1, 2, 3]);
  });

  it('refuses an oversized export after a single probe request', async () => {
    const { endpoints, search } = fakeEndpoints(CLIENT_LIMITS.csvExportMaxRows + 1, 500);

    await expect(exportVisitsCsv(endpoints, {}, () => {})).rejects.toBeInstanceOf(
      ExportTooLargeError,
    );
    // One request, not fifty: the refusal must not itself be the expensive thing.
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('stops early when the caller aborts', async () => {
    const { endpoints, search } = fakeEndpoints(20, 10);
    const controller = new AbortController();

    const promise = exportVisitsCsv(endpoints, {}, () => controller.abort(), controller.signal);
    await promise;

    expect(search).toHaveBeenCalledTimes(1);
  });
});
