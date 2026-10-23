import 'server-only';
import { query, queryOne, type Row } from '../db';
import { getSettings } from '../settings';
import { drawingFor, readLayout, type Accessibility, type Drawing, type SeatMapLayout, type SeatStatus } from './layout';

/*
 * Reserved seating reads (plan 5.7.3–5.7.13): the Venue Library, seat map requests and an event's seats.
 * Seat statuses are derived from the orders and tickets in SQL, never stored (see migration 0013).
 */

export const REQUEST_STATUSES = ['new', 'in_progress', 'awaiting_approval', 'approved', 'cancelled'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  new: 'New', in_progress: 'In progress', awaiting_approval: 'Awaiting organizer approval', approved: 'Approved', cancelled: 'Cancelled',
};
/** The steps shown on the request page, in order. */
export const REQUEST_STEPS: RequestStatus[] = ['new', 'in_progress', 'awaiting_approval', 'approved'];

export async function setupFeeCents(): Promise<number> {
  const n = Number((await getSettings()).seat_map_setup_fee_cents);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

// ---------------------------------------------------------------------------
// Seat maps
// ---------------------------------------------------------------------------
export type SeatMapRow = Row & {
  id: number; organization_id: number | null; venue_id: number | null; name: string; venue_name: string; venue_city: string | null; venue_region: string | null;
  status: 'draft' | 'approved' | 'retired'; in_library: number; layout: unknown; seat_count: number; based_on_id: number | null;
  approved_at: Date | null; created_at: Date; updated_at: Date; org_name: string | null; org_slug: string | null; events_using: number;
};

const MAP_SELECT = `
  SELECT m.*, o.name AS org_name, o.slug AS org_slug, (SELECT COUNT(*) FROM event_seating es WHERE es.seat_map_id = m.id) AS events_using
    FROM seat_maps m LEFT JOIN organizations o ON o.id = m.organization_id`;

export async function getSeatMap(id: number): Promise<SeatMapRow | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  return queryOne<SeatMapRow>(`${MAP_SELECT} WHERE m.id = ?`, [id]);
}

export function mapLayout(m: { layout: unknown }): SeatMapLayout {
  return readLayout(m.layout);
}

/** Approved maps an organization may use for its events: its own, plus every map in the Venue Library. */
export async function listUsableMaps(orgId: number): Promise<SeatMapRow[]> {
  return query<SeatMapRow>(
    `${MAP_SELECT} WHERE m.status = 'approved' AND (m.organization_id = ? OR m.in_library = 1) ORDER BY m.organization_id = ? DESC, m.venue_name, m.name`, [orgId, orgId],
  );
}

/** Staff view of the library: every approved map, listed or not. */
export async function listApprovedMaps(): Promise<SeatMapRow[]> {
  return query<SeatMapRow>(`${MAP_SELECT} WHERE m.status = 'approved' ORDER BY m.in_library DESC, m.venue_name, m.name LIMIT 500`);
}

/** Can this organization use the map for an event? */
export function mapUsableBy(m: Pick<SeatMapRow, 'status' | 'organization_id' | 'in_library'>, orgId: number): boolean {
  return m.status === 'approved' && (Number(m.organization_id) === orgId || !!m.in_library);
}

export type MapChangeRow = Row & { id: number; seat_map_id: number; user_id: number | null; action: string; summary: string; detail: unknown; created_at: Date; user_name: string | null };

export async function listMapChanges(mapId: number, limit = 200): Promise<MapChangeRow[]> {
  return query<MapChangeRow>(
    `SELECT c.*, u.name AS user_name FROM seat_map_changes c LEFT JOIN users u ON u.id = c.user_id WHERE c.seat_map_id = ? ORDER BY c.created_at DESC, c.id DESC LIMIT ?`, [mapId, limit],
  );
}

