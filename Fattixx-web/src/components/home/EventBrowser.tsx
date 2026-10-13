"use client";

/* Saved events are stored locally until account favorites are connected. */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { categoryIconPath } from "@/lib/event-categories";
import { eventHref, isPro, matches, organizerName, priceText, whenText } from "@/lib/home/events";
import type { ListedEvent } from "@/lib/home/events";
import type { WhenFilter } from "@/lib/home/types";
import type { HomeContent } from "@/lib/site-content/schema";
import { useHome } from "./HomeState";
import { HeartIcon } from "./icons";
import ProBadge from "@/components/events/ProBadge";
import EventArt from "@/components/ui/EventArt";
import { button, cardShadow, container, cx, eyebrow, sectionTitle } from "@/components/ui/styles";

const SAVED_KEY = "fx_saved";
const WHEN_PILLS: { v: WhenFilter; label: string }[] = [
  { v: "", label: "All dates" },
  { v: "weekend", label: "This weekend" },
  { v: "30", label: "Next 30 days" },
];

const SEARCH_ICON =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23A8121A' stroke-opacity='.75' stroke-width='2.4' stroke-linecap='round'%3E%3Ccircle cx='11' cy='11' r='7'/%3E%3Cpath d='M20 20l-4-4'/%3E%3C/svg%3E\")";
const CHEVRON_ICON =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%23A8121A' stroke-opacity='.75' stroke-width='2' fill='none'/%3E%3C/svg%3E\")";

const pill =
  "min-h-[38px] cursor-pointer rounded-full border border-fx-red/14 bg-white px-[14px] text-[13px] font-medium text-fx-red/78 transition-colors duration-200 hover:border-fx-red/30 hover:text-fx-red aria-pressed:border-fx-red aria-pressed:bg-fx-red aria-pressed:text-fx-ivory";

function EventCard({ e, saved, onSave }: { e: ListedEvent; saved: boolean; onSave: () => void }) {
  return (
    <article className="group relative flex animate-rise flex-col gap-[14px] max-[481px]:grid max-[481px]:grid-cols-[112px_minmax(0,1fr)] max-[481px]:items-start">

      <span
        className={cx(
          "poster pv" + e.v,
          "aspect-[4/5] transition-transform duration-500 ease-fx group-hover:scale-102 after:hidden max-[481px]:rounded-[14px]",
          cardShadow,
        )}
        aria-hidden="true"
      >
        <EventArt e={e} sizes="(max-width: 480px) 112px, (max-width: 720px) 50vw, 300px" logoBox="inset-x-[14%] inset-y-[28%]" className="border border-fx-red/10 rounded-[inherit]" />
      </span>
      <button
        type="button"
        aria-pressed={saved}
        aria-label={"Save " + e.title}
        onClick={onSave}
        className="absolute top-[10px] right-[10px] z-[3] flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-white/20 bg-fx-red-deep/45 text-white backdrop-blur-[8px] transition-transform duration-200 active:scale-90 aria-pressed:[&_svg]:fill-fx-yellow aria-pressed:[&_svg]:stroke-fx-yellow max-[481px]:top-[6px] max-[481px]:right-auto max-[481px]:left-[76px] max-[481px]:h-[30px] max-[481px]:w-[30px] max-[481px]:[&_svg]:h-[15px] max-[481px]:[&_svg]:w-[15px]"
      >
        <HeartIcon />
      </button>
      <div className="flex flex-col gap-[5px] max-[481px]:pt-[2px]">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] font-semibold tracking-[.06em] text-fx-red-second uppercase">
          {whenText(e.dt)}
          {e.tag && (
            <span className="inline-block rounded-full border border-fx-red/30 px-2 py-[2px] align-[1px] text-[11px] font-medium tracking-normal text-fx-red/78 normal-case">
              {e.tag}
            </span>
          )}
        </span>
        <h3 className="font-display text-[19px] leading-[1.2] font-semibold tracking-[-0.015em] max-[481px]:text-[17px]">
          <a href={eventHref(e)} className="after:absolute after:inset-0 after:z-[1] after:content-['']">
            {e.title}
          </a>
        </h3>
        <span className="text-[14px] text-fx-red/78">
          {e.venue}, {e.city}
        </span>
        <div className="mt-[6px] flex items-center justify-between gap-[10px] max-[481px]:mt-1 max-[481px]:flex-col max-[481px]:items-start max-[481px]:gap-[6px]">
          <span className="text-[14px] font-semibold">{priceText(e)}</span>
          <span className="inline-flex min-w-0 items-center gap-[7px] text-[13px] text-fx-red/78">
            <span className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border border-fx-red/30 bg-fx-sand text-[9px] font-bold text-fx-red">
              {e.organizerInitials}
            </span>
            <span className="truncate">{organizerName(e)}</span>
            {isPro(e) && <ProBadge size={14} />}
          </span>
        </div>
      </div>
    </article>
  );
}

