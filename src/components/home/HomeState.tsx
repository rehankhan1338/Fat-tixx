"use client";

/*
 * Shared state for the homepage: the event list, the filters and the visitor's place.
 * The nav search, category pills, featured strip and event grid all read/write this.
 *
 * In production, replace `events` (passed in from page.tsx) with data from the API and move
 * filtering to the server once the event count grows (see README "Wiring the data").
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { imageUrl, isNear, listUpcoming, PAGE_SIZE, startOfToday } from "@/lib/home/events";
import type { ListedEvent } from "@/lib/home/events";
import { savePlace } from "@/lib/home/location";
import type { EventItem, Filters, Place } from "@/lib/home/types";

type PlaceOpts = { auto?: boolean; remember?: boolean; scroll?: boolean };

type HomeCtx = {
  today: Date | null;
  upcoming: ListedEvent[];
  featured: ListedEvent[];
  filters: Filters;
  setFilters: (patch: Partial<Filters>, opts?: { scroll?: boolean }) => void;
  showMore: () => void;
  clearAll: () => void;
  place: Place | null;
  applyPlace: (p: Place | null, opts?: PlaceOpts) => void;
  clearPlace: () => void;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  locInputRef: RefObject<HTMLInputElement | null>;
  focusLocation: () => void;
  reduceMotion: boolean;
};

const Ctx = createContext<HomeCtx | null>(null);

export function useHome(): HomeCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useHome must be used inside <HomeState>");
  return c;
}

const EMPTY: Filters = { q: "", city: "", when: "", free: false, cat: "", org: "", near: null, shown: PAGE_SIZE };

function scrollToEvents(reduce: boolean) {
  requestAnimationFrame(() => {
    document.getElementById("events")?.scrollIntoView({ behavior: reduce ? "auto" : "smooth" });
  });
}

export default function HomeState({ events, children }: { events: EventItem[]; children: ReactNode }) {
  const [today, setToday] = useState<Date | null>(null);
  const [filters, setF] = useState<Filters>(EMPTY);
  const [place, setPlace] = useState<Place | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [reduceMotion, setReduce] = useState(false);
  const locInputRef = useRef<HTMLInputElement | null>(null);

  // Dates depend on the visitor's clock, so they are applied after hydration.
  useEffect(() => {
    // Applied after hydration (the server does not know the visitor's clock, settings or URL).
    const id = requestAnimationFrame(() => {
    setToday(startOfToday());
    setReduce(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    // Deep links from the footer and elsewhere: /?when=weekend, /?free=1, /?cat=Music, /?q=jazz
    const sp = new URLSearchParams(window.location.search);
    const when = sp.get("when");
    const patch: Partial<Filters> = {};
    if (when === "weekend" || when === "7" || when === "30") patch.when = when;
    if (sp.get("free") === "1") patch.free = true;
    if (sp.get("cat")) patch.cat = sp.get("cat")!.slice(0, 40);
    if (sp.get("q")) patch.q = sp.get("q")!.slice(0, 100);
    if (Object.keys(patch).length) setF((f) => ({ ...f, ...patch }));
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const upcoming = useMemo(() => listUpcoming(events, today), [events, today]);
  const featured = useMemo(() => {
    // Real events need their own photo here (sample events use the design's placeholder photos).
    const withPhoto = upcoming.filter((e) => !e.href || imageUrl(e));
    const f = withPhoto.filter((e) => e.featured);
    return f.length >= 4 ? f : withPhoto.slice(0, 8);
  }, [upcoming]);

  const upcomingRef = useRef(upcoming);
  useEffect(() => {
    upcomingRef.current = upcoming;
  }, [upcoming]);

  const setFilters = useCallback(
    (patch: Partial<Filters>, opts?: { scroll?: boolean }) => {
      setF((f) => ({ ...f, ...patch, shown: PAGE_SIZE }));
      if (opts?.scroll) scrollToEvents(reduceMotion);
    },
    [reduceMotion],
  );

  const showMore = useCallback(() => setF((f) => ({ ...f, shown: f.shown + PAGE_SIZE })), []);

  /* Pick a place. auto = found by the page itself: it only filters when there are events nearby. */
  const applyPlace = useCallback(
    (p: Place | null, opts: PlaceOpts = {}) => {
      setPlace(p);
      if (opts.remember) savePlace(p);
      if (!p) {
        setFilters({ near: null });
        return;
      }
      if (opts.auto && !upcomingRef.current.some((e) => isNear(e, p))) return;
      setFilters({ near: { label: p.label, lat: p.lat, lon: p.lon } }, { scroll: opts.scroll });
    },
    [setFilters],
  );

  const clearPlace = useCallback(() => {
    setPlace(null);
    savePlace(null);
    setFilters({ near: null });
  }, [setFilters]);

  const clearAll = useCallback(() => {
    setPlace(null);
    savePlace(null);
    setF(EMPTY);
  }, []);

  const focusLocation = useCallback(() => {
    if (window.matchMedia("(max-width: 900px)").matches) setSearchOpen(true);
    setTimeout(() => locInputRef.current?.focus(), 0);
  }, []);

  const value: HomeCtx = {
    today,
    upcoming,
    featured,
    filters,
    setFilters,
    showMore,
    clearAll,
    place,
    applyPlace,
    clearPlace,
    searchOpen,
    setSearchOpen,
    locInputRef,
    focusLocation,
    reduceMotion,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
