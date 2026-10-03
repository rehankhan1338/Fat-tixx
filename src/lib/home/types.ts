/* Shapes the homepage expects. Map your API / MySQL rows to these. */

export type Organizer = {
  id: string;
  name: string;
  initials: string; // shown in the small avatar until organizers have logos
};

export type EventItem = {
  id: number;
  organizerId: string;
  organizerName?: string; // real events carry their organizer; samples look it up in ORGANIZERS
  organizerInitials?: string;
  title: string;
  category: string; // should match a Category name to be filterable by the pills
  date: string; // YYYY-MM-DD, local to the venue
  time: string; // HH:MM, 24h
  venue: string;
  city: string; // "City, ST"
  lat?: number | null; // venue position for "near you"; falls back to CITY_COORDS
  lon?: number | null;
  price: number | null; // lowest all-in ticket price in dollars (FTC rule); null = free
  featured: boolean; // shows in the featured strip
  tag?: string; // short badge, e.g. "Selling fast"
  image?: string | null; // real image URL, or a placeholder key ("gala" | "fest" | "conf" | "party" | "club") for samples
  href?: string; // event page; undefined for sample events
};

export type { Category } from "../event-categories";

export type CityCoords = { lat: number; lon: number };

/* A place picked in the nav location box, or found automatically */
export type Place = CityCoords & { label: string; src?: "ip" | "gps" | "pick" };

export type WhenFilter = "" | "weekend" | "7" | "30";

export type Filters = {
  q: string;
  city: string;
  when: WhenFilter;
  free: boolean;
  cat: string;
  org: string;
  near: Place | null;
  shown: number;
};