/** The change detail lines stored with a change (JSON array of strings). */
export function changeLines(detail: unknown): string[] {
  const v = typeof detail === 'string' ? (() => { try { return JSON.parse(detail); } catch { return null; } })() : detail;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------
export type SeatMapRequestRow = Row & {
  id: number; organization_id: number; venue_id: number | null; venue_name: string; venue_city: string | null; map_name: string;
  floor_plan_path: string | null; floor_plan_kind: 'image' | 'pdf' | null; notes: string | null; status: RequestStatus;
  seat_map_id: number | null; base_map_id: number | null; assigned_to: number | null;
  fee_cents: number; fee_status: 'unpaid' | 'paid' | 'waived'; fee_paid_at: Date | null; stripe_session_id: string | null;
  sent_for_approval_at: Date | null; approved_at: Date | null; created_by: number | null; created_at: Date; updated_at: Date;
  org_name: string; org_slug: string; org_pro_until: Date | null; assignee_name: string | null; creator_name: string | null; creator_email: string | null;
  map_seat_count: number | null; map_status: string | null; base_map_name: string | null;
};

const REQUEST_SELECT = `
  SELECT r.*, o.name AS org_name, o.slug AS org_slug, o.pro_until AS org_pro_until, a.name AS assignee_name, c.name AS creator_name, c.email AS creator_email,
         m.seat_count AS map_seat_count, m.status AS map_status, b.name AS base_map_name
    FROM seat_map_requests r JOIN organizations o ON o.id = r.organization_id
    LEFT JOIN users a ON a.id = r.assigned_to LEFT JOIN users c ON c.id = r.created_by
    LEFT JOIN seat_maps m ON m.id = r.seat_map_id LEFT JOIN seat_maps b ON b.id = r.base_map_id`;

export async function getSeatMapRequest(id: number): Promise<SeatMapRequestRow | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  return queryOne<SeatMapRequestRow>(`${REQUEST_SELECT} WHERE r.id = ?`, [id]);
}

export async function listOrgRequests(orgId: number): Promise<SeatMapRequestRow[]> {
  return query<SeatMapRequestRow>(`${REQUEST_SELECT} WHERE r.organization_id = ? ORDER BY r.status IN ('approved','cancelled'), r.updated_at DESC LIMIT 100`, [orgId]);
}

/** Staff queue: open requests first (awaiting staff before awaiting the organizer), oldest first. */
export async function requestQueue(filter: RequestStatus | 'open' | 'all'): Promise<SeatMapRequestRow[]> {
  const where = filter === 'open' ? `WHERE r.status IN ('new','in_progress','awaiting_approval')` : filter === 'all' ? '' : 'WHERE r.status = ?';
  return query<SeatMapRequestRow>(
    `${REQUEST_SELECT} ${where} ORDER BY FIELD(r.status, 'new','in_progress','awaiting_approval','approved','cancelled'), r.created_at ASC LIMIT 300`,
    filter === 'open' || filter === 'all' ? [] : [filter],
  );
}

export async function requestQueueCounts(): Promise<Record<RequestStatus, number>> {
  const rows = await query<Row & { status: RequestStatus; n: number }>(`SELECT status, COUNT(*) AS n FROM seat_map_requests GROUP BY status`);
  const out = Object.fromEntries(REQUEST_STATUSES.map((s) => [s, 0])) as Record<RequestStatus, number>;
  for (const r of rows) out[r.status] = Number(r.n);
  return out;
}

export type RequestNoteRow = Row & { id: number; request_id: number; author_user_id: number | null; from_staff: number; status_to: string | null; body: string; created_at: Date; author_name: string | null };

export async function listRequestNotes(requestId: number): Promise<RequestNoteRow[]> {
  return query<RequestNoteRow>(
    `SELECT n.*, u.name AS author_name FROM seat_map_request_notes n LEFT JOIN users u ON u.id = n.author_user_id WHERE n.request_id = ? ORDER BY n.created_at, n.id`, [requestId],
  );
}

// ---------------------------------------------------------------------------
// An event's seats
// ---------------------------------------------------------------------------
export type EventSeatingRow = Row & { event_id: number; seat_map_id: number | null; layout: unknown; attached_at: Date; map_name: string | null; venue_name: string | null };

export async function getEventSeating(eventId: number): Promise<EventSeatingRow | null> {
  return queryOne<EventSeatingRow>(
    `SELECT s.*, m.name AS map_name, m.venue_name FROM event_seating s LEFT JOIN seat_maps m ON m.id = s.seat_map_id WHERE s.event_id = ?`, [eventId],
  );
}

export type EventSeat = {
  id: number; key: string; section: string; row: string | null; number: string; label: string; x: number; y: number;
  access: Accessibility | null; tier: number | null; status: SeatStatus; blockReason: string | null;
};
/** Organizer view: who holds a sold seat. */
export type ManagedSeat = EventSeat & { ticketId: number | null; ticketCode: string | null; holder: string | null; orderCode: string | null };

