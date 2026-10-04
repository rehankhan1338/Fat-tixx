import 'server-only';
import { listOrderAddons, listOrderItems, listOrderTickets, ticketDayLabel, type OrderListRow, type OrderRow } from '../orders/queries';
import { attendeeMayRequestRefund, holdExpired } from '../orders/checkout';
import { heldByRecipient, holderMayTransfer } from '../orders/transfer';
import { signTicket, ticketUrl } from '../tickets';
import { formatEventDate } from '../tz';

/**
 * Order and ticket data for the app. The QR payload is the same signed string the website renders as
 * an image (FTX1.<code>.<secret>.<sig>); the app draws it locally, so tickets open instantly and offline.
 * It is only ever returned for an order the caller has proven access to (see orders/access.ts).
 */
export interface MobileTicket {
  id: number; code: string; type: string; status: string; seatLabel: string | null; dayLabel: string | null; attendeeName: string | null;
  qr: string | null;            // signed payload for valid/used tickets the buyer still holds
  webUrl: string | null;        // full-screen ticket page on the website
  transferredTo: string | null; // name/email when the buyer gave this ticket away
}

export interface MobileOrderDetail {
  code: string; status: string; currency: string; buyerEmail: string; buyerName: string | null;
  totals: { subtotalCents: number; discountCents: number; platformFeeCents: number; processingFeeCents: number; taxCents: number; totalCents: number; refundedCents: number };
  items: { id: number; name: string; quantity: number; unitCents: number; lineCents: number }[];
  addons: { id: number; name: string; quantity: number; unitCents: number; lineCents: number }[];
  tickets: MobileTicket[];
  event: { slug: string; key: string | null; title: string; startsAt: string; when: string; timezone: string; venue: string | null; ageRestriction: number | null; organizer: string; refundPolicy: string };
  holdExpiresAt: string | null;
  expired: boolean;
  mayRefund: boolean;
  mayTransfer: boolean;
}

export async function mobileOrderDetail(order: OrderRow): Promise<MobileOrderDetail> {
  const [items, addons, allTickets] = await Promise.all([listOrderItems(order.id), listOrderAddons(order.id), listOrderTickets(order.id)]);
  const tickets = allTickets.filter((t) => t.status !== 'transferred').map<MobileTicket>((t) => {
    const given = heldByRecipient(t, order.buyer_email);
    const live = ['valid', 'used'].includes(t.status) && !given;
    return {
      id: Number(t.id), code: t.code, type: t.ticket_type_name, status: t.status, seatLabel: t.seat_label, dayLabel: ticketDayLabel(t, order.event_timezone), attendeeName: t.attendee_name,
      qr: live ? signTicket(t.code, t.secret) : null, webUrl: live ? ticketUrl(t.code, t.secret) : null, transferredTo: given ? t.attendee_name ?? t.attendee_email : null,
    };
  });
  return {
    code: order.code, status: order.status, currency: order.currency, buyerEmail: order.buyer_email, buyerName: order.buyer_name,
    totals: {
      subtotalCents: Number(order.subtotal_cents), discountCents: Number(order.discount_cents), platformFeeCents: Number(order.platform_fee_cents),
      processingFeeCents: Number(order.processing_fee_cents), taxCents: Number(order.tax_cents), totalCents: Number(order.total_cents), refundedCents: Number(order.refunded_cents),
    },
    items: items.map((i) => { const unit = Number(i.unit_price_cents) + Number(i.unit_discount_cents ?? 0); return { id: Number(i.id), name: i.ticket_type_name, quantity: Number(i.quantity), unitCents: unit, lineCents: unit * Number(i.quantity) }; }),
    addons: addons.map((a) => ({ id: Number(a.id), name: a.addon_name, quantity: Number(a.quantity), unitCents: Number(a.unit_price_cents), lineCents: Number(a.unit_price_cents) * Number(a.quantity) })),
    tickets,
    event: {
      slug: order.event_slug, key: order.event_visibility === 'private' ? order.event_private_key : null, title: order.event_title, startsAt: new Date(order.event_starts_at).toISOString(),
      when: formatEventDate(new Date(order.event_starts_at), order.event_timezone), timezone: order.event_timezone, venue: order.venue_name, ageRestriction: order.age_restriction, organizer: order.org_name, refundPolicy: order.refund_policy,
    },
    holdExpiresAt: order.hold_expires_at ? new Date(order.hold_expires_at).toISOString() : null,
    expired: order.status === 'pending' && holdExpired(order),
    mayRefund: attendeeMayRequestRefund(order),
    mayTransfer: !holderMayTransfer(order),
  };
}

export interface MobileOrderSummary { code: string; status: string; eventTitle: string; eventId: number; ticketCount: number; totalCents: number; currency: string; paidAt: string | null; createdAt: string; organizer: string }

export function mobileOrderSummary(o: OrderListRow): MobileOrderSummary {
  return {
    code: o.code, status: o.status, eventTitle: o.event_title, eventId: Number(o.event_id), ticketCount: Number(o.ticket_count), totalCents: Number(o.total_cents), currency: o.currency,
    paidAt: o.paid_at ? new Date(o.paid_at).toISOString() : null, createdAt: new Date(o.created_at).toISOString(), organizer: o.org_name,
  };
}
