import 'server-only';
import { query, queryOne, type Row } from '../db';
import type { OrgContext } from '../authz';
import { eventVisibilityClause } from '../authz';

export type EventRow = Row & {
  id: number; organization_id: number; venue_id: number | null; slug: string; series_id: string | null; title: string; summary: string | null; description: string | null;
  image_path: string | null; starts_at: Date; ends_at: Date | null; doors_at: Date | null; timezone: string; capacity: number | null; waitlist_enabled: number; queue_enabled: number; queue_rate_per_min: number; reminder_sent_at: Date | null;
  status: 'draft' | 'published' | 'cancelled' | 'postponed' | 'completed'; visibility: 'public' | 'private' | 'unlisted'; private_key: string | null;
  age_restriction: number | null; fee_mode: 'buyer_pays' | 'organizer_absorbs'; tax_bps: number | null; tax_label: string | null; currency: string;
  refund_policy: 'no_refunds' | 'until_event_start' | 'days_before'; refund_days_before: number | null; allow_transfers: number;
  category: string | null; featured: number;
  checkout_question: string | null; cancelled_at: Date | null; cancel_reason: string | null; created_by: number | null; created_at: Date; updated_at: Date;
};

export type EventListRow = EventRow & { venue_name: string | null; tickets_sold: number; capacity_total: number; gross_cents: number; checked_in: number };

const EVENT_LIST_SELECT = `
  SELECT e.*, v.name AS venue_name,
         (SELECT COALESCE(SUM(t.sold),0) FROM ticket_types t WHERE t.event_id = e.id) AS tickets_sold,
         (SELECT COALESCE(SUM(t.quantity * t.seats_per_unit),0) FROM ticket_types t WHERE t.event_id = e.id) AS capacity_total,
         (SELECT COALESCE(SUM(o.subtotal_cents - o.refunded_cents),0) FROM orders o WHERE o.event_id = e.id AND o.status IN ('paid','partially_refunded')) AS gross_cents,
         (SELECT COUNT(*) FROM tickets k WHERE k.event_id = e.id AND k.status = 'used') AS checked_in
    FROM events e LEFT JOIN venues v ON v.id = e.venue_id`;

export async function listOrgEvents(orgId: number): Promise<EventListRow[]> {
  return query<EventListRow>(`${EVENT_LIST_SELECT} WHERE e.organization_id = ? ORDER BY e.starts_at DESC`, [orgId]);
}

/** Events the current member may see. */
export async function listVisibleEvents(ctx: OrgContext, filter: 'upcoming' | 'past' | 'all' = 'all'): Promise<EventListRow[]> {
  const vis = eventVisibilityClause(ctx);
  const when = filter === 'upcoming' ? ' AND (e.ends_at IS NULL AND e.starts_at > NOW() - INTERVAL 12 HOUR OR e.ends_at > NOW())' : filter === 'past' ? ' AND COALESCE(e.ends_at, e.starts_at) < NOW()' : '';
  return query<EventListRow>(`${EVENT_LIST_SELECT} WHERE e.organization_id = ?${vis.sql}${when} ORDER BY e.starts_at ${filter === 'past' ? 'DESC' : 'ASC'}`, [ctx.org.id, ...vis.params]);
}

export async function getEvent(orgId: number, eventId: number): Promise<EventListRow | null> {
  if (!Number.isInteger(eventId)) return null;
  return queryOne<EventListRow>(`${EVENT_LIST_SELECT} WHERE e.id = ? AND e.organization_id = ?`, [eventId, orgId]);
}

export type PublicEventRow = EventListRow & { org_name: string; org_slug: string; org_logo: string | null; venue_address: string | null; venue_city: string | null; venue_region: string | null; venue_tax_bps: number | null; venue_tax_label: string | null; fee_bps_override: number | null; fee_fixed_cents_override: number | null; org_status: string; org_meta_pixel: string | null; org_ga4: string | null };

