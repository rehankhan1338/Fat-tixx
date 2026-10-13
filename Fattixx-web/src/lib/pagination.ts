/** Shared page/per-page parsing for list pages driven by URL search params. */
export const PER_PAGE_OPTIONS = [50, 100, 500] as const;
export const DEFAULT_PER_PAGE: (typeof PER_PAGE_OPTIONS)[number] = 50;

export interface Pagination { page: number; perPage: number; offset: number }

type SearchParams = Record<string, string | string[] | undefined>;

export function parsePagination(sp: SearchParams): Pagination {
  const rawPer = Number(typeof sp.per === 'string' ? sp.per : DEFAULT_PER_PAGE);
  const perPage = (PER_PAGE_OPTIONS as readonly number[]).includes(rawPer) ? rawPer : DEFAULT_PER_PAGE;
  const rawPage = Number(typeof sp.page === 'string' ? sp.page : 1);
  const page = Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1;
  return { page, perPage, offset: (page - 1) * perPage };
}
