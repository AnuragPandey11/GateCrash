import type { Endpoints, VisitFilters, VisitResponse } from '@gatecrash/api';
import { CLIENT_LIMITS, formatDateTime } from '@gatecrash/core';

/**
 * Client-side CSV export — FRONTEND.md §8.4.
 *
 * There is **no server export endpoint** (§15.4), so this pages the API and assembles the file
 * in the browser. That is the honest interim, and the 10,000-row cap is what stops an admin
 * DoSing the box with a twelve-month unfiltered export. When the streaming endpoint lands, this
 * whole module and its cap disappear.
 *
 * Paging is sequential and reports progress, because a silent burst of 50 requests taking twenty
 * seconds is indistinguishable from a hung button.
 */

export interface ExportProgress {
  done: number;
  total: number;
}

export class ExportTooLargeError extends Error {
  constructor(readonly total: number) {
    super(`Export of ${total} rows exceeds the ${CLIENT_LIMITS.csvExportMaxRows} row cap`);
    this.name = 'ExportTooLargeError';
  }
}

const COLUMNS = [
  'Logged at',
  'Visitor',
  'Phone',
  'Type',
  'Meet sales agent',
  'Vehicle',
  'Gate',
  'Destination flat',
  'Routed to',
  'Status',
  'Decided at',
  'Checked in',
  'Checked out',
  'Logged by',
] as const;

export function escapeCsv(value: string | null | undefined): string {
  const text = value ?? '';
  // A visitor named  O'Brien, Jr.  and a comma-bearing gate name both have to survive this.
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toRow(visit: VisitResponse): string {
  return [
    formatDateTime(visit.createdAt, ''),
    visit.visitorName,
    visit.visitorPhone,
    visit.visitorType,
    visit.meetSalesAgent ? 'Yes' : 'No',
    visit.vehicleNo,
    visit.gateName,
    visit.targetFlatNumber,
    visit.approverName,
    visit.status,
    formatDateTime(visit.decidedAt, ''),
    formatDateTime(visit.checkedInAt, ''),
    formatDateTime(visit.checkedOutAt, ''),
    visit.loggedByName,
  ]
    .map(escapeCsv)
    .join(',');
}

export function toCsv(rows: VisitResponse[]): string {
  return [COLUMNS.join(','), ...rows.map(toRow)].join('\r\n');
}

export async function exportVisitsCsv(
  endpoints: Endpoints,
  filters: VisitFilters,
  onProgress: (progress: ExportProgress) => void,
  signal?: AbortSignal,
): Promise<{ csv: string; rows: number }> {
  const size = CLIENT_LIMITS.csvExportPageSize;

  // One probe request to learn the size before committing to the loop, so an oversized export is
  // refused in a single round-trip rather than after paging halfway through it.
  const first = await endpoints.adminVisits.search(
    filters,
    { page: 1, size, sort: 'createdAt,desc' },
    signal,
  );

  if (first.totalElements > CLIENT_LIMITS.csvExportMaxRows) {
    throw new ExportTooLargeError(first.totalElements);
  }

  const rows: VisitResponse[] = [...first.content];
  onProgress({ done: rows.length, total: first.totalElements });

  for (let pageNumber = 2; pageNumber <= first.totalPages; pageNumber += 1) {
    if (signal?.aborted) break;
    const next = await endpoints.adminVisits.search(
      filters,
      { page: pageNumber, size, sort: 'createdAt,desc' },
      signal,
    );
    rows.push(...next.content);
    onProgress({ done: rows.length, total: first.totalElements });
  }

  return { csv: toCsv(rows), rows: rows.length };
}

/** Hand the assembled file to the browser. */
export function downloadCsv(csv: string, filename: string): void {
  // The BOM is what makes Excel open UTF-8 correctly rather than mangling every non-ASCII name.
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
