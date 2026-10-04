import 'server-only';
import { execute, query, queryOne, type Row } from '../db';
import { audit } from '../audit';
import { assertOrg, canAccessEvent, listMemberships, type OrgContext } from '../authz';
import type { CurrentSession } from '../auth/session';
import { getEvent, listTicketTypes, listVisibleEvents, orgOverview, type EventListRow } from '../events/queries';
import { checkinCounts, eventSalesSummary, getOrderByCode, listCheckinLog, listEventAttendees, listOrderRefunds, listOrgOrders, type OrderRow } from '../orders/queries';
import { sendOrderConfirmation } from '../orders/checkout';
import { sendTransferEmail } from '../orders/transfer';
import { formatEventDate } from '../tz';
import { uploadUrl } from '../uploads';
import { absoluteUrl } from './events';
import { mobileOrderDetail } from './orders';
import { ApiError } from './http';

/**
 * Organiser / staff management data for the app. Authorization is the website's: `assertOrg` resolves the
 * caller's role inside the organisation (org_admin, organizer, staff, or platform staff acting as one) and
 * `canAccessEvent` applies event assignments. Staff never receive money figures.
 */

export interface ManageOrg {
  slug: string; name: string; role: OrgContext['role']; status: string; logoUrl: string | null;
  perms: OrgContext['perms'];
  overview: { events: number; upcoming: number; paidOrders: number; grossCents: number; ticketsSold: number; checkedIn: number } | null;
}

export async function manageOverview(session: CurrentSession): Promise<{ orgs: ManageOrg[] }> {
  const memberships = await listMemberships(session.user.id);
  const orgs: ManageOrg[] = [];
  for (const m of memberships) {
    let ctx: OrgContext;
    try { ctx = await assertOrg(m.slug); } catch { continue; }
    orgs.push({
      slug: m.slug, name: m.name, role: ctx.role, status: m.status, logoUrl: absoluteUrl(uploadUrl(m.logo_path)), perms: ctx.perms,
      overview: ctx.role === 'staff' ? null : await orgOverview(ctx.org.id),
    });
  }
  return { orgs };
}

export interface ManageEventRow {
  id: number; slug: string; title: string; status: string; visibility: string; startsAt: string; when: string; timezone: string; venue: string | null;
  ticketsSold: number; capacity: number; checkedIn: number; grossCents: number | null; currency: string; imageUrl: string | null;
}

function eventRow(e: EventListRow, ctx: OrgContext): ManageEventRow {
  return {
    id: Number(e.id), slug: e.slug, title: e.title, status: e.status, visibility: e.visibility, startsAt: new Date(e.starts_at).toISOString(), when: formatEventDate(new Date(e.starts_at), e.timezone),
    timezone: e.timezone, venue: e.venue_name, ticketsSold: Number(e.tickets_sold), capacity: Number(e.capacity_total), checkedIn: Number(e.checked_in),
    grossCents: ctx.role === 'staff' ? null : Number(e.gross_cents), currency: e.currency, imageUrl: absoluteUrl(uploadUrl(e.image_path)),
  };
}

export async function manageEvents(orgSlug: string, filter: 'upcoming' | 'past' | 'all'): Promise<{ org: { slug: string; name: string; role: string }; events: ManageEventRow[] }> {
  const ctx = await assertOrg(orgSlug);
  const events = await listVisibleEvents(ctx, filter);
  return { org: { slug: ctx.org.slug, name: ctx.org.name, role: ctx.role }, events: events.map((e) => eventRow(e, ctx)) };
}

async function loadEvent(orgSlug: string, eventId: number, minimum: 'any' | 'organizer' = 'any'): Promise<{ ctx: OrgContext; event: EventListRow }> {
  const ctx = await assertOrg(orgSlug, minimum);
  const event = await getEvent(ctx.org.id, eventId);
  if (!event || !(await canAccessEvent(ctx, event))) throw new ApiError(404, 'Event not found.');
  return { ctx, event };
}

export async function manageEventDetail(orgSlug: string, eventId: number) {
  const { ctx, event } = await loadEvent(orgSlug, eventId);
  const staff = ctx.role === 'staff';
  const [counts, log, types, sales] = await Promise.all([
    checkinCounts(event.id), listCheckinLog(event.id, 20), listTicketTypes(event.id), staff ? null : eventSalesSummary(event.id),
  ]);
  return {
    event: eventRow(event, ctx),
    role: ctx.role,
    perms: { ...ctx.perms, canEdit: !staff, canChangeStatus: !staff && event.status !== 'cancelled' },
    counts,
    sales: sales && {
      paidOrders: sales.paidOrders, ticketsSold: sales.ticketsSold, grossCents: sales.grossCents, refundedCents: sales.refundedCents, netCents: sales.netCents,
      buyerFeesCents: sales.buyerFeesCents, absorbedFeesCents: sales.absorbedFeesCents, taxCents: sales.taxCents, payoutCents: sales.payoutCents, refundsCount: sales.refundsCount, compTickets: sales.compTickets,
    },
    ticketTypes: types.map((t) => ({ id: Number(t.id), name: t.name, kind: t.kind, priceCents: staff ? null : Number(t.price_cents), sold: Number(t.sold), quantity: Number(t.quantity), held: Number(t.held), hidden: !!t.hidden })),
    recentScans: log.map((l) => ({ id: Number(l.id), result: l.result, reason: l.reason, at: new Date(l.created_at).toISOString(), staff: l.staff_name, code: l.ticket_code, attendee: l.attendee_name })),
  };
}

