"use client";

/* Category pills. Clicking one filters the event grid (click again to clear) and scrolls to it. */

import { CATEGORIES } from "@/lib/event-categories";
import { cardShadow, container, cx, eyebrow } from "@/components/home/styles";
import { useHome } from "./HomeState";

export default function Categories() {
  const { filters, setFilters } = useHome();
  return (
    <section className="relative bg-fx-ivory pt-[110px] max-[721px]:pt-[88px]" aria-labelledby="cat-h">
      <div className={container}>
        <div className={eyebrow} id="cat-h">
          Browse by category
        </div>
        <div className="no-scrollbar mt-7 flex gap-[10px] overflow-x-auto pb-1 max-[721px]:mx-[calc(var(--pad)*-1)] max-[721px]:px-(--pad)">
          {CATEGORIES.map((c) => (
            <button
              key={c.name}
              type="button"
              aria-pressed={filters.cat === c.name}
              onClick={() => setFilters({ cat: filters.cat === c.name ? "" : c.name }, { scroll: true })}
              className={cx(
                "group inline-flex min-h-12 shrink-0 cursor-pointer items-center gap-[10px] rounded-full border border-fx-red/14 bg-white pr-[18px] pl-[14px] text-[14px] font-medium text-fx-red transition-colors duration-200 hover:border-fx-red/30",
                "aria-pressed:border-fx-red aria-pressed:bg-fx-red aria-pressed:text-fx-ivory",
                cardShadow,
              )}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="text-fx-red/78 transition-colors duration-200 group-aria-pressed:text-fx-ivory"
              >
                <path d={c.icon} />
              </svg>
              {c.name}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
