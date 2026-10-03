"use client";

/*
 * Floating nav with the event search and a location box that fills in automatically:
 *   1. a place the visitor picked before (saved in this browser), else
 *   2. their precise location if they already allowed it for this site, else
 *   3. an approximate city from their IP (no permission prompt).
 * If there are events within 75 miles of that place, the event list is filtered to them.
 * On phones (<= 900px) the search opens as a panel under the nav.
 */

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { FormEvent, KeyboardEvent } from "react";
import { autoLocate, byGPS, loadSavedPlace } from "@/lib/home/location";
import { knownCities } from "@/lib/home/events";
import { useHome } from "./HomeState";
import { cx } from "@/components/home/styles";
import { LogoMark, SearchIcon } from "./icons";

type MenuItem =
  | { kind: "gps" }
  | { kind: "any" }
  | { kind: "city"; city: string; count: number };

export type NavAccount = { href: string; label: string } | null;

export default function SiteNav({ account, createHref }: { account: NavAccount; createHref: string }) {
  const { upcoming, filters, setFilters, place, applyPlace, searchOpen, setSearchOpen, locInputRef } = useHome();
  const navRef = useRef<HTMLElement>(null);
  const [q, setQ] = useState("");
  const [locText, setLocText] = useState("");
  const [locating, setLocating] = useState(true); // until the saved / automatic place is known
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

  // automatic location on first load
  useEffect(() => {
    const saved = loadSavedPlace();
    let cancelled = false;
    (saved ? Promise.resolve(saved) : autoLocate())
      .then((p) => {
        if (!cancelled && (saved || document.activeElement !== locInputRef.current)) applyPlace(p, { auto: true });
      })
      .catch(() => {})
      .finally(() => !cancelled && setLocating(false));
    return () => {
      cancelled = true;
    };
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // phones: close the search panel when tapping outside the nav
  useEffect(() => {
    if (!searchOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setSearchOpen(false);
    };
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [searchOpen, setSearchOpen]);

  const CITY_COORDS = useMemo(() => knownCities(upcoming), [upcoming]);
  const known = useMemo(() => Object.keys(CITY_COORDS).sort(), [CITY_COORDS]);
  const items: MenuItem[] = useMemo(() => {
    const f = menuFilter.trim().toLowerCase();
    const cities = known
      .filter((c) => !f || c.toLowerCase().includes(f))
      .map((c) => ({ kind: "city" as const, city: c, count: upcoming.filter((e) => e.city === c).length }));
    return [{ kind: "gps" }, { kind: "any" }, ...cities];
  }, [menuFilter, known, upcoming]);
  const cityCount = items.length - 2;

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
    } else if (item.kind === "city") {
      const k = CITY_COORDS[item.city];
      closeMenu();
      applyPlace({ label: item.city, lat: k.lat, lon: k.lon, src: "pick" }, { remember: true, scroll: true });
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
      const hit = known.find((c) => c.toLowerCase().includes(typed.toLowerCase()));
      if (hit) applyPlace({ label: hit, lat: CITY_COORDS[hit].lat, lon: CITY_COORDS[hit].lon, src: "pick" }, { remember: true });
    } else if (!typed && place) {
      applyPlace(null, { remember: true });
    }
    setFilters({ q }, { scroll: true });
    setSearchOpen(false);
  }

  const menuBtn = "w-full flex items-center gap-[10px] min-h-[42px] px-3 rounded-xl text-fx-red text-[14px] text-left cursor-pointer hover:bg-fx-ivory";

  return (
    <header
      ref={navRef}
      id="nav"
      className="fixed top-4 left-[clamp(12px,3vw,40px)] right-[clamp(12px,3vw,40px)] z-50 flex h-16 items-center justify-between gap-[18px] rounded-full border border-fx-ivory/12 bg-fx-red/86 pr-[10px] pl-[22px] text-fx-ivory backdrop-blur-[16px] backdrop-saturate-[1.4] max-[901px]:gap-[10px] max-[901px]:pl-[18px]"
    >
      <Link href="/" className="flex items-center gap-[10px] font-display text-[20px] font-extrabold" aria-label="Fattixx home">
        <LogoMark />
        <span>FATTIXX</span>
      </Link>

      <form
        id="nsearch"
        role="search"
        autoComplete="off"
        onSubmit={onSubmit}
        className={cx(
          "mr-auto ml-3 flex h-[46px] max-w-[560px] flex-[1_1_520px] items-center rounded-full bg-fx-ivory pr-1 pl-4 text-fx-red shadow-[0_8px_24px_-16px_rgba(0,0,0,.5)]",
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
            {note && <div className="px-3 py-2 text-[13px] leading-[1.45] text-fx-red/75">{note}</div>}
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
                    <button type="button" className={menuBtn + " font-medium" + hlCls} onClick={() => choose(it)}>
                      Anywhere
                    </button>
                    <div className="mx-1 my-[6px] h-px bg-fx-red/10" />
                  </Fragment>
                );
              return (
                <button key={it.city} type="button" className={menuBtn + " font-medium" + hlCls} onClick={() => choose(it)}>
                  {it.city}
                  <small className="ml-auto text-[12px] text-fx-red/60">
                    {it.count} {it.count === 1 ? "event" : "events"}
                  </small>
                </button>
              );
            })}
            {cityCount === 0 && <div className="px-3 py-2 text-[13px] leading-[1.45] text-fx-red/75">No events in that city yet. Try another city or search anywhere.</div>}
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

      <nav aria-label="Main" className="mr-[10px] flex gap-[26px] text-[15px] whitespace-nowrap text-fx-ivory/80 max-[1181px]:hidden">
        <a href="#events" className="hover:text-fx-ivory">
          Browse events
        </a>
        <a href="#host" className="hover:text-fx-ivory">
          Host an event
        </a>
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
          className="hidden h-11 w-11 cursor-pointer items-center justify-center rounded-full bg-fx-ivory/12 text-fx-ivory max-[901px]:flex"
        >
          <SearchIcon size={20} stroke={2.2} />
        </button>
        <a href={account?.href ?? "/login"} className="px-4 py-[10px] text-[15px] font-medium max-[721px]:hidden">
          {account?.label ?? "Log in"}
        </a>
        <a href={createHref} className="rounded-full bg-fx-yellow px-5 py-[11px] text-[15px] font-semibold whitespace-nowrap text-fx-red max-[901px]:px-4">
          Create event
        </a>
      </div>
    </header>
  );
}