const PUBLIC_SELECT = `
  SELECT e.*, v.name AS venue_name, v.address_line1 AS venue_address, v.city AS venue_city, v.region AS venue_region, v.tax_bps AS venue_tax_bps, v.tax_label AS venue_tax_label,
         g.name AS org_name, g.slug AS org_slug, g.logo_path AS org_logo, g.fee_bps_override, g.fee_fixed_cents_override, g.status AS org_status, g.meta_pixel_id AS org_meta_pixel, g.ga4_id AS org_ga4,
         (SELECT COALESCE(SUM(t.sold),0) FROM ticket_types t WHERE t.event_id = e.id) AS tickets_sold,
         (SELECT COALESCE(SUM(t.quantity * t.seats_per_unit),0) FROM ticket_types t WHERE t.event_id = e.id) AS capacity_total,
         0 AS gross_cents, 0 AS checked_in
    FROM events e JOIN organizations g ON g.id = e.organization_id LEFT JOIN venues v ON v.id = e.venue_id`;

export async function listPublicEvents(): Promise<PublicEventRow[]> {
  return query<PublicEventRow>(
    `${PUBLIC_SELECT} WHERE e.status IN ('published','postponed') AND e.visibility = 'public' AND g.status = 'active'
       AND COALESCE(e.ends_at, e.starts_at + INTERVAL 6 HOUR) > NOW() ORDER BY e.starts_at ASC`,
  );
}

/** An organization's public events, newest first (upcoming and past), for its organizer page. */
export async function listOrgPublicEvents(orgId: number): Promise<PublicEventRow[]> {
  return query<PublicEventRow>(
    `${PUBLIC_SELECT} WHERE e.organization_id = ? AND e.status IN ('published','postponed','completed') AND e.visibility = 'public' AND g.status = 'active'
       ORDER BY e.starts_at DESC LIMIT 80`, [orgId],
  );
}

