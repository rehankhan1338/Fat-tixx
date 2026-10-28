"use client";

/* Location priority: saved place, permitted GPS, then IP. Menus use lib/places.ts. */

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { FormEvent, KeyboardEvent } from "react";
import { autoLocate, byGPS, loadSavedPlace } from "@/lib/home/location";
import { cityMenu, citiesWithEvents, DISTANCE_OPTIONS, findPlace, milesText } from "@/lib/home/places";
import type { CityOption } from "@/lib/home/places";
import type { Place } from "@/lib/home/types";
import { useHome } from "./HomeState";
import { cx } from "@/components/ui/styles";
import { SearchIcon } from "./icons";
import Logo from "./Logo";

type MenuItem =
  | { kind: "gps" }
  | { kind: "typed"; place: Place & { count: number } }
  | { kind: "city"; city: CityOption }
  | { kind: "any" };

/** `canCreateEvents` is false for platform staff (Super Admin etc.), who never create events themselves. */
export type NavAccount = { href: string; label: string; canCreateEvents?: boolean } | null;

/**
 * `overHero`: the homepage. The nav starts transparent over the hero photos and an ivory background fades in once the
 * hero scrolls away (the text turns red to stay legible). Every other page shows that same ivory nav from the start.
 * The bar (background and yellow strip) runs edge to edge; its content sits on the hero content's gutters
 * (same --pad / 1920px frame as Hero.module.css) in every look.
 */
