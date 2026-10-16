"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { DEFAULT_PER_PAGE, PER_PAGE_OPTIONS } from "@/lib/pagination";

/**
 * Prev/next controls plus a "rows per page" selector. State lives in the URL (`page`, `per`),
 * so the server component re-queries on navigation. `params` carries any extra filters to keep.
 * `prefix` namespaces the keys (`<prefix>page`, `<prefix>per`) when a page has several lists.
 */
export function TablePagination({ page, perPage, total, params = {}, prefix = "" }: { page: number; perPage: number; total: number; params?: Record<string, string>; prefix?: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const pages = Math.max(1, Math.ceil(total / perPage));
  const from = total === 0 ? 0 : (page - 1) * perPage + 1;
  const to = Math.min(total, page * perPage);
  const perKey = `${prefix}per`;
  const pageKey = `${prefix}page`;

  const href = (p: number, per = perPage) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v && k !== perKey && k !== pageKey) q.set(k, v);
    if (per !== DEFAULT_PER_PAGE) q.set(perKey, String(per));
    if (p > 1) q.set(pageKey, String(p));
    const s = q.toString();
    return s ? `${pathname}?${s}` : pathname;
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-sm text-muted-foreground">
      <div className="flex items-center gap-2">
        <label htmlFor={`${prefix}per-page`} className="whitespace-nowrap">Rows per page</label>
        <NativeSelect size="sm" id={`${prefix}per-page`} value={perPage} onChange={(e) => router.push(href(1, Number(e.target.value)))}>
          {PER_PAGE_OPTIONS.map((n) => <NativeSelectOption key={n} value={n}>{n}</NativeSelectOption>)}
        </NativeSelect>
      </div>
      <div className="flex items-center gap-3">
        <span className="whitespace-nowrap">{total === 0 ? "No rows" : `${from}–${to} of ${total.toLocaleString()}`}</span>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" disabled={page <= 1} render={page <= 1 ? undefined : <Link href={href(page - 1)} />} aria-label="Previous page"><ChevronLeftIcon /></Button>
          <span className="px-2 font-mono text-xs">{page} / {pages}</span>
          <Button variant="outline" size="sm" disabled={page >= pages} render={page >= pages ? undefined : <Link href={href(page + 1)} />} aria-label="Next page"><ChevronRightIcon /></Button>
        </div>
      </div>
    </div>
  );
}