export async function countOrgPublicEvents(orgId: number): Promise<number> {
  const r = await queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM events WHERE organization_id = ? AND status IN ('published','postponed','completed') AND visibility = 'public'`, [orgId]);
  return Number(r?.n ?? 0);
}

export type PublicOrgRow = Row & { id: number; slug: string; name: string; description: string | null; website: string | null; logo_path: string | null };

/** An active organization by slug, the fields its public page shows. */
export async function getPublicOrganization(slug: string): Promise<PublicOrgRow | null> {
  if (!/^[a-z0-9-]{1,64}$/.test(slug)) return null;
  return queryOne<PublicOrgRow>(`SELECT id, slug, name, description, website, logo_path FROM organizations WHERE slug = ? AND status = 'active'`, [slug]);
}

export async function getPublicEventBySlug(slug: string): Promise<PublicEventRow | null> {
  if (!/^[a-z0-9-]{1,120}$/.test(slug)) return null;
  return queryOne<PublicEventRow>(`${PUBLIC_SELECT} WHERE e.slug = ? AND g.status = 'active'`, [slug]);
}

export type TicketTypeRow = Row & {
  id: number; event_id: number; name: string; description: string | null; kind: 'general' | 'vip' | 'table' | 'complimentary';
  price_cents: number; quantity: number; sold: number; min_per_order: number; max_per_order: number; max_per_account: number | null; seats_per_unit: number; event_date_id: number | null;
  sales_start_at: Date | null; sales_end_at: Date | null; hidden: number; access_code: string | null; sort_order: number; held: number;
};

/** Public path to an event page. Private events only open with their key in the link. */
export function publicEventPath(event: { slug: string; visibility: string; private_key: string | null }): string {
  return event.visibility === 'private' && event.private_key ? `/events/${event.slug}?key=${event.private_key}` : `/events/${event.slug}`;
}

/** Does a presale / access code unlock this hidden ticket type? Case- and whitespace-insensitive. */
export function accessCodeMatches(t: { hidden: number; access_code: string | null }, code: string | null | undefined): boolean {
  if (!t.hidden || !t.access_code || !code) return false;
  return t.access_code.trim().toLowerCase() === code.trim().toLowerCase();
}

/** Ticket types with live "held" counts (pending orders whose hold has not expired). */
export async function listTicketTypes(eventId: number): Promise<TicketTypeRow[]> {
  return query<TicketTypeRow>(
    `SELECT t.*, (SELECT COALESCE(SUM(oi.quantity),0) FROM order_items oi JOIN orders o ON o.id = oi.order_id
                   WHERE oi.ticket_type_id = t.id AND o.status = 'pending' AND o.hold_expires_at > NOW()) AS held
       FROM ticket_types t WHERE t.event_id = ? ORDER BY t.sort_order, t.id`,
    [eventId],
  );
}

export function ticketTypeAvailable(t: TicketTypeRow): number {
  return Math.max(0, Number(t.quantity) - Number(t.sold) - Number(t.held));
}

export function ticketTypeOnSale(t: TicketTypeRow, now = new Date()): { onSale: boolean; reason?: string } {
  if (t.hidden) return { onSale: false, reason: 'hidden' };
  if (t.sales_start_at && new Date(t.sales_start_at) > now) return { onSale: false, reason: 'not_yet' };
  if (t.sales_end_at && new Date(t.sales_end_at) < now) return { onSale: false, reason: 'ended' };
  if (ticketTypeAvailable(t) <= 0) return { onSale: false, reason: 'sold_out' };
  return { onSale: true };
}

// ---------------------------------------------------------------------------
// Multi-day schedule
// ---------------------------------------------------------------------------
export type EventDateRow = Row & { id: number; event_id: number; label: string | null; starts_at: Date; ends_at: Date | null; doors_at: Date | null; sort_order: number };

export async function listEventDates(eventId: number): Promise<EventDateRow[]> {
  return query<EventDateRow>(`SELECT * FROM event_dates WHERE event_id = ? ORDER BY starts_at, id`, [eventId]);
}

/**
 * Which day of a multi-day event is "now"? A day is active from doors (or 6 h before start) until
 * its end (or 12 h after start). Outside every window the nearest upcoming day is used, else the last one.
 */
export function activeEventDate(dates: EventDateRow[], now = new Date()): EventDateRow | null {
  if (dates.length === 0) return null;
  const t = now.getTime();
  for (const d of dates) {
    const start = new Date(d.doors_at ?? d.starts_at).getTime() - (d.doors_at ? 0 : 6 * 3_600_000);
    const end = d.ends_at ? new Date(d.ends_at).getTime() : new Date(d.starts_at).getTime() + 12 * 3_600_000;
    if (t >= start && t <= end) return d;
  }
  return dates.find((d) => new Date(d.starts_at).getTime() > t) ?? dates[dates.length - 1];
}

/** Events in the same recurring series that the public may still buy for (excluding `eventId`). */
export async function listSeriesSiblings(seriesId: string, eventId: number): Promise<PublicEventRow[]> {
  return query<PublicEventRow>(
    `${PUBLIC_SELECT} WHERE e.series_id = ? AND e.id <> ? AND e.status IN ('published','postponed') AND g.status = 'active'
       AND COALESCE(e.ends_at, e.starts_at + INTERVAL 6 HOUR) > NOW() ORDER BY e.starts_at ASC`, [seriesId, eventId],
  );
}

// ---------------------------------------------------------------------------
// Add-ons
// ---------------------------------------------------------------------------
export type AddonRow = Row & {
  id: number; event_id: number; name: string; description: string | null; price_cents: number; quantity: number | null; sold: number;
  max_per_order: number; active: number; sort_order: number; held: number;
};

export async function listAddons(eventId: number): Promise<AddonRow[]> {
  return query<AddonRow>(
    `SELECT a.*, (SELECT COALESCE(SUM(oa.quantity),0) FROM order_addons oa JOIN orders o ON o.id = oa.order_id
                   WHERE oa.addon_id = a.id AND o.status = 'pending' AND o.hold_expires_at > NOW()) AS held
       FROM event_addons a WHERE a.event_id = ? ORDER BY a.sort_order, a.id`, [eventId],
  );
}

/** Remaining add-on units, or null when unlimited. */
export function addonAvailable(a: AddonRow): number | null {
  if (a.quantity == null) return null;
  return Math.max(0, Number(a.quantity) - Number(a.sold) - Number(a.held));
}

// ---------------------------------------------------------------------------
// Checkout questions
// ---------------------------------------------------------------------------
export type QuestionRow = Row & { id: number; event_id: number; label: string; kind: 'text' | 'textarea' | 'select' | 'checkbox'; required: number; options: string | null; sort_order: number };

export async function listQuestions(eventId: number): Promise<QuestionRow[]> {
  return query<QuestionRow>(`SELECT * FROM event_questions WHERE event_id = ? ORDER BY sort_order, id`, [eventId]);
}

export function questionOptions(q: { options: string | null }): string[] {
  return (q.options ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Waitlist
// ---------------------------------------------------------------------------
export type WaitlistRow = Row & {
  id: number; event_id: number; ticket_type_id: number | null; email: string; name: string | null; quantity: number;
  status: 'waiting' | 'notified' | 'converted' | 'removed'; token: string; notified_at: Date | null; created_at: Date; ticket_type_name: string | null;
};

export async function listWaitlist(eventId: number): Promise<WaitlistRow[]> {
  return query<WaitlistRow>(
    `SELECT w.*, t.name AS ticket_type_name FROM waitlist_entries w LEFT JOIN ticket_types t ON t.id = w.ticket_type_id
      WHERE w.event_id = ? AND w.status <> 'removed' ORDER BY FIELD(w.status,'waiting','notified','converted'), w.created_at, w.id`, [eventId],
  );
}

export async function waitlistWaitingCount(eventId: number): Promise<number> {
  const r = await queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM waitlist_entries WHERE event_id = ? AND status = 'waiting'`, [eventId]);
  return Number(r?.n ?? 0);
}

