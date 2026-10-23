import 'server-only';
import { query, type Row } from '../db';
import { listMemberships } from '../authz';
import { decryptEventPassword } from '../events/password';
import { listEventDates, listEventPhotos, listTicketTypes, type EventRow } from '../events/queries';
import { utcToWallClock } from '../tz';
import { uploadUrl } from '../uploads';
import { emptyDraft, emptyVenue, migrateRefund, type EventDraft, type TicketDraft, type VenueOption } from './create';

/** An organization the signed-in person can host events for on /create (Organization Admin or Organizer). */
export type HostOrganization = { id: number; slug: string; name: string; verified: boolean };

export async function hostOrganizations(userId: number): Promise<HostOrganization[]> {
  const memberships = (await listMemberships(userId)).filter((m) => m.status === 'active' && m.role !== 'staff');
  if (!memberships.length) return [];
  const ids = memberships.map((m) => Number(m.organization_id));
  const verified = new Set(
    (await query<Row & { id: number }>(`SELECT id FROM organizations WHERE verified_at IS NOT NULL AND id IN (${ids.map(() => '?').join(',')})`, ids)).map((r) => Number(r.id)),
  );
  return memberships.map((m) => ({ id: Number(m.organization_id), slug: m.slug, name: m.name, verified: verified.has(Number(m.organization_id)) }));
}

/** Each organization's saved venues (Dashboard → Venues), keyed by organization slug. */
export async function venuesByOrg(orgs: { id: number; slug: string }[]): Promise<Record<string, VenueOption[]>> {
  if (!orgs.length) return {};
  const rows = await query<Row & { id: number; organization_id: number; name: string; city: string | null; region: string | null; timezone: string; tax_bps: number; tax_label: string | null }>(
    `SELECT id, organization_id, name, city, region, timezone, tax_bps, tax_label FROM venues WHERE organization_id IN (${orgs.map(() => '?').join(',')}) ORDER BY name`,
    orgs.map((o) => o.id),
  );
  const out: Record<string, VenueOption[]> = {};
  for (const o of orgs) {
    out[o.slug] = rows
      .filter((v) => Number(v.organization_id) === o.id)
      .map((v) => ({ id: Number(v.id), name: v.name, city: v.city, region: v.region, timezone: v.timezone, taxBps: Number(v.tax_bps), taxLabel: v.tax_label }));
  }
  return out;
}

/** Drafts this person can work on, newest first, so they reopen on the page (plan 5.6.12). */
export type OwnDraft = { id: number; title: string; orgSlug: string; orgName: string; updatedAt: string };

export async function ownDrafts(userId: number, limit = 6): Promise<OwnDraft[]> {
  const rows = await query<Row & { id: number; title: string; slug: string; name: string; updated_at: Date }>(
    `SELECT e.id, e.title, g.slug, g.name, e.updated_at FROM events e JOIN organizations g ON g.id = e.organization_id AND g.status = 'active'
       JOIN organization_members m ON m.organization_id = g.id AND m.user_id = ? AND m.role IN ('org_admin','organizer')
      WHERE e.status = 'draft'
        AND (m.role = 'org_admin' OR m.all_events = 1 OR e.created_by = ? OR EXISTS (SELECT 1 FROM event_members em WHERE em.event_id = e.id AND em.user_id = ?))
      ORDER BY e.updated_at DESC LIMIT ?`, [userId, userId, userId, limit],
  );
  return rows.map((r) => ({ id: Number(r.id), title: r.title, orgSlug: r.slug, orgName: r.name, updatedAt: new Date(r.updated_at).toISOString() }));
}

/** A ticket type the page shows but leaves to the dashboard's Ticket types tab (VIP, tables, comps, presale, day tickets). */
export type LockedTicket = { id: number; name: string; detail: string };

export type EditorData = {
  eventId: number;
  status: string;
  draft: EventDraft;
  /** "YYYY-MM-DDTHH:MM" the event had when the page opened (an event under way can be edited without moving its start) */
  originalStart: string;
  lockedTickets: LockedTicket[];
  /** dates come from the dashboard's Schedule tab */
  multiDay: boolean;
  hasPassword: boolean;
  /** tickets have been sold: date and place changes are emailed to the holders */
  hasSales: boolean;
};

