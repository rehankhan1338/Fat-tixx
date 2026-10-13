/* Data for an organizer's page (/o/<organization slug>): the organizer and their public events, split into upcoming and past. */

import type { ListedEvent } from "./events";
import type { Organizer } from "./types";

export type OrganizerPageData = {
  organizer: Organizer;
  /** soonest first */
  upcoming: ListedEvent[];
  /** most recent first */
  past: ListedEvent[];
  /** cities of the upcoming events, most events first */
  cities: string[];
};

/** Cities of the given events, most events first */
export function citiesOf(events: ListedEvent[]): string[] {
  const count = new Map<string, number>();
  for (const e of events) if (e.city) count.set(e.city, (count.get(e.city) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
}
