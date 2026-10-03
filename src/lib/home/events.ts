import { CITY_COORDS, ORGANIZERS } from "./sample-events";
import type { CityCoords, EventItem, Filters, Place } from "./types";

export const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const NEAR_MILES = 75;
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
  return e.organizerName ?? ORGANIZERS[e.organizerId]?.name ?? "";
}

export function organizerInitials(e: EventItem): string {
  return e.organizerInitials ?? ORGANIZERS[e.organizerId]?.initials ?? "";
}

/** Map position of an event: its venue, else the known city. */
export function coordsOf(e: EventItem): CityCoords | null {
  if (e.lat != null && e.lon != null) return { lat: e.lat, lon: e.lon };
  return CITY_COORDS[e.city] ?? null;
}

/** Cities that can be picked in the nav location menu: every event city with a known position. */
export function knownCities(events: EventItem[]): Record<string, CityCoords> {
  const out: Record<string, CityCoords> = {};
  for (const e of events) {
    const c = coordsOf(e);
    if (c && !out[e.city]) out[e.city] = c;
  }
  return out;
}

/** Real image URL for an event, or null when it only has a placeholder key. */
export function imageUrl(e: EventItem): string | null {
  return e.image && /^(\/|https?:)/.test(e.image) ? e.image : null;
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
  let list = today ? all.filter((e) => e.dt >= today) : all;
  if (!list.length) list = all; // keeps the preview populated if every sample date has passed
  list.sort((a, b) => a.dt.getTime() - b.dt.getTime());
  list.forEach((e, i) => (e.v = i % 6)); // rotate poster styles so neighbours differ
  return list;
}

export function miles(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 3959;
  const r = Math.PI / 180;
  const dLa = (b.lat - a.lat) * r;
  const dLo = (b.lon - a.lon) * r;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function isNear(e: EventItem, near: Place): boolean {
  const c = coordsOf(e);
  return !!c && miles(near, c) <= NEAR_MILES;
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

/* Client-side filtering for the preview. In production this becomes a query to the events API. */
export function matches(e: ListedEvent, f: Filters, today: Date | null): boolean {
  const q = f.q.trim().toLowerCase();
  if (q && `${e.title} ${organizerName(e)} ${e.venue} ${e.city} ${e.category}`.toLowerCase().indexOf(q) < 0) return false;
  if (f.city && e.city !== f.city) return false;
  if (f.near && !isNear(e, f.near)) return false;
  if (f.free && e.price != null) return false;
  if (f.cat && e.category !== f.cat) return false;
  if (f.org && e.organizerId !== f.org) return false;
  return inWindow(e, f.when, today);
}

/* Placeholder photo for the featured strip: the event's own, else one per category */
const CAT_IMG: Record<string, string> = {
  Music: "fest",
  Nightlife: "club",
  Fundraisers: "gala",
  Education: "conf",
  "Beauty & hair": "conf",
  Community: "fest",
  "Food & drink": "party",
  Comedy: "club",
  Fitness: "fest",
};
export function photoKey(e: EventItem): string {
  return (e.image && !imageUrl(e) ? e.image : null) || CAT_IMG[e.category] || "gala";
}