type SeatRow = Row & {
  id: number; seat_key: string; section: string; row_label: string | null; seat_number: string; label: string; x: string | number; y: string | number;
  accessibility: 'none' | Accessibility; ticket_type_id: number | null; blocked: number; block_reason: string | null; held: number | null;
  ticket_id: number | null; ticket_code: string | null; attendee_name: string | null; attendee_email: string | null; order_code: string | null;
};

function statusOf(r: SeatRow): SeatStatus {
  if (r.ticket_id) return 'sold';
  if (Number(r.held)) return 'held';
  if (r.blocked) return 'blocked';
  return r.ticket_type_id ? 'available' : 'unassigned';
}

async function seatRows(eventId: number): Promise<SeatRow[]> {
  const rows = await query<SeatRow>(
    `SELECT s.id, s.seat_key, s.section, s.row_label, s.seat_number, s.label, s.x, s.y, s.accessibility, s.ticket_type_id, s.blocked, s.block_reason,
            (o.status = 'pending' AND o.hold_expires_at > NOW()) AS held,
            k.id AS ticket_id, k.code AS ticket_code, k.attendee_name, k.attendee_email, ko.code AS order_code
       FROM event_seats s
       LEFT JOIN orders o ON o.id = s.hold_order_id
       LEFT JOIN tickets k ON k.event_seat_id = s.id AND k.status IN ('valid','used')
       LEFT JOIN orders ko ON ko.id = k.order_id
      WHERE s.event_id = ? ORDER BY s.sort_order, s.id`, [eventId],
  );
  const seen = new Set<number>();
  return rows.filter((r) => (seen.has(Number(r.id)) ? false : (seen.add(Number(r.id)), true)));
}

const toSeat = (r: SeatRow): EventSeat => ({
  id: Number(r.id), key: r.seat_key, section: r.section, row: r.row_label, number: r.seat_number, label: r.label, x: Number(r.x), y: Number(r.y),
  access: r.accessibility === 'none' ? null : r.accessibility, tier: r.ticket_type_id ? Number(r.ticket_type_id) : null, status: statusOf(r), blockReason: r.block_reason,
});

/** Public seat picker: statuses only, nothing about who bought what. */
export async function listEventSeats(eventId: number): Promise<EventSeat[]> {
  return (await seatRows(eventId)).map(toSeat);
}

export async function listManagedSeats(eventId: number): Promise<ManagedSeat[]> {
  return (await seatRows(eventId)).map((r) => ({
    ...toSeat(r), ticketId: r.ticket_id ? Number(r.ticket_id) : null, ticketCode: r.ticket_code, holder: r.attendee_name ?? r.attendee_email, orderCode: r.order_code,
  }));
}

/** Compact status list for the picker's live refresh: [seat id, status letter]. */
export const STATUS_CODE: Record<SeatStatus, string> = { available: 'a', held: 'h', sold: 's', blocked: 'b', unassigned: 'u' };

export function eventDrawing(seating: { layout: unknown }): Drawing & { width: number; height: number } {
  const layout = readLayout(seating.layout);
  return { width: layout.width, height: layout.height, ...drawingFor(layout) };
}

export type TierSummary = { id: number; name: string; color: string | null; seats: number; available: number; held: number; sold: number; blocked: number };

/** Per tier (and "not for sale" as id 0): how many seats and in which status. */
export function tierSummary(seats: EventSeat[], tiers: { id: number; name: string; seat_color: string | null }[]): TierSummary[] {
  const rows: TierSummary[] = tiers.map((t) => ({ id: t.id, name: t.name, color: t.seat_color, seats: 0, available: 0, held: 0, sold: 0, blocked: 0 }));
  const none: TierSummary = { id: 0, name: 'Not for sale', color: null, seats: 0, available: 0, held: 0, sold: 0, blocked: 0 };
  const by = new Map(rows.map((r) => [r.id, r]));
  for (const s of seats) {
    const r = (s.tier && by.get(s.tier)) || none;
    r.seats++;
    if (s.status === 'available') r.available++;
    else if (s.status === 'held') r.held++;
    else if (s.status === 'sold') r.sold++;
    else if (s.status === 'blocked') r.blocked++;
  }
  return none.seats ? [...rows, none] : rows;
}