const KIND_LABEL: Record<string, string> = { vip: 'VIP', table: 'Table', complimentary: 'Complimentary', general: 'General' };

/** The saved event as the /create page's draft, for editing it there. */
export async function editorData(event: EventRow): Promise<EditorData> {
  const tz = event.timezone;
  const wall = (d: Date | string | null) => (d ? utcToWallClock(new Date(d), tz) : '');
  const start = wall(event.starts_at), end = wall(event.ends_at), doors = wall(event.doors_at);
  const [types, photos, dates] = await Promise.all([listTicketTypes(event.id), listEventPhotos(event.id), listEventDates(event.id)]);
  const editable = (t: (typeof types)[number]) => t.kind === 'general' && !t.event_date_id && !t.access_code && Number(t.seats_per_unit) === 1 && !t.seated;
  const tickets: TicketDraft[] = types.filter(editable).map((t) => ({
    id: `t-${t.id}`,
    serverId: Number(t.id),
    sold: Number(t.sold),
    name: t.name,
    price: Number(t.price_cents) > 0 ? (Number(t.price_cents) / 100).toFixed(2) : '',
    quantity: Number(t.quantity) >= 1_000_000 ? '' : String(t.quantity),
    minPerOrder: String(t.min_per_order),
    maxPerOrder: String(t.max_per_order),
    salesStart: wall(t.sales_start_at),
    salesEnd: wall(t.sales_end_at),
    description: t.description ?? '',
    hidden: !!t.hidden,
  }));
  const lockedTickets: LockedTicket[] = types.filter((t) => !editable(t)).map((t) => ({
    id: Number(t.id),
    name: t.name,
    detail: [t.seated ? 'Reserved seating' : KIND_LABEL[t.kind] ?? t.kind, Number(t.price_cents) > 0 ? `$${(Number(t.price_cents) / 100).toFixed(2)}` : 'Free', `${t.sold} of ${t.quantity} sold`, t.access_code ? 'presale code' : '', t.event_date_id ? 'one day' : ''].filter(Boolean).join(' · '),
  }));
  const password = decryptEventPassword(event.access_password);
  const base = emptyDraft();
  const draft: EventDraft = {
    ...base,
    mode: 'tickets',
    cover: uploadUrl(event.image_path),
    name: event.title,
    summary: event.summary ?? '',
    category: event.category ?? '',
    startDate: start.slice(0, 10),
    startTime: start.slice(11, 16),
    endDate: end.slice(0, 10),
    endTime: end.slice(11, 16),
    showEnd: !!event.show_end_time,
    timeZone: tz,
    doorsTime: doors && doors.slice(0, 10) === start.slice(0, 10) ? doors.slice(11, 16) : '',
    location: event.venue_id
      ? { kind: 'saved', venueId: String(event.venue_id), venueName: '' }
      : event.online_url ? { kind: 'online', link: event.online_url } : emptyVenue(),
    tickets: tickets.length || types.length ? tickets : base.tickets,
    feePayer: event.fee_mode === 'organizer_absorbs' ? 'organizer' : 'buyer',
    capacity: event.capacity ? String(event.capacity) : '',
    waitlist: !!event.waitlist_enabled,
    description: event.description ?? '',
    gallery: photos.flatMap((p) => {
      const src = uploadUrl(p.image_path);
      return src ? [{ id: `p-${p.id}`, src, serverId: Number(p.id) }] : [];
    }),
    videoUrl: event.video_url ?? '',
    password: password ?? '',
    age: event.age_restriction ? String(event.age_restriction) : 'all',
    ...migrateRefund(event.refund_policy, event.refund_days_before ? String(event.refund_days_before) : undefined),
    allowTransfers: !!event.allow_transfers,
    visibility: event.visibility,
    taxPct: event.tax_bps == null ? '' : (Number(event.tax_bps) / 100).toFixed(2),
    taxLabel: event.tax_label ?? '',
    featured: !!event.featured,
    slug: event.slug,
  };
  const sold = await query<Row & { n: number }>(`SELECT COUNT(*) AS n FROM orders WHERE event_id = ? AND status IN ('paid','partially_refunded')`, [event.id]);
  return {
    eventId: Number(event.id), status: event.status, draft, originalStart: start, lockedTickets,
    multiDay: dates.length > 0, hasPassword: !!password, hasSales: Number(sold[0]?.n ?? 0) > 0,
  };
}