export type VenueRow = Row & {
  id: number; organization_id: number; name: string; address_line1: string | null; address_line2: string | null; city: string | null; region: string | null;
  postal_code: string | null; country: string; timezone: string; capacity: number | null; tax_bps: number; tax_label: string | null; event_count: number; latitude: number | null; longitude: number | null;
};

export async function listVenues(orgId: number): Promise<VenueRow[]> {
  return query<VenueRow>(`SELECT v.*, (SELECT COUNT(*) FROM events e WHERE e.venue_id = v.id) AS event_count FROM venues v WHERE v.organization_id = ? ORDER BY v.name`, [orgId]);
}

export type EventMemberRow = Row & { user_id: number; name: string; email: string; role: string; assigned: number };

/** Organizers and staff of the org, flagged with whether they are assigned to this event. */
export async function listEventAssignableMembers(orgId: number, eventId: number): Promise<EventMemberRow[]> {
  return query<EventMemberRow>(
    `SELECT m.user_id, u.name, u.email, m.role, EXISTS(SELECT 1 FROM event_members em WHERE em.event_id = ? AND em.user_id = m.user_id) AS assigned
       FROM organization_members m JOIN users u ON u.id = m.user_id
      WHERE m.organization_id = ? AND m.role IN ('organizer','staff') ORDER BY FIELD(m.role,'organizer','staff'), u.name`,
    [eventId, orgId],
  );
}

export async function orgOverview(orgId: number) {
  const [events, upcoming, paid, gross, sold, used] = await Promise.all([
    queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM events WHERE organization_id = ?`, [orgId]),
    queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM events WHERE organization_id = ? AND status = 'published' AND starts_at > NOW()`, [orgId]),
    queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM orders WHERE organization_id = ? AND status IN ('paid','partially_refunded')`, [orgId]),
    queryOne<Row & { n: number }>(`SELECT COALESCE(SUM(subtotal_cents - refunded_cents),0) AS n FROM orders WHERE organization_id = ? AND status IN ('paid','partially_refunded')`, [orgId]),
    queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM tickets k JOIN events e ON e.id = k.event_id WHERE e.organization_id = ? AND k.status IN ('valid','used')`, [orgId]),
    queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM tickets k JOIN events e ON e.id = k.event_id WHERE e.organization_id = ? AND k.status = 'used'`, [orgId]),
  ]);
  const n = (r: (Row & { n: number }) | null) => Number(r?.n ?? 0);
  return { events: n(events), upcoming: n(upcoming), paidOrders: n(paid), grossCents: n(gross), ticketsSold: n(sold), checkedIn: n(used) };
}