export default function SiteNav({ account = null, overHero = false }: { account?: NavAccount; overHero?: boolean }) {
  const { upcoming, filters, setFilters, place, applyPlace, searchOpen, setSearchOpen, locInputRef } = useHome();
  const navRef = useRef<HTMLElement>(null);
  const [scrolled, setScrolled] = useState(false);

  // homepage: watch the hero; once its bottom edge passes the nav, the background fades in
  useEffect(() => {
    if (!overHero) return;
    const hero = document.getElementById("hero");
    if (!hero) return;
    let raf = 0;
    const check = () => {
      raf = 0;
      setScrolled(hero.getBoundingClientRect().bottom < 88);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(check);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [overHero]);

  // two looks: transparent over the homepage hero, ivory everywhere else (other pages, and the homepage once it scrolls)
  const look: "clear" | "ivory" = overHero && !scrolled ? "clear" : "ivory";
  const onIvory = look === "ivory";
  const [q, setQ] = useState("");
  const [locText, setLocText] = useState("");
  const [locating, setLocating] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuFilter, setMenuFilter] = useState("");
  const [hl, setHl] = useState(-1);
  const [note, setNote] = useState("");

  // keep the box in sync with the chosen place and the grid's search box (adjusting state while rendering)
  const [seenPlace, setSeenPlace] = useState(place);
  if (seenPlace !== place) {
    setSeenPlace(place);
    setLocText(place ? place.label : "");
  }
  const [seenQ, setSeenQ] = useState(filters.q);
  if (seenQ !== filters.q) {
    setSeenQ(filters.q);
    setQ(filters.q);
  }

  // automatic location on first load (after hydration: the saved place and the lookups live in the browser)
  useEffect(() => {
    let cancelled = false;
    const id = requestAnimationFrame(() => {
      const saved = loadSavedPlace();
      if (saved) {
        applyPlace(saved, { auto: true });
        return;
      }
      setLocating(true);
      autoLocate()
        .then((p) => {
          if (!cancelled && document.activeElement !== locInputRef.current) applyPlace(p, { auto: true });
        })
        .catch(() => {})
        .finally(() => !cancelled && setLocating(false));
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
    };
  }, [applyPlace, locInputRef]);

  // phones: close the search panel when tapping outside the nav
  useEffect(() => {
    if (!searchOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setSearchOpen(false);
    };
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [searchOpen, setSearchOpen]);

  // what the dropdown lists for the text typed so far (see cityMenu in lib/places.ts)
  const menu = useMemo(() => cityMenu(upcoming, menuFilter, place, filters.distance), [upcoming, menuFilter, place, filters.distance]);
  const items: MenuItem[] = useMemo(
    () => [
      { kind: "gps" },
      ...(menu.typed ? [{ kind: "typed" as const, place: menu.typed }] : []),
      ...menu.cities.map((c) => ({ kind: "city" as const, city: c })),
      { kind: "any" },
    ],
    [menu],
  );

  function openMenu(filter: string) {
    setMenuFilter(filter);
    setMenuOpen(true);
    setHl(-1);
  }
  function closeMenu() {
    setMenuOpen(false);
    setNote("");
  }

  function choose(item: MenuItem) {
    if (item.kind === "any") {
      closeMenu();
      applyPlace(null, { remember: true });
    } else if (item.kind === "city" || item.kind === "typed") {
      const c = item.kind === "city" ? item.city : item.place;
      closeMenu();
      applyPlace({ label: c.label, lat: c.lat, lon: c.lon, src: "pick" }, { remember: true, scroll: true });
    } else {
      setLocating(true);
      byGPS()
        .then((p) => {
          closeMenu();
          applyPlace(p, { remember: true, scroll: true });
        })
        .catch(() => {
          setLocText(place ? place.label : "");
          openMenu("");
          setNote("We couldn’t get your location. Check that location access is allowed for this site in your browser, or pick a city below.");
        })
        .finally(() => setLocating(false));
    }
  }

  function onLocKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!menuOpen) openMenu(locText);
      const n = items.length;
      setHl((h) => (h + (e.key === "ArrowDown" ? 1 : -1) + n) % n);
    } else if (e.key === "Enter" && menuOpen && hl >= 0) {
      e.preventDefault();
      choose(items[hl]);
    } else if (e.key === "Escape") {
      closeMenu();
      setLocText(place ? place.label : "");
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    closeMenu();
    const typed = locText.trim();
    if (typed && (!place || typed !== place.label)) {
      const hit = findPlace(typed, citiesWithEvents(upcoming, null));
      if (hit) applyPlace(hit, { remember: true });
    } else if (!typed && place) {
      applyPlace(null, { remember: true });
    }
    setSearchOpen(false);
    // On pages without an event grid (pricing, help...), go to /events with the search.
    // The place was already saved above, so /events picks it up too.
    if (!document.getElementById("events")) {
      window.location.assign(q.trim() ? `/events?q=${encodeURIComponent(q.trim())}` : "/events");
      return;
    }
    setFilters({ q }, { scroll: true });
  }

  const menuBtn = "w-full flex items-center gap-[10px] min-h-[42px] px-3 rounded-xl text-fx-red text-[14px] text-left cursor-pointer hover:bg-fx-ivory";

  return (
    <header
      ref={navRef}
      id="nav"
      data-look={look}
      className={cx(
        // same full-width bar in every look; only the background and text colour change
        "fixed inset-x-0 top-0 z-50 flex h-[84px] items-center pt-1 pb-1 justify-between gap-[18px] border-b-2 px-[max(var(--pad),calc(50%-960px+var(--pad)))] transition-[background-color,border-color,color,box-shadow] duration-500 ease-fx max-[901px]:gap-[10px]",
        look === "clear" && "border-b-transparent bg-transparent text-fx-ivory",
        look === "ivory" && "border-b-fx-yellow bg-fx-ivory text-fx-red shadow-[0_10px_30px_-22px_rgba(168,18,26,.45)]",
      )}
    >
      <Link href="/" className="flex shrink-0 items-center py-2" aria-label="Fattixx home">
        <Logo height={38} priority />
      </Link>

      <form
        id="nsearch"
        role="search"
        autoComplete="off"
        onSubmit={onSubmit}
        className={cx(
          "mr-auto ml-3 flex h-[46px] max-w-[560px] flex-[1_1_520px] items-center rounded-full border pr-1 pl-4 text-fx-red transition-[background-color,border-color,box-shadow] duration-500 ease-fx",
          onIvory ? "border-fx-red/14 bg-white shadow-none" : "border-transparent bg-fx-ivory shadow-[0_8px_24px_-16px_rgba(0,0,0,.5)]",
          // phones: opens as a panel under the nav
          "max-[901px]:absolute max-[901px]:inset-x-0 max-[901px]:top-[calc(100%+10px)] max-[901px]:m-0 max-[901px]:h-auto max-[901px]:max-w-none max-[901px]:flex-col max-[901px]:items-stretch max-[901px]:gap-0 max-[901px]:rounded-[22px] max-[901px]:p-2 max-[901px]:shadow-[0_24px_50px_-20px_rgba(78,7,11,.6)]",
          searchOpen ? "max-[901px]:flex" : "max-[901px]:hidden",
        )}
      >
        <label className="flex min-w-0 flex-[1.25_1_0] cursor-text items-center gap-[10px] max-[901px]:h-12 max-[901px]:flex-none max-[901px]:px-3">
          <span className="shrink-0 text-fx-red opacity-75">
            <SearchIcon size={18} stroke={2.2} />
          </span>
          <span className="sr-only">Search events</span>
          <input
            id="ns-q"
            type="search"
            placeholder="Search events"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-full min-w-0 border-0 bg-transparent p-0 text-[15px] text-fx-ink outline-none placeholder:text-fx-red/55"
          />
        </label>
        <span aria-hidden="true" className="mx-[14px] h-6 w-px shrink-0 bg-fx-red/18 max-[901px]:mx-3 max-[901px]:h-px max-[901px]:w-auto" />
        <div className="relative flex min-w-0 flex-[1_1_0] items-center gap-2 max-[901px]:h-12 max-[901px]:flex-none max-[901px]:px-3">
          <svg width="16" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={cx("shrink-0 text-fx-red opacity-75", locating && "animate-locpulse")}>
            <path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" />
          </svg>
          <label className="sr-only" htmlFor="ns-loc">
            Location
          </label>
          <input
            id="ns-loc"
            ref={locInputRef}
            type="text"
            placeholder={locating ? "Finding your location" : "Anywhere"}
            role="combobox"
            aria-expanded={menuOpen}
            aria-controls="ns-menu"
            aria-autocomplete="list"
            value={locating ? "" : locText}
            onChange={(e) => {
              setLocText(e.target.value);
              openMenu(e.target.value);
            }}
            onFocus={(e) => {
              e.target.select();
              openMenu("");
            }}
            onBlur={() =>
              setTimeout(() => {
                closeMenu();
                if (document.activeElement !== locInputRef.current) setLocText(place ? place.label : "");
              }, 120)
            }
            onKeyDown={onLocKey}
            className="w-full min-w-0 border-0 bg-transparent p-0 text-[15px] font-semibold text-ellipsis text-fx-ink outline-none placeholder:text-fx-red/55"
          />
          <div
            id="ns-menu"
            role="listbox"
            hidden={!menuOpen}
            onMouseDown={(e) => e.preventDefault() /* keep focus in the box */}
            className="absolute top-[calc(100%+14px)] -left-3 z-[60] max-h-[340px] w-[290px] overflow-y-auto rounded-[18px] bg-white p-2 text-fx-red shadow-[0_24px_50px_-20px_rgba(78,7,11,.55),0_0_0_1px_rgba(168,18,26,.08)] max-[901px]:top-[calc(100%+4px)] max-[901px]:right-0 max-[901px]:left-0 max-[901px]:w-auto"
          >
            {(note || menu.note) && <div className="px-3 py-2 text-[13px] leading-[1.45] text-fx-red/78">{note || menu.note}</div>}
            {items.map((it, i) => {
              const hlCls = i === hl ? " bg-fx-ivory" : "";
              if (it.kind === "gps")
                return (
                  <button key="gps" type="button" className={menuBtn + " font-bold" + hlCls} onClick={() => choose(it)}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="4" />
                      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
                    </svg>
                    Use my current location
                  </button>
                );
              if (it.kind === "any")
                return (
                  <Fragment key="any">
                    <div className="mx-1 my-[6px] h-px bg-fx-red/10" />
                    <button type="button" className={menuBtn + " font-medium" + hlCls} onClick={() => choose(it)}>
                      Anywhere
                    </button>
                  </Fragment>
                );
              if (it.kind === "typed")
                return (
                  <button key="typed" type="button" className={menuBtn + " font-medium" + hlCls} onClick={() => choose(it)}>
                    {it.place.label}
                    <small className="ml-auto text-right text-[12px] text-fx-red/78">
                      {it.place.count} {it.place.count === 1 ? "event" : "events"} within {filters.distance} mi
                    </small>
                  </button>
                );
              return (
                <button key={it.city.label} type="button" className={menuBtn + " font-medium" + hlCls} onClick={() => choose(it)}>
                  <span className="min-w-0">
                    {it.city.label}
                    {it.city.distance != null && <span className="block text-[12px] font-normal text-fx-red/78">{milesText(it.city.distance)}</span>}
                  </span>
                  <small className="ml-auto shrink-0 text-[12px] text-fx-red/78">
                    {it.city.count} {it.city.count === 1 ? "event" : "events"}
                  </small>
                </button>
              );
            })}

            <div className="mx-1 my-[6px] h-px bg-fx-red/10" />
            <div className="flex items-center gap-1 px-2 pt-1 pb-[2px]" role="group" aria-label="Distance">
              <span className="mr-1 text-[12px] font-semibold text-fx-red/78">Within</span>
              {DISTANCE_OPTIONS.map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={filters.distance === d}
                  onClick={() => setFilters({ distance: d })}
                  className="min-h-9 cursor-pointer rounded-full px-[10px] text-[12px] font-semibold whitespace-nowrap text-fx-red hover:bg-fx-ivory aria-pressed:bg-fx-red aria-pressed:text-fx-ivory"
                >
                  {d} mi
                </button>
              ))}
            </div>
          </div>
        </div>
        <button
          type="submit"
          aria-label="Search"
          className="ml-2 flex h-[38px] w-[38px] shrink-0 cursor-pointer items-center justify-center rounded-full bg-fx-red text-fx-ivory transition-transform duration-[250ms] ease-spring hover:scale-106 max-[901px]:mt-[6px] max-[901px]:ml-0 max-[901px]:h-[46px] max-[901px]:w-auto max-[901px]:gap-2 max-[901px]:rounded-2xl max-[901px]:text-[15px] max-[901px]:font-semibold"
        >
          <SearchIcon size={18} stroke={2.6} />
          <span className="hidden max-[901px]:inline">Search</span>
        </button>
      </form>

      <nav aria-label="Main" className={cx("mr-[10px] flex gap-[26px] text-[15px] whitespace-nowrap max-[1101px]:hidden", onIvory ? "text-fx-red/78" : "text-fx-ivory/90")}>
        <Link href="/events" className={onIvory ? "hover:text-fx-red" : "hover:text-fx-ivory"}>
          Browse events
        </Link>
        <Link href="/pricing" className={onIvory ? "hover:text-fx-red" : "hover:text-fx-ivory"}>
          Pricing
        </Link>
      </nav>

      <div className="flex items-center gap-1 max-[901px]:gap-2">
        <button
          type="button"
          aria-label="Open search"
          aria-expanded={searchOpen}
          aria-controls="nsearch"
          onClick={(e) => {
            e.stopPropagation();
            setSearchOpen(!searchOpen);
            if (!searchOpen) setTimeout(() => document.getElementById("ns-q")?.focus(), 0);
          }}
          className={cx("hidden h-11 w-11 cursor-pointer items-center justify-center rounded-full transition-colors duration-500 max-[901px]:flex", onIvory ? "bg-fx-red/10 text-fx-red" : "bg-fx-ivory/12 text-fx-ivory")}
        >
          <SearchIcon size={20} stroke={2.2} />
        </button>
        <a href={account?.href ?? "/login"} className="px-4 py-[10px] text-[15px] font-medium max-[721px]:px-2 max-[721px]:text-[14px]">
          {account?.label ?? "Log in"}
        </a>

        {account?.canCreateEvents !== false && (
          <a href="/create" className="rounded-full bg-fx-yellow px-5 py-[11px] text-[15px] font-semibold whitespace-nowrap text-fx-red max-[901px]:px-4 max-[721px]:px-3 max-[721px]:py-[9px] max-[721px]:text-[14px]">
            <span className="max-[421px]:hidden">Create event</span>
            <span className="hidden max-[421px]:inline">Create</span>
          </a>
        )}
      </div>
    </header>
  );
}
