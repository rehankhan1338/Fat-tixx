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

/** Where self-service advertisers (/advertiser) may buy impressions: the attendee-facing placements, never the organizer or door screens. */
export const ADVERTISER_PLACEMENTS = ['event_list', 'event_detail', 'order_confirmation', 'ticket_dashboard', 'email'] as const;

/** Price of an impression purchase: impressions × CPM / 1000, rounded up to the cent. */
export function impressionPriceCents(impressions: number, cpmCents: number): number {
  return Math.ceil((impressions * cpmCents) / 1000);
}

export function isPlacement(k: string): k is PlacementKey {
  return PLACEMENTS.some((p) => p.key === k);
}

/** Ticket type kinds an ad can target (ticket_types.kind). */
export const TICKET_KINDS = [
  { key: 'general', label: 'General admission' },
  { key: 'vip', label: 'VIP' },
  { key: 'table', label: 'Tables' },
  { key: 'complimentary', label: 'Complimentary' },
] as const;
export type TicketKind = (typeof TICKET_KINDS)[number]['key'];

/**
 * Who is looking (plan 14.2 "user role"). A visitor can hold several: a signed-in organizer is also an attendee.
 *  guest      not signed in
 *  attendee   signed in
 *  organizer  Organization Admin or Organizer of any organization
 *  staff      Staff / Scanner of any organization
 */
export const VIEWER_ROLES = [
  { key: 'guest', label: 'Guests (not signed in)' },
  { key: 'attendee', label: 'Signed-in attendees' },
  { key: 'organizer', label: 'Organizers' },
  { key: 'staff', label: 'Staff / scanners' },
] as const;
export type ViewerRole = (typeof VIEWER_ROLES)[number]['key'];

/** Targeting rules stored as JSON on the campaign (plan 14.2 contextual ads). Empty / missing = no restriction. */
export interface AdTargeting {
  regions?: string[];        // venue state / region codes, e.g. ["SC", "NC"]
  cities?: string[];         // venue city names
  ageRestricted?: boolean;   // only on 18+/21+ events (true) or only on all-ages events (false)
  signedIn?: boolean;        // only for signed-in visitors (true) or only for guests (false)
  daysBeforeEvent?: number;  // only within N days before the event starts
  categories?: string[];     // event categories (Super Admin → Event categories), e.g. ["Music", "Comedy"]
  ticketKinds?: TicketKind[]; // the visitor's tickets on order pages, emails and the ticket dashboard; else the event's ticket types
  roles?: ViewerRole[];      // the visitor's roles; any one of them matching is enough
}

/** What the ad server knows about the event the slot is on (null when the slot is not on an event). */
export interface AdEventFacts { region: string | null; city: string | null; age: number | null; startsAt: Date | null; category: string | null; ticketKinds: string[] }

/** What the ad server knows about the visitor. `ticketKinds` is set where the slot shows the visitor's own tickets. */
export interface AdViewerFacts { signedIn: boolean; roles: ViewerRole[]; ticketKinds?: string[] }

/** Does a campaign's targeting allow this slot? Pure, so the rules are unit-tested (tests/unit/ads-targeting.test.ts). */
export function matchesTargeting(t: AdTargeting, ev: AdEventFacts | null, viewer: AdViewerFacts, now = Date.now()): boolean {
  const norm = (s: string) => s.trim().toLowerCase();
  const anyOf = (want: string[], have: string[]) => { const h = have.map(norm); return want.some((w) => h.includes(norm(w))); };
  if (t.regions?.length && !(ev?.region && anyOf(t.regions, [ev.region]))) return false;
  if (t.cities?.length && !(ev?.city && anyOf(t.cities, [ev.city]))) return false;
  if (t.ageRestricted !== undefined && t.ageRestricted !== null && !!ev?.age !== t.ageRestricted) return false;
  if (t.signedIn !== undefined && t.signedIn !== null && viewer.signedIn !== t.signedIn) return false;
  if (t.daysBeforeEvent && (!ev?.startsAt || ev.startsAt.getTime() - now > t.daysBeforeEvent * 86_400_000)) return false;
  if (t.categories?.length && !(ev?.category && anyOf(t.categories, [ev.category]))) return false;
  if (t.ticketKinds?.length && !anyOf(t.ticketKinds, viewer.ticketKinds ?? ev?.ticketKinds ?? [])) return false;
  if (t.roles?.length && !anyOf(t.roles, viewer.roles)) return false;
  return true;
}

export type CampaignStatus = 'draft' | 'active' | 'paused' | 'scheduled' | 'expired';

/** Status shown to people: stored draft/active/paused, plus scheduled/expired derived from the dates. */
export function effectiveStatus(c: { status: string; starts_at: Date | string | null; ends_at: Date | string | null }, now = new Date()): CampaignStatus {
  if (c.status !== 'active') return c.status as CampaignStatus;
  if (c.starts_at && new Date(c.starts_at) > now) return 'scheduled';
  if (c.ends_at && new Date(c.ends_at) < now) return 'expired';
  return 'active';
}
