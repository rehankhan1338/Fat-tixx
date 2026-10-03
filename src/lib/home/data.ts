import 'server-only';
import { query, type Row } from '../db';
import { listPublicEvents, publicEventPath, ticketTypeOnSale, type TicketTypeRow } from '../events/queries';
import { allInUnitCents, effectiveTaxBps, feeConfigForEvent } from '../orders/checkout';
import { formatCents } from '../money';
import { getSettings } from '../settings';
import { utcToWallClock } from '../tz';
import { uploadUrl } from '../uploads';
import type { EventItem } from './types';

/**
 * Published, public, upcoming events mapped to the homepage design's EventItem shape.
 * Prices are the lowest **all-in** price of a publicly listed ticket type (ticket + mandatory fees + tax),
 * the same figure the event page shows, as the FTC fee rule requires.
 */
export async function homepageEvents(): Promise<EventItem[]> {
  const events = await listPublicEvents();
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
    if (!tts.length) continue; // nothing to sell yet
    const fees = await feeConfigForEvent(e);
    const tax = effectiveTaxBps(e);
    const sellable = tts.filter((t) => ticketTypeOnSale(t).reason !== 'ended');
    const priced = (sellable.length ? sellable : tts).map((t) => (Number(t.price_cents) > 0 ? allInUnitCents(Number(t.price_cents), fees, tax, e.fee_mode) : 0));
    const lowest = Math.min(...priced);
    const sold = Number(e.tickets_sold), cap = Number(e.capacity_total);
    const allSoldOut = tts.every((t) => ticketTypeOnSale(t).reason === 'sold_out');
    const wall = utcToWallClock(new Date(e.starts_at), e.timezone); // "YYYY-MM-DDTHH:MM" in the venue's zone
    const pos = e.venue_id ? venuePos.get(Number(e.venue_id)) : undefined;
    const words = e.org_name.split(/\s+/).filter(Boolean);
    out.push({
      id: Number(e.id),
      organizerId: String(e.organization_id),
      organizerName: e.org_name,
      organizerInitials: (words.length > 1 ? words[0][0] + words[1][0] : e.org_name.slice(0, 2)).toUpperCase(),
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

/** Fee points for the organizer band, built from the live fee settings so marketing copy matches checkout. */
export async function hostFeeStats(): Promise<{ b: string; t: string }[]> {
  const s = await getSettings();
  const pct = (bps: string) => `${(Number(bps) / 100).toFixed(Number(bps) % 100 ? 1 : 0)}%`;
  const fixed = (c: string) => formatCents(Number(c));
  const platform = Number(s.platform_fee_fixed_cents) ? `${pct(s.platform_fee_bps)} + ${fixed(s.platform_fee_fixed_cents)}` : pct(s.platform_fee_bps);
  const processing = Number(s.processing_fee_bps) || Number(s.processing_fee_fixed_cents)
    ? `${pct(s.processing_fee_bps)}${Number(s.processing_fee_fixed_cents) ? ` + ${fixed(s.processing_fee_fixed_cents)}` : ''} per order`
    : null;
  return [
    { b: platform, t: `Platform fee per paid ticket${processing ? `, plus card processing of ${processing}` : ', with card processing included'}. Pass it to buyers or absorb it, per event.` },
    { b: 'All-in', t: 'Buyers see the full price, fees and tax included, before they check out.' },
    { b: '$0', t: 'To create an event or list free tickets.' },
  ];
}
