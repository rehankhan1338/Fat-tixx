import 'server-only';
import { query, type Row } from '../db';
import {
  countOrgPublicEvents, getPublicOrganization, listOrgPublicEvents, listPublicEvents, publicEventPath, ticketTypeOnSale,
  type PublicEventRow, type TicketTypeRow,
} from '../events/queries';
import { allInUnitCents, effectiveTaxBps, feeConfigForEvent } from '../orders/checkout';
import type { FeeConfig } from '../money';
import { getSettings } from '../settings';
import { utcToWallClock } from '../tz';
import { uploadUrl } from '../uploads';
import { listUpcoming } from './events';
import { citiesOf, type OrganizerPageData } from './organizer-page';
import type { EventItem, Organizer } from './types';

export function initialsOf(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2)).toUpperCase();
}

/** The organizer as the public pages show it. */
export function organizerOf(e: Pick<PublicEventRow, 'org_slug' | 'org_name' | 'org_logo'>, extra: Partial<Organizer> = {}): Organizer {
  return { id: e.org_slug, name: e.org_name, initials: initialsOf(e.org_name), logo: uploadUrl(e.org_logo), pro: false, ...extra };
}

/**
 * Map event rows to the public pages' EventItem shape.
 * Prices are the lowest **all-in** price of a publicly listed ticket type (ticket + mandatory fees + tax),
 * the same figure the event page shows, as the FTC fee rule requires.
 */
export async function toEventItems(events: PublicEventRow[], opts: { requireTickets?: boolean } = {}): Promise<EventItem[]> {
  if (!events.length) return [];
  const ids = events.map((e) => Number(e.id));
  const [types, venues] = await Promise.all([
    query<TicketTypeRow>(`SELECT t.*, 0 AS held FROM ticket_types t WHERE t.event_id IN (${ids.map(() => '?').join(',')}) AND t.hidden = 0`, ids),
    query<Row & { id: number; latitude: number | null; longitude: number | null }>(
      `SELECT v.id, v.latitude, v.longitude FROM venues v JOIN events e ON e.venue_id = v.id WHERE e.id IN (${ids.map(() => '?').join(',')})`, ids,
    ),
  ]);
  const venuePos = new Map(venues.map((v) => [Number(v.id), v]));
  const out: EventItem[] = [];
  for (const e of events) {
    const tts = types.filter((t) => Number(t.event_id) === Number(e.id));
    if (!tts.length && opts.requireTickets) continue; // nothing to sell yet
    const fees = await feeConfigForEvent(e);
    const tax = effectiveTaxBps(e);
    const sellable = tts.filter((t) => ticketTypeOnSale(t).reason !== 'ended');
    const priced = (sellable.length ? sellable : tts).map((t) => (Number(t.price_cents) > 0 ? allInUnitCents(Number(t.price_cents), fees, tax, e.fee_mode) : 0));
    const lowest = priced.length ? Math.min(...priced) : 0;
    const sold = Number(e.tickets_sold), cap = Number(e.capacity_total);
    const allSoldOut = tts.length > 0 && tts.every((t) => ticketTypeOnSale(t).reason === 'sold_out');
    const wall = utcToWallClock(new Date(e.starts_at), e.timezone); // "YYYY-MM-DDTHH:MM" in the venue's zone
    const pos = e.venue_id ? venuePos.get(Number(e.venue_id)) : undefined;
    out.push({
      id: Number(e.id),
      organizerId: e.org_slug,
      organizerName: e.org_name,
      organizerInitials: initialsOf(e.org_name),
      organizerLogo: uploadUrl(e.org_logo),
      organizerPro: false,
      title: e.title,
      category: e.category ?? 'Other',
      date: wall.slice(0, 10),
      time: wall.slice(11, 16),
      venue: e.venue_name ?? 'Venue to be announced',
      city: [e.venue_city, e.venue_region].filter(Boolean).join(', ') || 'Online',
      lat: pos?.latitude == null ? null : Number(pos.latitude),
      lon: pos?.longitude == null ? null : Number(pos.longitude),
      price: lowest > 0 ? lowest / 100 : null,
      featured: !!e.featured,
      tag: allSoldOut ? 'Sold out' : e.status === 'postponed' ? 'Postponed' : cap > 0 && sold / cap >= 0.75 ? 'Selling fast' : undefined,
      image: uploadUrl(e.image_path),
      href: publicEventPath(e),
    });
  }
  return out;
}

/** Published, public, upcoming events with something to sell: the homepage, /events and the nav's location menu. */
export async function publicEvents(): Promise<EventItem[]> {
  return toEventItems(await listPublicEvents(), { requireTickets: true });
}

/** The platform's default fee configuration, for fee previews on the public pages. */
export async function siteFees(): Promise<FeeConfig> {
  return feeConfigForOrgDefaults();
}

async function feeConfigForOrgDefaults(): Promise<FeeConfig> {
  const s = await getSettings();
  return {
    platformFeeBps: Number(s.platform_fee_bps),
    platformFeeFixedCents: Number(s.platform_fee_fixed_cents),
    processingFeeBps: Number(s.processing_fee_bps),
    processingFeeFixedCents: Number(s.processing_fee_fixed_cents),
  };
}

/** "More from <organizer>" when they have at least two other upcoming events; otherwise similar events. */
export function relatedEvents(current: EventItem, all: EventItem[]): { more: EventItem[]; moreFromOrg: boolean } {
  const others = all.filter((x) => x.id !== current.id);
  const fromOrg = others.filter((x) => x.organizerId === current.organizerId);
  const moreFromOrg = fromOrg.length >= 2;
  const more = (moreFromOrg ? fromOrg : others.filter((x) => x.category === current.category || x.organizerId === current.organizerId)).slice(0, 4);
  return { more, moreFromOrg };
}

/** The organizer page: the organization and its public events, upcoming and past. */
export async function organizerPage(slug: string): Promise<OrganizerPageData | null> {
  const org = await getPublicOrganization(slug);
  if (!org) return null;
  const rows = await listOrgPublicEvents(org.id);
  const now = Date.now();
  const isUpcoming = (e: PublicEventRow) => (e.ends_at ? new Date(e.ends_at).getTime() : new Date(e.starts_at).getTime() + 6 * 3_600_000) > now;
  const [upcomingItems, pastItems] = await Promise.all([
    toEventItems(rows.filter((e) => isUpcoming(e) && ['published', 'postponed'].includes(e.status)), { requireTickets: true }),
    toEventItems(rows.filter((e) => !isUpcoming(e))),
  ]);
  const upcoming = listUpcoming(upcomingItems, null);
  const past = listUpcoming(pastItems, null).reverse();
  const organizer: Organizer = {
    id: org.slug, name: org.name, initials: initialsOf(org.name), logo: uploadUrl(org.logo_path), pro: false,
    bio: org.description, website: org.website, eventCount: upcoming.length + past.length,
  };
  return { organizer, upcoming, past, cities: citiesOf(upcoming) };
}

/** How many public events (upcoming and past) an organization has on Fattixx, for the event page's organizer card. */
export async function organizerEventCount(orgId: number): Promise<number> {
  return countOrgPublicEvents(orgId);
}
