import { DEFAULT_DISTANCE, isWithin } from "./places";
import type { EventItem, Filters, Place, PriceFilter } from "./types";

export const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const PAGE_SIZE = 12;

/* An event with its parsed start time and a poster style index (0-5) */
export type ListedEvent = EventItem & { dt: Date; v: number };

export function parseStart(e: EventItem): Date {
  const [y, m, d] = e.date.split("-").map(Number);
  const [h, mi] = e.time.split(":").map(Number);
  return new Date(y, m - 1, d, h, mi);
}

export function clock(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  return (h % 12 || 12) + (m ? ":" + String(m).padStart(2, "0") : "") + (h < 12 ? " AM" : " PM");
}

/* "Sat, Oct 10, 8 PM" */
export function whenText(d: Date): string {
  return `${DOW[d.getDay()]}, ${MON[d.getMonth()]} ${d.getDate()}, ${clock(d)}`;
}

/** "$25" or "$29.62" */
export function money(p: number): string {
  return "$" + (Number.isInteger(p) ? String(p) : p.toFixed(2));
}

export function priceText(e: EventItem): string {
  return e.price == null ? "Free" : "From " + money(e.price);
}

export function organizerName(e: EventItem): string {
  return e.organizerName;
}

export function startOfToday(): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

/*
 * Upcoming events, soonest first. `today` is null during server render and the first client render
 * (so both match and React can hydrate); the client then passes the real date and past events drop off.
 */
export function listUpcoming(events: EventItem[], today: Date | null): ListedEvent[] {
  const all = events.map((e) => ({ ...e, dt: parseStart(e), v: 0 }));
  const list = today ? all.filter((e) => e.dt >= today) : all;
  list.sort((a, b) => a.dt.getTime() - b.dt.getTime());
  list.forEach((e, i) => (e.v = i % 6)); // rotate poster styles so neighbours differ
  return list;
}

/* Is the event within `distance` miles of the place? (see places.ts) */
export function isNear(e: EventItem, near: Place, distance = DEFAULT_DISTANCE): boolean {
  return isWithin(e, near, distance);
}

/* Lowest ticket price against the price filter */
export function priceMatches(e: EventItem, price: PriceFilter): boolean {
  const p = e.price;
  if (price === "free") return p == null;
  if (price === "u25") return p != null && p <= 25;
  if (price === "25to50") return p != null && p > 25 && p <= 50;
  if (price === "o50") return p != null && p > 50;
  return true;
}

function inWindow(e: ListedEvent, when: Filters["when"], today: Date | null): boolean {
  if (!when || !today) return true;
  if (when === "weekend") {
    const day = today.getDay();
    const back = ({ 5: 0, 6: 1, 0: 2 } as Record<number, number>)[day];
    const fri = new Date(today);
    fri.setDate(today.getDate() + (back === undefined ? 5 - day : -back));
    const mon = new Date(fri);
    mon.setDate(fri.getDate() + 3);
    return e.dt >= fri && e.dt < mon;
  }
  const end = new Date(today);
  end.setDate(today.getDate() + Number(when) + 1);
  return e.dt >= today && e.dt < end;
}

/* Does the event match every filter? Filtering runs in the browser over the published events list. */
export function matches(e: ListedEvent, f: Filters, today: Date | null): boolean {
  const q = f.q.trim().toLowerCase();
  if (q && `${e.title} ${organizerName(e)} ${e.venue} ${e.city} ${e.category}`.toLowerCase().indexOf(q) < 0) return false;
  if (f.city && e.city !== f.city) return false;
  if (f.near && !isNear(e, f.near, f.distance)) return false;
  if (!priceMatches(e, f.price)) return false;
  if (f.cat && e.category !== f.cat) return false;
  if (f.org && e.organizerId !== f.org) return false;
  return inWindow(e, f.when, today);
}

/* Prefer the event image, then organizer logo; null enables CSS fallback art. */
export type EventArtInfo = { kind: "image" | "logo"; src: string; alt: string };
export function eventArt(e: EventItem): EventArtInfo | null {
  if (e.image) return { kind: "image", src: e.image, alt: e.title };
  if (e.organizerLogo) return { kind: "logo", src: e.organizerLogo, alt: e.organizerName + " logo" };
  return null;
}

/* "From $40 at The Warehouse" / "Free at Riverside Park" */
export function priceAtVenue(e: EventItem): string {
  return `${priceText(e)} at ${e.venue}`;
}

/* Is the organizer on Fattixx Pro? (shows the Pro check next to their name) */
export function isPro(e: Pick<EventItem, "organizerPro">): boolean {
  return !!e.organizerPro;
}

/* The organizer's page: /o/<organization slug> */
export function organizerHref(organizerId: string): string {
  return `/o/${organizerId}`;
}

/* The event's own page */
export function eventHref(e: EventItem): string {
  return e.href;
}
