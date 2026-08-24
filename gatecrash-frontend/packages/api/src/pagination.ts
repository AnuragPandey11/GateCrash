/**
 * The pagination envelope — FRONTEND.md §4.4.
 *
 * Spring's `page` is **zero-based**; every table UI wants 1-based. The conversion happens here
 * and only here, because a codebase with two conversion sites eventually has one that forgot.
 */

export interface PageResponse<T> {
  content: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
  first: boolean;
  last: boolean;
}

/** What a UI holds: a 1-based page number. */
export interface PageArgs {
  page: number;
  size: number;
  /** `field,dir` exactly as Spring's `Pageable` wants it. */
  sort?: string;
}

/**
 * Per-endpoint `@PageableDefault` sizes, from the controllers. Pass `size` explicitly anyway
 * (§4.4) — relying on a server default means a backend tweak silently resizes a table.
 */
export const PAGE_DEFAULTS = {
  users: 25,
  visits: 50,
  community: 20,
  notifications: 25,
  inbox: 25,
  passes: 25,
} as const;

/** 1-based UI page → the 0-based `page`/`size`/`sort` params Spring binds. */
export function toPageParams(args: PageArgs): Record<string, string | number> {
  const params: Record<string, string | number> = {
    page: Math.max(0, args.page - 1),
    size: args.size,
  };
  if (args.sort) params.sort = args.sort;
  return params;
}

/** 0-based server page → the 1-based number a paginator renders. */
export function currentPage(response: Pick<PageResponse<unknown>, 'page'>): number {
  return response.page + 1;
}

export function emptyPage<T>(size: number): PageResponse<T> {
  return {
    content: [],
    page: 0,
    size,
    totalElements: 0,
    totalPages: 0,
    first: true,
    last: true,
  };
}

/** "Showing 51–100 of 342" — the one bit of paginator arithmetic worth not repeating. */
export function pageRange(response: PageResponse<unknown>): { from: number; to: number } {
  if (response.totalElements === 0) return { from: 0, to: 0 };
  const from = response.page * response.size + 1;
  return { from, to: Math.min(from + response.content.length - 1, response.totalElements) };
}

export function hasNextPage(response: PageResponse<unknown>): boolean {
  return !response.last;
}

/** Map a page's rows while keeping the envelope — used when branding ids after a parse. */
export function mapPage<T, U>(page: PageResponse<T>, fn: (item: T) => U): PageResponse<U> {
  return { ...page, content: page.content.map(fn) };
}
