/* Location filters use the venue coordinates stored with each event. Distances are in miles. */

import type { CityCoords, EventItem, Place } from "./types";

export const DISTANCE_OPTIONS = [10, 25, 50, 100];
export const DEFAULT_DISTANCE = 50;
export const CITY_LIST_LIMIT = 8;

/** A city in the list: its name, map position, number of upcoming events and distance from the visitor */
export type CityOption = Place & { count: number; distance: number | null };

/** What a location menu shows for the text typed so far */
export type CityMenu = {
  /** the typed place itself, when it isn't a listed city but has events within the chosen distance */
  typed: (Place & { count: number }) | null;
  cities: CityOption[];
  /** a short message, e.g. "No events in Columbia, SC yet…" */
  note: string;
};

export function miles(a: CityCoords, b: CityCoords): number {
  const R = 3959;
  const r = Math.PI / 180;
  const dLa = (b.lat - a.lat) * r;
  const dLo = (b.lon - a.lon) * r;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** The venue's map position, when the organizer entered one for the venue. */
export function eventPosition(e: EventItem): CityCoords | null {
  if (typeof e.lat === "number" && typeof e.lon === "number") return { lat: e.lat, lon: e.lon };
  return null;
}

/** Is the event within `distance` miles of the place? */
export function isWithin(e: EventItem, place: CityCoords, distance = DEFAULT_DISTANCE): boolean {
  const p = eventPosition(e);
  return !!p && miles(place, p) <= distance;
}

/** Group by city; sort by distance when available, otherwise event count. Cities without a known position are listed last. */
export function citiesWithEvents(events: EventItem[], from: CityCoords | null): CityOption[] {
  const byCity = new Map<string, CityOption>();
  for (const e of events) {
    if (!e.city) continue;
    const pos = eventPosition(e);
    const c = byCity.get(e.city);
    if (c) {
      c.count++;
      if (pos && c.lat === 0 && c.lon === 0) Object.assign(c, { lat: pos.lat, lon: pos.lon });
    } else byCity.set(e.city, { label: e.city, lat: pos?.lat ?? 0, lon: pos?.lon ?? 0, src: "pick", count: 1, distance: null });
  }
  const list = Array.from(byCity.values());
  list.forEach((c) => (c.distance = from && (c.lat || c.lon) ? miles(from, c) : null));
  return list.sort((a, b) =>
    from ? (a.distance ?? Infinity) - (b.distance ?? Infinity) : b.count - a.count || a.label.localeCompare(b.label),
  );
}

/** A city from the list whose name starts with the text. */
export function findPlace(text: string, cities: CityOption[] = []): Place | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  const hit = cities.find((c) => c.label.toLowerCase().startsWith(t));
  return hit ? { label: hit.label, lat: hit.lat, lon: hit.lon, src: "pick" } : null;
}

/** "about 95 mi" */
export function milesText(d: number | null): string {
  return d == null ? "" : d < 1 ? "under 1 mi" : `about ${Math.round(d)} mi`;
}

/** Resolve typed cities or suggest nearby cities with events. */
export function cityMenu(events: EventItem[], text: string, from: CityCoords | null, distance = DEFAULT_DISTANCE): CityMenu {
  const all = citiesWithEvents(events, from);
  const t = text.trim();
  if (!t) return { typed: null, cities: all.slice(0, CITY_LIST_LIMIT), note: "" };

  const hits = all.filter((c) => c.label.toLowerCase().includes(t.toLowerCase()));
  if (hits.length) return { typed: null, cities: hits.slice(0, CITY_LIST_LIMIT), note: "" };

  const place = findPlace(t, all);
  if (!place) {
    return { typed: null, cities: all.slice(0, CITY_LIST_LIMIT), note: `We couldn’t find “${t}”. Check the spelling or pick a city below.` };
  }
  const count = events.filter((e) => isWithin(e, place, distance)).length;
  const nearest = citiesWithEvents(events, place);
  if (count) return { typed: { ...place, count }, cities: nearest.slice(0, 3), note: "" };
  const n = nearest[0];
  return {
    typed: null,
    cities: nearest.slice(0, 3),
    note: n ? `No events in ${place.label} yet. The nearest are in ${n.label}, ${milesText(n.distance)} away.` : `No events in ${place.label} yet.`,
  };
}
