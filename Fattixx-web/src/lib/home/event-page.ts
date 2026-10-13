/* Everything an event page shows. src/lib/home/data.ts builds it from the database; the components only render it. */

import { dateTimeInZone } from "./date-time";
import type { FeePayer } from "./pricing";
import type { EventItem, Organizer } from "./types";

/* on_sale: buyable. sold_out: none left. scheduled: sales open later (salesStart). closed: sales ended. */
export type TicketStatus = "on_sale" | "sold_out" | "scheduled" | "closed";

export type TicketType = {
  id: number;
  name: string;
  description?: string | null;
  kind: "general" | "vip" | "table" | "complimentary";
  /** the organizer's price */
  priceCents: number;
  /** what the buyer pays per ticket: price + fees (+ tax where it applies); 0 = free */
  allInCents: number;
  status: TicketStatus;
  /** tickets left; shown as "Only N left" at 20 or fewer */
  remaining: number;
  minPerOrder: number;
  maxPerOrder: number;
  /** seats per unit for table tickets */
  seats: number;
  /** when sales open, already formatted in the venue's time zone (status "scheduled") */
  salesStart?: string | null;
  /** unlocked with an access code */
  presale?: boolean;
  /** valid on one day of a multi-day event */
  dayLabel?: string | null;
};

export type AddonType = {
  id: number;
  name: string;
  description?: string | null;
  allInCents: number;
  /** null = unlimited */
  available: number | null;
  max: number;
};

export type QuestionView = { id: number; label: string; kind: "text" | "textarea" | "select" | "checkbox"; required: boolean; options: string[] };

export type LineupItem = { name: string; role: string };

export type SponsorView = { id: number; name: string; logoUrl: string | null; url: string | null; tier: string | null };

export type EventPageData = {
  event: EventItem;
  slug: string;
  organizer: Organizer;
  /** one line under the title */
  summary: string;
  /** "About this event", one string per paragraph */
  about: string[];
  /** venue-local "HH:MM"; the event's end (same day unless endDate is set) */
  endTime?: string;
  endDate?: string;
  /** multi-day events: every date, venue-local "YYYY-MM-DD", with a label each */
  days?: { date: string; label: string; time: string }[];
  doorsTime?: string;
  timeZone: string; // IANA, e.g. America/New_York
  address: string; // street address of the venue, without the city
  feePayer: FeePayer;
  /** free events with nothing to buy: the panel says "Register" instead of "Checkout" */
  rsvp: boolean;
  /** lowest all-in price that can be bought right now (cents); null when nothing is on sale */
  lowestCents: number | null;
  /** some tickets go on sale later */
  salesUpcoming: boolean;
  lineup: LineupItem[];
  ageText: string;
  refundText: string;
  feeText: string;
  status: "draft" | "published" | "cancelled" | "postponed" | "completed";
  /** draft / private preview for the organizer's team */
  preview: boolean;
  /** other dates of a recurring event */
  siblings: { href: string; label: string }[];
  sponsors: SponsorView[];
  /** "More from <organizer>" or similar events */
  more: EventItem[];
  moreFromOrg: boolean;
  contactEmail: string;
  /** publicly listed ticket types, for the structured data search engines read */
  offers: { name: string; allInCents: number; status: TicketStatus }[];
  /** absolute origin for share images and structured data, e.g. https://fattixx.com */
  siteUrl: string;
};

/* ---------- small helpers used by the page ---------- */

/** "21:00" -> "9 PM", "18:30" -> "6:30 PM" */
export function clock24(t: string): string {
  const [h, m] = t.split(":").map(Number);
  return (h % 12 || 12) + (m ? ":" + String(m).padStart(2, "0") : "") + (h < 12 ? " AM" : " PM");
}

/** offset of a time zone on a date, e.g. "-04:00", for ISO dates in structured data and calendar files */
export function zoneOffset(date: string, time: string, timeZone: string): string {
  const instant = dateTimeInZone(date, time, timeZone);
  if (!instant) return "Z";
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const offset = (Date.UTC(year, month - 1, day, hour, minute) - instant.getTime()) / 60_000;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${offset < 0 ? "-" : "+"}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
}

/** "2026-10-09T20:00:00-04:00" */
export function isoLocal(date: string, time: string, timeZone: string): string {
  return `${date}T${time}:00${zoneOffset(date, time, timeZone)}`;
}

/** end of the event, defaulting to 3 hours after the start */
export function endOf(p: Pick<EventPageData, "endTime" | "endDate" | "days" | "event">): { date: string; time: string } {
  if (p.endTime) return { date: p.endDate ?? p.days?.at(-1)?.date ?? p.event.date, time: p.endTime };
  const [h, m] = p.event.time.split(":").map(Number);
  const end = new Date(Date.UTC(2000, 0, 1, h + 3, m));
  const nextDay = end.getUTCDate() > 1;
  let date = p.event.date;
  if (nextDay) {
    const [y, mo, d] = p.event.date.split("-").map(Number);
    const nd = new Date(Date.UTC(y, mo - 1, d + 1));
    date = nd.toISOString().slice(0, 10);
  }
  return { date, time: `${String(end.getUTCHours()).padStart(2, "0")}:${String(end.getUTCMinutes()).padStart(2, "0")}` };
}
