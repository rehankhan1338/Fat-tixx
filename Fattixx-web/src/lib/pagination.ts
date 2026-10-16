/** Shared page/per-page parsing for list pages driven by URL search params. */
export const PER_PAGE_OPTIONS = [25, 50, 100, 500] as const;
export const DEFAULT_PER_PAGE: (typeof PER_PAGE_OPTIONS)[number] = 50;

export interface Pagination { page: number; perPage: number; offset: number }

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Reads `page` and `per` from the search params. Pass a `prefix` when a page hosts more than one
 * paginated list so each one keeps its own keys (e.g. prefix "sms" reads `smspage` / `smsper`).
 */
export function parsePagination(sp: SearchParams, prefix = ''): Pagination {
  const perKey = `${prefix}per`;
  const pageKey = `${prefix}page`;
  const rawPer = Number(typeof sp[perKey] === 'string' ? sp[perKey] : DEFAULT_PER_PAGE);
  const perPage = (PER_PAGE_OPTIONS as readonly number[]).includes(rawPer) ? rawPer : DEFAULT_PER_PAGE;
  const rawPage = Number(typeof sp[pageKey] === 'string' ? sp[pageKey] : 1);
  const page = Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1;
  return { page, perPage, offset: (page - 1) * perPage };
}

/** Search params to carry along so another list's pagination survives navigation on the same page. */
export function paginationParams(p: Pagination, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  if (p.perPage !== DEFAULT_PER_PAGE) out[`${prefix}per`] = String(p.perPage);
  if (p.page > 1) out[`${prefix}page`] = String(p.page);
  return out;
}
