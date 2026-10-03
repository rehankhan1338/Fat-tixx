/**
 * Named, reusable ad placements (plan 14.3). Pages ask for a placement by key; nothing is hard-coded
 * to a page. Checkout and payment pages deliberately have no placement (plan 11.4 / 14.9).
 */
export const PLACEMENTS = [
  { key: 'event_list', label: 'Event listing pages', description: 'Home page / browse events, between the hero and the event grid.' },
  { key: 'event_detail', label: 'Event detail pages', description: 'Below the event description, above the footer.' },
  { key: 'order_confirmation', label: 'Order confirmation', description: 'Order page after payment is complete (never on the payment step).' },
  { key: 'ticket_dashboard', label: 'Ticket dashboard', description: "The attendee's account page with their orders." },
  { key: 'org_dashboard', label: 'Organizer dashboard', description: 'Organization overview page (optional).' },
  { key: 'checkin_dashboard', label: 'Check-in dashboard', description: 'Below the scanner, never over the scan result.' },
  { key: 'email', label: 'Email templates', description: 'Order confirmation emails, as a static image with a tracked link.' },
] as const;

export type PlacementKey = (typeof PLACEMENTS)[number]['key'];

export function isPlacement(k: string): k is PlacementKey {
  return PLACEMENTS.some((p) => p.key === k);
}

/** Targeting rules stored as JSON on the campaign (plan 14.2 contextual ads). Empty / missing = no restriction. */
export interface AdTargeting {
  regions?: string[];        // venue state / region codes, e.g. ["SC", "NC"]
  cities?: string[];         // venue city names
  ageRestricted?: boolean;   // only on 18+/21+ events (true) or only on all-ages events (false)
  signedIn?: boolean;        // only for signed-in visitors (true) or only for guests (false)
  daysBeforeEvent?: number;  // only within N days before the event starts
}

export type CampaignStatus = 'draft' | 'active' | 'paused' | 'scheduled' | 'expired';

/** Status shown to people: stored draft/active/paused, plus scheduled/expired derived from the dates. */
export function effectiveStatus(c: { status: string; starts_at: Date | string | null; ends_at: Date | string | null }, now = new Date()): CampaignStatus {
  if (c.status !== 'active') return c.status as CampaignStatus;
  if (c.starts_at && new Date(c.starts_at) > now) return 'scheduled';
  if (c.ends_at && new Date(c.ends_at) < now) return 'expired';
  return 'active';
}
