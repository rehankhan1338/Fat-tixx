"use client";

/* Shared event filters, location and navigation state for public pages. */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { isNear, listUpcoming, PAGE_SIZE, startOfToday } from "@/lib/home/events";
import type { ListedEvent } from "@/lib/home/events";
import { savePlace } from "@/lib/home/location";
import { DEFAULT_DISTANCE } from "@/lib/home/places";
import type { Category, EventItem, Filters, Place, PriceFilter, WhenFilter } from "@/lib/home/types";

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
  /** the event categories (Super Admin → Website → Categories), for the pills and filters */
  categories: Category[];
};

const Ctx = createContext<HomeCtx | null>(null);

export function useHome(): HomeCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useHome must be used inside <HomeState>");
  return c;
}

const EMPTY: Filters = { q: "", city: "", when: "", price: "", cat: "", org: "", near: null, distance: DEFAULT_DISTANCE, shown: PAGE_SIZE };
const WHENS: WhenFilter[] = ["0", "weekend", "7", "30"];
const PRICES: PriceFilter[] = ["free", "u25", "25to50", "o50"];

function scrollToEvents(reduce: boolean) {
  requestAnimationFrame(() => {
    document.getElementById("events")?.scrollIntoView({ behavior: reduce ? "auto" : "smooth" });
  });
}

export default function HomeState({ events, categories, children }: { events: EventItem[]; categories: Category[]; children: ReactNode }) {
  const [today, setToday] = useState<Date | null>(null);
  const [filters, setF] = useState<Filters>(EMPTY);
  const [place, setPlace] = useState<Place | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [reduceMotion, setReduce] = useState(false);
  const locInputRef = useRef<HTMLInputElement | null>(null);
  const manuallyPickedPlace = useRef(false);

  // Dates depend on the visitor's clock, so they are applied after hydration.
  useEffect(() => {
    // applied after hydration (the server does not know the visitor's clock, settings or URL)
    const id = requestAnimationFrame(() => {
    setToday(startOfToday());
    setReduce(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    // filters can arrive in the link: ?q= (a search sent from another page's nav), ?when=, ?price=, ?cat=
    // (the footer links to /events?when=weekend and /events?price=free)
    const u = new URLSearchParams(window.location.search);
    const patch: Partial<Filters> = {};
    const q = u.get("q");
    const when = u.get("when") === "today" ? "0" : (u.get("when") as WhenFilter);
    const price = u.get("price") as PriceFilter;
    if (q) patch.q = q;
    if (WHENS.includes(when)) patch.when = when;
    if (PRICES.includes(price)) patch.price = price;
    if (u.get("cat")) patch.cat = u.get("cat") as string;
    if (Object.keys(patch).length) setF((f) => ({ ...f, ...patch }));
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const upcoming = useMemo(() => listUpcoming(events, today), [events, today]);
  const featured = useMemo(() => {
    const f = upcoming.filter((e) => e.featured);
    return f.length >= 4 ? f : upcoming.slice(0, 8);
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
      if (opts.auto && manuallyPickedPlace.current) return;
      if (!opts.auto) manuallyPickedPlace.current = true;
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
    manuallyPickedPlace.current = true;
    setPlace(null);
    savePlace(null);
    setFilters({ near: null });
  }, [setFilters]);

  const clearAll = useCallback(() => {
    manuallyPickedPlace.current = true;
    setPlace(null);
    savePlace(null);
    setF((f) => ({ ...EMPTY, distance: f.distance }));
  }, []);

  const focusLocation = useCallback(() => {
    if (window.matchMedia("(max-width: 900px)").matches) setSearchOpen(true);
    setTimeout(() => locInputRef.current?.focus(), 0);
  }, []);

  const value: HomeCtx = {
    categories,
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
