"use client";

import { useMemo } from "react";
import { useHome } from "@/components/home/HomeState";
import { button, cx, sectionTitle } from "@/components/ui/styles";
import { matches, PAGE_SIZE } from "@/lib/home/events";
import type { PriceFilter, WhenFilter } from "@/lib/home/types";
import EventTile from "./EventTile";
import FilterMenu, { Check, optionBtn } from "./FilterMenu";
import LocationFilter from "./LocationFilter";

const WHEN: { v: WhenFilter; label: string }[] = [
  { v: "", label: "Any date" },
  { v: "0", label: "Today" },
  { v: "weekend", label: "This weekend" },
  { v: "7", label: "Next 7 days" },
  { v: "30", label: "Next 30 days" },
];

const PRICE: { v: PriceFilter; label: string }[] = [
  { v: "", label: "Any price" },
  { v: "free", label: "Free" },
  { v: "u25", label: "$25 and under" },
  { v: "25to50", label: "$25 to $50" },
  { v: "o50", label: "Over $50" },
];

function Options<T extends string>({ list, value, onPick }: { list: { v: T; label: string }[]; value: T; onPick: (v: T) => void }) {
  return (
    <>
      {list.map((o) => (
        <button key={o.v || "any"} type="button" aria-pressed={value === o.v} className={optionBtn} onClick={() => onPick(o.v)}>
          {o.label}
          {value === o.v && <Check />}
        </button>
      ))}
    </>
  );
}

export default function EventsGrid() {
  const { today, upcoming, filters, setFilters, showMore, clearAll, categories } = useHome();
  const list = useMemo(() => upcoming.filter((e) => matches(e, filters, today)), [upcoming, filters, today]);
  // 20 per page here (fills rows of 5, 4 and 2); filters.shown counts pages of PAGE_SIZE shared with the homepage
  const perPage = 20;
  const limit = Math.round(filters.shown / PAGE_SIZE) * perPage;
  const shown = list.slice(0, limit);

  const city = filters.near ? filters.near.label.split(",")[0] : "";
  const whenLabel = WHEN.find((w) => w.v === filters.when)?.label ?? "Date";
  const priceLabel = PRICE.find((p) => p.v === filters.price)?.label ?? "Price";
  const filtered = !!(filters.when || filters.price || filters.cat || filters.q || filters.near);

  return (
    <section id="events" aria-labelledby="upcoming-h" className="scroll-mt-24 px-(--pad) pt-24 pb-[150px] first:pt-[128px] max-[901px]:first:pt-[104px] max-[721px]:pt-16 max-[721px]:pb-[110px] max-[721px]:first:pt-[104px]">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 id="upcoming-h" className={cx(sectionTitle, "text-[26px] tracking-[-0.02em]")}>
          {city ? `Upcoming near ${city}` : "Upcoming events"}
        </h2>
        <div className="flex flex-wrap gap-[10px]">
          <LocationFilter />
          <FilterMenu label={filters.when ? whenLabel : "Date"} active={!!filters.when}>
            {(close) => (
              <Options
                list={WHEN}
                value={filters.when}
                onPick={(v) => {
                  setFilters({ when: v });
                  close();
                }}
              />
            )}
          </FilterMenu>
          <FilterMenu label={filters.price ? priceLabel : "Price"} active={!!filters.price}>
            {(close) => (
              <Options
                list={PRICE}
                value={filters.price}
                onPick={(v) => {
                  setFilters({ price: v });
                  close();
                }}
              />
            )}
          </FilterMenu>
          <FilterMenu label={filters.cat || "Category"} active={!!filters.cat} align="right">
            {(close) => (
              <Options
                list={[{ v: "", label: "All categories" }, ...categories.map((c) => ({ v: c.name, label: c.name }))]}
                value={filters.cat}
                onPick={(v) => {
                  setFilters({ cat: v });
                  close();
                }}
              />
            )}
          </FilterMenu>
        </div>
      </div>

      {(filters.q || filtered) && (
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[14px] text-fx-red/78" aria-live="polite">
          {filters.q && (
            <span>
              Results for <b className="text-fx-red">“{filters.q}”</b>
            </span>
          )}
          <button type="button" onClick={clearAll} className="min-h-11 cursor-pointer font-semibold text-fx-red-second underline underline-offset-4">
            Clear filters
          </button>
        </div>
      )}

      {shown.length ? (
        <div className="mt-8 grid grid-cols-5 gap-x-7 gap-y-10 max-[1181px]:grid-cols-4 max-[901px]:grid-cols-3 max-[721px]:grid-cols-2 max-[721px]:gap-x-4 max-[721px]:gap-y-8">
          {shown.map((e) => (
            <EventTile key={e.id} e={e} />
          ))}
        </div>
      ) : (
        <div className="mt-8 rounded-[24px] border border-fx-red/14 bg-white px-6 py-12 text-center">
          <p className="m-0 font-display text-[22px] font-semibold">
            {filters.near ? `Nothing matches near ${filters.near.label} yet.` : "Nothing matches those filters yet."}
          </p>
          <p className="mt-2 text-[15px] text-fx-red/78">
            {filters.near ? "Try a wider distance in the location menu, or clear the filters." : "Try another date or price."}
          </p>
          <button type="button" onClick={clearAll} className={cx(button("red"), "mt-5")}>
            Clear filters
          </button>
        </div>
      )}

      {list.length > limit && (
        <div className="mt-12 flex justify-center">
          <button type="button" className={button("outline")} onClick={showMore}>
            Show more events
          </button>
        </div>
      )}
    </section>
  );
}
