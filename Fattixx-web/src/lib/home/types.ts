/* Shapes the public pages expect. src/lib/home/data.ts maps database rows to these. */

export type SocialNetwork = "instagram" | "tiktok" | "facebook" | "x" | "youtube";

export type Organizer = {
  /** organization slug, used in /o/<id> */
  id: string;
  name: string;
  initials: string;
  /** on Fattixx Pro: shows the Pro check next to the organizer's name (no plan exists yet, always false) */
  pro?: boolean;
  /** logo image URL; events without their own image show this */
  logo?: string | null;
  /** the organization's description, shown on its page */
  bio?: string | null;
  website?: string | null;
  social?: Partial<Record<SocialNetwork, string>>;
  /** public events on Fattixx, upcoming and past */
  eventCount?: number;
};

export type EventItem = {
  id: number;
  /** organization slug */
  organizerId: string;
  organizerName: string;
  organizerInitials: string;
  organizerLogo?: string | null;
  organizerPro?: boolean;
  title: string;
  category: string; // should match a Category name to be filterable by the pills
  date: string; // YYYY-MM-DD, local to the venue
  time: string; // HH:MM, 24h
  venue: string;
  city: string; // "City, ST"
  lat?: number | null; // venue position for "near you"
  lon?: number | null;
  price: number | null; // lowest all-in ticket price in dollars (FTC rule); null = free
  featured: boolean; // shows in the featured carousels
  tag?: string; // short badge, e.g. "Selling fast"
  image?: string | null; // the event's own image URL; without one, the organizer's logo is shown
  /** the event page (private events carry their key) */
  href: string;
};

export type { Category } from "../event-categories";

export type CityCoords = { lat: number; lon: number };

/* A place picked in the nav location box, or found automatically */
export type Place = CityCoords & { label: string; src?: "ip" | "gps" | "pick" };

/* "" any date, "0" today, "weekend", or the next 7 / 30 days */
export type WhenFilter = "" | "0" | "weekend" | "7" | "30";

/* "" any price, "free", "u25" $25 and under, "25to50", "o50" over $50 (lowest ticket price) */
export type PriceFilter = "" | "free" | "u25" | "25to50" | "o50";

export type Filters = {
  q: string;
  city: string;
  when: WhenFilter;
  price: PriceFilter;
  cat: string;
  org: string;
  near: Place | null;
  distance: number; // miles around `near` (see DISTANCE_OPTIONS in places.ts)
  shown: number;
};