/** Section copy comes from Super Admin → Website; /events reuses the browser with its own heading. */
export default function EventBrowser({
  content: c = { show: true, eyebrow: "On sale now", title: "Upcoming events", link: { label: "Browse all events", href: "/events" } },
}: { content?: HomeContent["browse"] }) {
  const { today, upcoming, filters, setFilters, showMore, clearAll, clearPlace, focusLocation, categories } = useHome();
  const [saved, setSaved] = useState<Record<string, 1>>({});
  const [qText, setQText] = useState(filters.q);
  const qTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // saved events live in this browser; read them after hydration
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      try {
        setSaved(JSON.parse(localStorage.getItem(SAVED_KEY) || "{}") || {});
      } catch {
        /* storage blocked */
      }
    });
    return () => cancelAnimationFrame(id);
  }, []);
  // the nav search changes the shared filter: mirror it into the box (adjusting state while rendering)
  const [seenQ, setSeenQ] = useState(filters.q);
  if (seenQ !== filters.q) {
    setSeenQ(filters.q);
    setQText(filters.q);
  }

  function toggleSave(id: number) {
    setSaved((s) => {
      const next = { ...s };
      if (next[id]) delete next[id];
      else next[id] = 1;
      try {
        localStorage.setItem(SAVED_KEY, JSON.stringify(next));
      } catch {
        /* storage blocked */
      }
      return next;
    });
  }

  const cities = useMemo(() => Array.from(new Set(upcoming.map((e) => e.city))).sort(), [upcoming]);
  const list = useMemo(() => upcoming.filter((e) => matches(e, filters, today)), [upcoming, filters, today]);
  const shown = list.slice(0, filters.shown);

  const chip = (label: string, onClear: () => void) => (
    <button
      type="button"
      onClick={onClear}
      className="relative inline-flex min-h-[38px] cursor-pointer items-center gap-2 rounded-full border border-fx-yellow/90 bg-fx-yellow/35 pr-[6px] pl-[14px] text-[13px] font-semibold text-fx-red"
    >
      {label}
      <span aria-hidden="true" className="flex h-6 w-6 items-center justify-center rounded-full bg-fx-red/12 text-[13px]">
        ×
      </span>
      <span className="sr-only">Remove filter</span>
    </button>
  );

  return (
    <section className="relative scroll-mt-20 bg-fx-ivory pt-[110px] max-[721px]:pt-[88px]" id="events" aria-labelledby="browse-h">
      <div className={container}>
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <div className={eyebrow}>{c.eyebrow}</div>
            <h2 className={cx(sectionTitle, "mt-[10px] text-[clamp(32px,3.6vw,48px)] leading-[1.02] tracking-[-0.035em]")} id="browse-h">
              {c.title}
            </h2>
            {filters.near && (
              <p className="mt-[10px] text-[16px] text-fx-red/78">
                Browsing events near <b className="text-fx-red">{filters.near.label}</b>{" "}
                <button
                  type="button"
                  onClick={focusLocation}
                  className="ml-[6px] cursor-pointer bg-transparent p-0 font-semibold text-fx-red-second underline underline-offset-[3px]"
                >
                  Change
                </button>
              </p>
            )}
          </div>
          {c.link.label && (
            <Link href={c.link.href} className="text-[15px] font-semibold text-fx-red-second underline decoration-fx-red/30 underline-offset-4 hover:decoration-fx-red">
              {c.link.label}
            </Link>
          )}
        </div>

        <div
          role="group"
          aria-label="Categories"
          className="no-scrollbar mt-7 flex flex-wrap gap-2 max-[1101px]:mx-[calc(var(--pad)*-1)] max-[1101px]:flex-nowrap max-[1101px]:overflow-x-auto max-[1101px]:px-(--pad) max-[1101px]:py-[2px] max-[1101px]:*:shrink-0"
        >
          <button type="button" className={cx(pill, "min-h-10 px-[14px]")} aria-pressed={!filters.cat} onClick={() => setFilters({ cat: "" })}>
            All
          </button>
          {categories.map((cat) => (
            <button
              key={cat.name}
              type="button"
              aria-pressed={filters.cat === cat.name}
              onClick={() => setFilters({ cat: filters.cat === cat.name ? "" : cat.name })}
              className={cx(pill, "inline-flex min-h-10 items-center gap-[7px] pr-[14px] pl-[11px]")}
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="shrink-0"
              >
                <path d={categoryIconPath(cat.icon)} />
              </svg>
              {cat.name}
            </button>
          ))}
        </div>

        <div
          role="group"
          aria-label="Filter events"
          className="no-scrollbar relative mt-3 flex flex-wrap items-center gap-2 max-[721px]:mx-[calc(var(--pad)*-1)] max-[721px]:flex-nowrap max-[721px]:overflow-x-auto max-[721px]:px-(--pad) max-[721px]:py-[2px] max-[721px]:*:shrink-0"
        >
          {WHEN_PILLS.map((w) => (
            <button key={w.label} type="button" className={pill} aria-pressed={filters.when === w.v} onClick={() => setFilters({ when: w.v })}>
              {w.label}
            </button>
          ))}
          <button type="button" className={pill} aria-pressed={filters.price === "free"} onClick={() => setFilters({ price: filters.price === "free" ? "" : "free" })}>
            Free
          </button>
          <label className="sr-only" htmlFor="q">
            Search events
          </label>
          <input
            id="q"
            type="search"
            placeholder="Search events"
            autoComplete="off"
            value={qText}
            onChange={(ev) => {
              const v = ev.target.value;
              setQText(v);
              clearTimeout(qTimer.current);
              qTimer.current = setTimeout(() => setFilters({ q: v }), 150);
            }}
            style={{ backgroundImage: SEARCH_ICON }}
            className="min-h-[38px] w-[200px] rounded-full border border-fx-red/14 bg-white bg-[position:14px_center] bg-no-repeat pr-[14px] pl-9 text-[13px] text-fx-red outline-none placeholder:text-fx-red/55 focus:border-fx-red/30"
          />
          <label className="sr-only" htmlFor="city-f">
            City
          </label>
          <select
            id="city-f"
            value={filters.city}
            onChange={(ev) => setFilters({ city: ev.target.value })}
            style={{ backgroundImage: CHEVRON_ICON }}
            className="min-h-[38px] cursor-pointer appearance-none rounded-full border border-fx-red/14 bg-white bg-[position:right_14px_center] bg-no-repeat pr-[34px] pl-[14px] text-[13px] font-medium text-fx-red/78"
          >
            <option value="">All cities</option>
            {cities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <span className="inline-flex gap-1 empty:hidden max-[721px]:flex max-[721px]:gap-2">
            {filters.org && chip(upcoming.find((e) => e.organizerId === filters.org)?.organizerName ?? filters.org, () => setFilters({ org: "" }))}
            {filters.near && chip("Near " + filters.near.label, clearPlace)}
          </span>
          <span className="ml-auto text-[13px] text-fx-red/78 max-[721px]:ml-0 max-[721px]:pr-(--pad)" aria-live="polite">
            {list.length} {list.length === 1 ? "event" : "events"}
          </span>
        </div>

        <div className="mt-7 grid grid-cols-4 gap-x-[22px] gap-y-10 max-[1101px]:grid-cols-3 max-[721px]:grid-cols-2 max-[721px]:gap-x-[14px] max-[721px]:gap-y-[30px] max-[481px]:grid-cols-1 max-[481px]:gap-[22px]">
          {shown.length ? (
            shown.map((e) => <EventCard key={e.id} e={e} saved={!!saved[e.id]} onSave={() => toggleSave(e.id)} />)
          ) : (
            <div className="col-span-full rounded-[20px] border border-fx-red/14 p-12 text-center text-[16px] text-fx-red/78">
              {filters.near ? `No events near ${filters.near.label} match yet.` : "No events match those filters yet."}{" "}
              <button type="button" className={cx(pill, "ml-2")} onClick={clearAll}>
                Clear filters
              </button>
            </div>
          )}
        </div>
        {list.length > filters.shown && (
          <div className="mt-12 flex justify-center">
            <button type="button" className={button("outline")} onClick={showMore}>
              Show more events
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
