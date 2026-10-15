import 'server-only';
import { assertOrg, canAccessEvent, type OrgContext } from '../authz';
import { getEvent, listTicketTypes, type EventListRow } from '../events/queries';
import { checkinCounts, listCheckinLog, listEventAttendees } from '../orders/queries';
import { formatEventDate } from '../tz';
import { ApiError } from './http';

/**
 * Event check-in data for the app (the Scan Manager). Authorization is the website's: `assertOrg` resolves
 * the caller's role inside the organisation and `canAccessEvent` applies event assignments, so an
 * Organization Admin reaches every event and organizers / staff only theirs. No money figures leave here:
 * sales, prices, orders and settlement stay on the website for every role.
 */

export interface ManageEventRow {
  id: number; slug: string; title: string; status: string; visibility: string; startsAt: string; when: string; timezone: string; venue: string | null;
  ticketsSold: number; capacity: number; checkedIn: number;
}

function eventRow(e: EventListRow): ManageEventRow {
  return {
    id: Number(e.id), slug: e.slug, title: e.title, status: e.status, visibility: e.visibility, startsAt: new Date(e.starts_at).toISOString(), when: formatEventDate(new Date(e.starts_at), e.timezone),
    timezone: e.timezone, venue: e.venue_name, ticketsSold: Number(e.tickets_sold), capacity: Number(e.capacity_total), checkedIn: Number(e.checked_in),
  };
}

async function loadEvent(orgSlug: string, eventId: number): Promise<{ ctx: OrgContext; event: EventListRow }> {
  const ctx = await assertOrg(orgSlug);
  const event = await getEvent(ctx.org.id, eventId);
  if (!event || !(await canAccessEvent(ctx, event))) throw new ApiError(404, 'Event not found.');
  return { ctx, event };
}

/** Live counts, ticket types (issued / quantity, no prices), recent scans, and what this member may do at the door. */
export async function manageEventDetail(orgSlug: string, eventId: number) {
  const { ctx, event } = await loadEvent(orgSlug, eventId);
  const [counts, log, types] = await Promise.all([checkinCounts(event.id), listCheckinLog(event.id, 20), listTicketTypes(event.id)]);
  return {
    event: eventRow(event),
    role: ctx.role,
    perms: { canOverrideCheckin: ctx.perms.canOverrideCheckin, canUndoCheckin: ctx.perms.canUndoCheckin },
    counts,
    ticketTypes: types.map((t) => ({ id: Number(t.id), name: t.name, kind: t.kind, sold: Number(t.sold), quantity: Number(t.quantity), held: Number(t.held), hidden: !!t.hidden })),
    recentScans: log.map((l) => ({ id: Number(l.id), result: l.result, reason: l.reason, at: new Date(l.created_at).toISOString(), staff: l.staff_name, code: l.ticket_code, attendee: l.attendee_name })),
  };
}

export interface ManageAttendee {
  ticketId: number; code: string; name: string | null; email: string | null; seatLabel: string | null; status: string; checkedInAt: string | null; checkedInBy: string | null;
  ticketType: string; dayLabel: string | null; orderCode: string; orderStatus: string; buyerEmail: string; buyerName: string | null; addons: string | null; transferred: boolean;
}

/** The door list: the entry details of every ticket, searchable by name, email, ticket or order code. */
export async function manageAttendees(orgSlug: string, eventId: number, q: string): Promise<{ attendees: ManageAttendee[]; total: number }> {
  const { event } = await loadEvent(orgSlug, eventId);
  const rows = await listEventAttendees(event.id);
  const needle = q.trim().toLowerCase();
  const filtered = needle
    ? rows.filter((r) => `${r.attendee_name ?? ''} ${r.attendee_email ?? ''} ${r.buyer_name ?? ''} ${r.buyer_email} ${r.ticket_code} ${r.order_code}`.toLowerCase().includes(needle))
    : rows;
  return {
    total: rows.length,
    attendees: filtered.slice(0, 300).map((r) => ({
      ticketId: Number(r.ticket_id), code: r.ticket_code, name: r.attendee_name, email: r.attendee_email, seatLabel: r.seat_label, status: r.ticket_status,
      checkedInAt: r.checked_in_at ? new Date(r.checked_in_at).toISOString() : null, checkedInBy: r.checked_in_by_name, ticketType: r.ticket_type_name, dayLabel: r.day_label,
      orderCode: r.order_code, orderStatus: r.order_status, buyerEmail: r.buyer_email, buyerName: r.buyer_name, addons: r.addons, transferred: r.transferred_from_id != null,
    })),
  };
}