/** Publish / unpublish / complete, the same rules as the organiser dashboard's status actions. */
export async function manageSetEventStatus(orgSlug: string, eventId: number, status: string): Promise<void> {
  const { ctx, event } = await loadEvent(orgSlug, eventId, 'organizer');
  if (!['draft', 'published', 'completed'].includes(status)) throw new ApiError(400, 'Invalid status.');
  if (status === 'published') {
    const tt = await queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM ticket_types WHERE event_id = ?`, [event.id]);
    if (!Number(tt?.n ?? 0)) throw new ApiError(400, 'Add at least one ticket type before publishing.');
    if (event.status === 'cancelled') throw new ApiError(400, 'A cancelled event cannot be re-published. Create a new event.');
  }
  await execute(`UPDATE events SET status = ? WHERE id = ?`, [status, event.id]);
  await audit(status === 'published' ? 'event.published' : status === 'draft' ? 'event.unpublished' : 'event.updated', { actorUserId: ctx.session.user.id, targetType: 'event', targetId: event.id, metadata: { status, client: 'mobile' } });
}

export interface ManageAttendee {
  ticketId: number; code: string; name: string | null; email: string | null; seatLabel: string | null; status: string; checkedInAt: string | null; checkedInBy: string | null;
  ticketType: string; dayLabel: string | null; orderCode: string; orderStatus: string; buyerEmail: string; buyerName: string | null; addons: string | null; transferred: boolean;
}

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

export interface ManageOrderRow { code: string; status: string; source: string; buyerEmail: string; buyerName: string | null; totalCents: number; refundedCents: number; currency: string; createdAt: string; eventTitle: string; eventId: number; ticketCount: number }

export async function manageOrders(orgSlug: string, q: string, eventId?: number): Promise<{ orders: ManageOrderRow[] }> {
  const ctx = await assertOrg(orgSlug, 'organizer');
  const rows = await listOrgOrders(ctx.org.id, q.slice(0, 120), eventId, 100);
  // Organisers limited to their own events only see those events' orders.
  const allowed = ctx.isOrgAdmin || ctx.perms.allEvents ? null : new Set((await listVisibleEvents(ctx, 'all')).map((e) => Number(e.id)));
  return {
    orders: rows.filter((r) => !allowed || allowed.has(Number(r.event_id))).map((r) => ({
      code: r.code, status: r.status, source: r.source, buyerEmail: r.buyer_email, buyerName: r.buyer_name, totalCents: Number(r.total_cents), refundedCents: Number(r.refunded_cents), currency: r.currency,
      createdAt: new Date(r.created_at).toISOString(), eventTitle: r.event_title, eventId: Number(r.event_id), ticketCount: Number(r.ticket_count),
    })),
  };
}

async function loadOrder(orgSlug: string, code: string): Promise<{ ctx: OrgContext; order: OrderRow }> {
  const ctx = await assertOrg(orgSlug, 'organizer');
  const order = await getOrderByCode(code);
  if (!order || Number(order.organization_id) !== Number(ctx.org.id)) throw new ApiError(404, 'Order not found.');
  const event = await getEvent(ctx.org.id, Number(order.event_id));
  if (!event || !(await canAccessEvent(ctx, event))) throw new ApiError(404, 'Order not found.');
  return { ctx, order };
}

export async function manageOrderDetail(orgSlug: string, code: string) {
  const { ctx, order } = await loadOrder(orgSlug, code);
  const [detail, refunds] = await Promise.all([mobileOrderDetail(order), listOrderRefunds(order.id)]);
  return {
    ...detail,
    buyerPhone: order.buyer_phone, source: order.source, createdAt: new Date(order.created_at).toISOString(), paidAt: order.paid_at ? new Date(order.paid_at).toISOString() : null,
    refunds: refunds.map((r) => ({ id: Number(r.id), amountCents: Number(r.amount_cents), reason: r.reason, kind: r.kind, status: r.status, at: new Date(r.created_at).toISOString(), by: r.initiated_by_name })),
    perms: { canRefund: ctx.perms.canRefund, canResend: ['paid', 'partially_refunded'].includes(order.status) },
  };
}

/** Email the buyer their tickets again (and transfer recipients theirs). */
export async function manageResendTickets(orgSlug: string, code: string): Promise<{ message: string }> {
  const { ctx, order } = await loadOrder(orgSlug, code);
  if (!['paid', 'partially_refunded'].includes(order.status)) throw new ApiError(400, 'Only paid orders have tickets to send.');
  await sendOrderConfirmation(order.id, { resend: true });
  const received = await query<Row & { id: number; attendee_email: string }>(
    `SELECT id, attendee_email FROM tickets WHERE order_id = ? AND status = 'valid' AND transferred_from_id IS NOT NULL AND attendee_email IS NOT NULL AND LOWER(attendee_email) <> LOWER(?)`,
    [order.id, order.buyer_email],
  );
  for (const t of received) await sendTransferEmail(Number(t.id), null);
  await audit('order.tickets_resent', { actorUserId: ctx.session.user.id, targetType: 'order', targetId: order.id, metadata: { recipients: received.map((t) => t.attendee_email), client: 'mobile' } });
  const others = new Set(received.map((t) => t.attendee_email.toLowerCase()));
  return { message: `Tickets re-sent to ${order.buyer_email}${others.size ? ` and ${others.size} transfer recipient${others.size === 1 ? '' : 's'}` : ''}.` };
}
