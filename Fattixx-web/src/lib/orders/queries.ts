import 'server-only';
import { query, queryOne, type Row } from '../db';

export type OrderRow = Row & {
  id: number; code: string; access_token_hash: string; organization_id: number; event_id: number; user_id: number | null;
  buyer_email: string; buyer_name: string | null; buyer_phone: string | null; checkout_answer: string | null; marketing_opt_in: number; sms_opt_in: number; channel: string; utm_source: string | null; tracking_link_id: number | null;
  status: 'pending' | 'paid' | 'expired' | 'cancelled' | 'refunded' | 'partially_refunded'; source: 'online' | 'box_office' | 'complimentary';
  currency: string; subtotal_cents: number; discount_cents: number; promo_code_id: number | null; platform_fee_cents: number; processing_fee_cents: number; tax_cents: number; total_cents: number;
  absorbed_fee_cents: number; refunded_cents: number; fee_mode: 'buyer_pays' | 'organizer_absorbs'; hold_expires_at: Date | null; paid_at: Date | null;
  stripe_payment_intent_id: string | null; stripe_charge_id: string | null; created_at: Date;
  event_title: string; event_slug: string; event_starts_at: Date; event_timezone: string; event_status: string; event_visibility: string; event_private_key: string | null; venue_name: string | null;
  org_name: string; org_slug: string; refund_policy: string; refund_days_before: number | null; allow_transfers: number; age_restriction: number | null;
};

export type OrderItemRow = Row & { id: number; ticket_type_id: number; ticket_type_name: string; quantity: number; unit_price_cents: number; unit_discount_cents: number; unit_platform_fee_cents: number; unit_tax_cents: number };
export type OrderAddonRow = Row & { id: number; addon_id: number; addon_name: string; quantity: number; unit_price_cents: number; unit_platform_fee_cents: number; unit_tax_cents: number };
export type OrderAnswerRow = Row & { id: number; question_id: number | null; question_label: string; answer: string };
export type TicketRow = Row & {
  id: number; code: string; secret: string; order_item_id: number; ticket_type_id: number; ticket_type_name: string; attendee_name: string | null; attendee_email: string | null;
  seat_label: string | null; status: string; checked_in_at: Date | null; day_label: string | null; day_starts_at: Date | null; transferred_from_id: number | null;
};

/** "Day 2" / "Sat, Jun 6" label for a ticket that is valid on one day of a multi-day event; null for passes and single-day events. */
export function ticketDayLabel(t: { day_label: string | null; day_starts_at: Date | null }, timezone: string): string | null {
  if (t.day_label) return t.day_label;
  if (!t.day_starts_at) return null;
  return new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(t.day_starts_at));
}

/** Query fragment: a day-specific ticket type's label, or NULL when valid every day. */
const DAY_LABEL_SQL = `COALESCE(d.label, DATE_FORMAT(d.starts_at, '%a, %b %e')) AS day_label, d.starts_at AS day_starts_at`;

const ORDER_SELECT = `
  SELECT o.*, e.title AS event_title, e.slug AS event_slug, e.starts_at AS event_starts_at, e.timezone AS event_timezone, e.status AS event_status, e.visibility AS event_visibility, e.private_key AS event_private_key,
         e.refund_policy, e.refund_days_before, e.allow_transfers, e.age_restriction, v.name AS venue_name, g.name AS org_name, g.slug AS org_slug
    FROM orders o JOIN events e ON e.id = o.event_id JOIN organizations g ON g.id = o.organization_id LEFT JOIN venues v ON v.id = e.venue_id`;

export async function getOrderByCode(code: string): Promise<OrderRow | null> {
  if (!/^[A-Z0-9-]{6,12}$/.test(code)) return null;
  return queryOne<OrderRow>(`${ORDER_SELECT} WHERE o.code = ?`, [code]);
}

export async function getOrderById(id: number): Promise<OrderRow | null> {
  return queryOne<OrderRow>(`${ORDER_SELECT} WHERE o.id = ?`, [id]);
}

export async function listOrderItems(orderId: number): Promise<OrderItemRow[]> {
  return query<OrderItemRow>(`SELECT * FROM order_items WHERE order_id = ? ORDER BY id`, [orderId]);
}

export async function listOrderAddons(orderId: number): Promise<OrderAddonRow[]> {
  return query<OrderAddonRow>(`SELECT * FROM order_addons WHERE order_id = ? ORDER BY id`, [orderId]);
}

export async function listOrderAnswers(orderId: number): Promise<OrderAnswerRow[]> {
  return query<OrderAnswerRow>(`SELECT * FROM order_answers WHERE order_id = ? ORDER BY id`, [orderId]);
}

export async function listOrderTickets(orderId: number): Promise<TicketRow[]> {
  return query<TicketRow>(
    `SELECT k.*, t.name AS ticket_type_name, ${DAY_LABEL_SQL} FROM tickets k JOIN ticket_types t ON t.id = k.ticket_type_id LEFT JOIN event_dates d ON d.id = t.event_date_id
      WHERE k.order_id = ? ORDER BY k.id`, [orderId],
  );
}

export type TicketDetailRow = TicketRow & OrderRow & { ticket_id: number; ticket_code: string; ticket_status: string; ticket_order_id: number; order_code: string; venue_address: string | null; venue_city: string | null; venue_region: string | null; doors_at: Date | null };

export async function getTicketByCode(code: string): Promise<TicketDetailRow | null> {
  if (!/^[A-Z0-9]{12}$/.test(code)) return null;
  return queryOne<TicketDetailRow>(
    `SELECT k.id AS ticket_id, k.code AS ticket_code, k.status AS ticket_status, k.order_id AS ticket_order_id, k.transferred_from_id, k.secret, k.attendee_name, k.attendee_email, k.seat_label, k.checked_in_at, k.ticket_type_id, k.order_item_id,
            t.name AS ticket_type_name, ${DAY_LABEL_SQL}, o.code AS order_code, o.buyer_email, o.buyer_name, o.status, o.currency, o.event_id, o.organization_id, o.user_id,
            e.title AS event_title, e.slug AS event_slug, e.starts_at AS event_starts_at, e.doors_at, e.timezone AS event_timezone, e.status AS event_status, e.age_restriction, e.allow_transfers,
            v.name AS venue_name, v.address_line1 AS venue_address, v.city AS venue_city, v.region AS venue_region, g.name AS org_name, g.slug AS org_slug
       FROM tickets k JOIN ticket_types t ON t.id = k.ticket_type_id LEFT JOIN event_dates d ON d.id = t.event_date_id JOIN orders o ON o.id = k.order_id JOIN events e ON e.id = k.event_id
       JOIN organizations g ON g.id = e.organization_id LEFT JOIN venues v ON v.id = e.venue_id
      WHERE k.code = ?`,
    [code],
  );
}

export type AttendeeRow = Row & {
  ticket_id: number; ticket_code: string; attendee_name: string | null; attendee_email: string | null; seat_label: string | null; ticket_status: string; checked_in_at: Date | null;
  ticket_type_name: string; day_label: string | null; order_code: string; order_status: string; buyer_email: string; buyer_name: string | null; source: string; checked_in_by_name: string | null;
  addons: string | null; transferred_from_id: number | null;
};

export async function listEventAttendees(eventId: number): Promise<AttendeeRow[]> {
  return query<AttendeeRow>(
    `SELECT k.id AS ticket_id, k.code AS ticket_code, k.attendee_name, k.attendee_email, k.seat_label, k.status AS ticket_status, k.checked_in_at, k.transferred_from_id,
            t.name AS ticket_type_name, COALESCE(d.label, DATE_FORMAT(d.starts_at, '%a, %b %e')) AS day_label,
            o.code AS order_code, o.status AS order_status, o.buyer_email, o.buyer_name, o.source, u.name AS checked_in_by_name,
            (SELECT GROUP_CONCAT(CONCAT(oa.quantity, ' × ', oa.addon_name) SEPARATOR ', ') FROM order_addons oa WHERE oa.order_id = o.id) AS addons
       FROM tickets k JOIN ticket_types t ON t.id = k.ticket_type_id LEFT JOIN event_dates d ON d.id = t.event_date_id JOIN orders o ON o.id = k.order_id LEFT JOIN users u ON u.id = k.checked_in_by
      WHERE k.event_id = ? ORDER BY COALESCE(k.attendee_name, o.buyer_name, o.buyer_email), k.id`,
    [eventId],
  );
}

export interface SalesSummary {
  paidOrders: number; ticketsSold: number; grossCents: number; refundedCents: number; netCents: number;
  buyerFeesCents: number; absorbedFeesCents: number; processingFeesCents: number; taxCents: number; payoutCents: number; byType: { name: string; sold: number; grossCents: number }[];
  byAddon: { name: string; sold: number; grossCents: number }[]; addonGrossCents: number;
  refundsCount: number; compTickets: number;
}

/** Per-event settlement numbers: gross, fees, tax, refunds, net payout. */
export async function eventSalesSummary(eventId: number): Promise<SalesSummary> {
  const totals = await queryOne<Row & { orders: number; gross: number; refunded: number; buyer_fees: number; absorbed: number; processing: number; tax: number }>(
    `SELECT COUNT(*) AS orders, COALESCE(SUM(subtotal_cents),0) AS gross, COALESCE(SUM(refunded_cents),0) AS refunded,
            COALESCE(SUM(platform_fee_cents),0) AS buyer_fees, COALESCE(SUM(absorbed_fee_cents),0) AS absorbed,
            COALESCE(SUM(processing_fee_cents),0) AS processing, COALESCE(SUM(tax_cents),0) AS tax
       FROM orders WHERE event_id = ? AND status IN ('paid','partially_refunded','refunded')`,
    [eventId],
  );
  const sold = await queryOne<Row & { n: number; comps: number }>(
    `SELECT COUNT(*) AS n, SUM(CASE WHEN o.source = 'complimentary' THEN 1 ELSE 0 END) AS comps FROM tickets k JOIN orders o ON o.id = k.order_id WHERE k.event_id = ? AND k.status IN ('valid','used')`, [eventId],
  );
  const refunds = await queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM refunds r JOIN orders o ON o.id = r.order_id WHERE o.event_id = ? AND r.status = 'succeeded'`, [eventId]);
  const byType = await query<Row & { name: string; sold: number; gross: number }>(
    `SELECT t.name, t.sold, COALESCE(SUM(oi.quantity * oi.unit_price_cents),0) AS gross
       FROM ticket_types t LEFT JOIN order_items oi ON oi.ticket_type_id = t.id LEFT JOIN orders o ON o.id = oi.order_id AND o.status IN ('paid','partially_refunded')
      WHERE t.event_id = ? GROUP BY t.id ORDER BY t.sort_order, t.id`,
    [eventId],
  );
  const byAddon = await query<Row & { name: string; sold: number; gross: number }>(
    `SELECT a.name, a.sold, COALESCE(SUM(oa.quantity * oa.unit_price_cents),0) AS gross
       FROM event_addons a LEFT JOIN order_addons oa ON oa.addon_id = a.id LEFT JOIN orders o ON o.id = oa.order_id AND o.status IN ('paid','partially_refunded')
      WHERE a.event_id = ? GROUP BY a.id ORDER BY a.sort_order, a.id`,
    [eventId],
  );
  const gross = Number(totals?.gross ?? 0), refunded = Number(totals?.refunded ?? 0), absorbed = Number(totals?.absorbed ?? 0), tax = Number(totals?.tax ?? 0);
  // Payout = ticket + add-on revenue (subtotal) − refunds − fees the organizer absorbed. Buyer-paid fees and tax are not organizer money.
  return {
    paidOrders: Number(totals?.orders ?? 0), ticketsSold: Number(sold?.n ?? 0), grossCents: gross, refundedCents: refunded, netCents: gross - refunded,
    buyerFeesCents: Number(totals?.buyer_fees ?? 0), absorbedFeesCents: absorbed, processingFeesCents: Number(totals?.processing ?? 0), taxCents: tax,
    payoutCents: Math.max(0, gross - refunded - absorbed), byType: byType.map((r) => ({ name: r.name, sold: Number(r.sold), grossCents: Number(r.gross) })),
    byAddon: byAddon.map((r) => ({ name: r.name, sold: Number(r.sold), grossCents: Number(r.gross) })), addonGrossCents: byAddon.reduce((n, r) => n + Number(r.gross), 0),
    refundsCount: Number(refunds?.n ?? 0), compTickets: Number(sold?.comps ?? 0),
  };
}

export type OrderListRow = Row & { id: number; code: string; buyer_email: string; buyer_name: string | null; status: string; source: string; total_cents: number; refunded_cents: number; currency: string; created_at: Date; paid_at: Date | null; event_title: string; event_id: number; ticket_count: number; org_name: string; org_slug: string };

const ORDER_LIST = `
  SELECT o.id, o.code, o.buyer_email, o.buyer_name, o.status, o.source, o.total_cents, o.refunded_cents, o.currency, o.created_at, o.paid_at,
         e.title AS event_title, e.id AS event_id, g.name AS org_name, g.slug AS org_slug,
         (SELECT COUNT(*) FROM tickets k WHERE k.order_id = o.id) AS ticket_count
    FROM orders o JOIN events e ON e.id = o.event_id JOIN organizations g ON g.id = o.organization_id`;

export const ORDER_SORTS = {
  newest: { label: 'Date: newest first', sql: 'COALESCE(o.paid_at, o.created_at) DESC, o.id DESC' },
  oldest: { label: 'Date: oldest first', sql: 'COALESCE(o.paid_at, o.created_at) ASC, o.id ASC' },
  name_asc: { label: 'Buyer name: A–Z', sql: 'COALESCE(NULLIF(o.buyer_name, \'\'), o.buyer_email) ASC, o.id DESC' },
  name_desc: { label: 'Buyer name: Z–A', sql: 'COALESCE(NULLIF(o.buyer_name, \'\'), o.buyer_email) DESC, o.id DESC' },
} as const;
export type OrderSort = keyof typeof ORDER_SORTS;

export interface OrgOrderFilters { search?: string; eventId?: number; from?: string; to?: string; sort?: OrderSort; limit?: number }

/** `from` / `to` are YYYY-MM-DD, inclusive, matched against the paid date (or created date for unpaid orders). */
/** Shared WHERE builder. `from` / `to` are YYYY-MM-DD, inclusive, matched against the paid date (or created date for unpaid orders). */
function orderWhere(f: OrgOrderFilters, orgId?: number): { sql: string; params: (string | number)[] } {
  const search = f.search ?? '';
  const like = `%${search}%`;
  const conds = [`o.status <> 'expired'`];
  const params: (string | number)[] = [];
  if (orgId) { conds.push('o.organization_id = ?'); params.push(orgId); }
  if (f.eventId) { conds.push('o.event_id = ?'); params.push(f.eventId); }
  if (f.from) { conds.push('COALESCE(o.paid_at, o.created_at) >= ?'); params.push(f.from); }
  if (f.to) { conds.push('COALESCE(o.paid_at, o.created_at) < ? + INTERVAL 1 DAY'); params.push(f.to); }
  conds.push(`(? = '' OR o.code LIKE ? OR o.buyer_email LIKE ? OR o.buyer_name LIKE ? OR EXISTS (SELECT 1 FROM tickets k WHERE k.order_id = o.id AND (k.attendee_name LIKE ? OR k.code LIKE ?)))`);
  params.push(search, like, like, like, like, like);
  return { sql: `WHERE ${conds.join(' AND ')}`, params };
}

export async function listOrgOrders(orgId: number, f: OrgOrderFilters = {}): Promise<OrderListRow[]> {
  const w = orderWhere(f, orgId);
  return query<OrderListRow>(`${ORDER_LIST} ${w.sql} ORDER BY ${ORDER_SORTS[f.sort ?? 'newest'].sql} LIMIT ?`, [...w.params, f.limit ?? 200]);
}

export async function searchAllOrders(f: OrgOrderFilters = {}, limit = 50, offset = 0): Promise<OrderListRow[]> {
  const w = orderWhere(f);
  return query<OrderListRow>(`${ORDER_LIST} ${w.sql} ORDER BY ${ORDER_SORTS[f.sort ?? 'newest'].sql} LIMIT ? OFFSET ?`, [...w.params, limit, offset]);
}

export async function countAllOrders(f: OrgOrderFilters = {}): Promise<number> {
  const w = orderWhere(f);
  const r = await queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM orders o ${w.sql}`, w.params);
  return Number(r?.n ?? 0);
}

/** Every event on the platform, for the admin order filter. */
export async function listEventsForFilter(): Promise<{ id: number; title: string; org_name: string }[]> {
  return query<Row & { id: number; title: string; org_name: string }>(
    `SELECT e.id, e.title, g.name AS org_name FROM events e JOIN organizations g ON g.id = e.organization_id ORDER BY e.starts_at DESC LIMIT 500`,
  );
}

/** Every order placed by an account (all statuses), newest first. Matches the per-user order count on /admin/users. */
export async function listOrdersForUser(userId: number, limit = 200): Promise<OrderListRow[]> {
  return query<OrderListRow>(`${ORDER_LIST} WHERE o.user_id = ? ORDER BY o.id DESC LIMIT ?`, [userId, limit]);
}

/** Orders for a verified email address and/or an account. Pass email = null for an account whose email is not verified yet. */
export async function listOrdersForEmail(email: string | null, userId: number | null): Promise<OrderListRow[]> {
  const conds: string[] = []; const params: (string | number)[] = [];
  if (email) { conds.push('o.buyer_email = ?'); params.push(email.toLowerCase()); }
  if (userId) { conds.push('o.user_id = ?'); params.push(userId); }
  if (!conds.length) return [];
  return query<OrderListRow>(`${ORDER_LIST} WHERE o.status IN ('paid','partially_refunded','refunded','cancelled') AND (${conds.join(' OR ')}) ORDER BY e.starts_at DESC`, params);
}

export type RefundRow = Row & { id: number; amount_cents: number; reason: string; kind: string; status: string; stripe_refund_id: string | null; created_at: Date; initiated_by_name: string | null };
export async function listOrderRefunds(orderId: number): Promise<RefundRow[]> {
  return query<RefundRow>(`SELECT r.*, u.name AS initiated_by_name FROM refunds r LEFT JOIN users u ON u.id = r.initiated_by WHERE r.order_id = ? ORDER BY r.id`, [orderId]);
}

export type CheckinLogRow = Row & { id: number; result: string; reason: string | null; created_at: Date; staff_name: string | null; ticket_code: string | null; attendee_name: string | null };
export async function listCheckinLog(eventId: number, limit = 50): Promise<CheckinLogRow[]> {
  return query<CheckinLogRow>(
    `SELECT c.id, c.result, c.reason, c.created_at, u.name AS staff_name, k.code AS ticket_code, k.attendee_name
       FROM checkin_log c LEFT JOIN users u ON u.id = c.staff_user_id LEFT JOIN tickets k ON k.id = c.ticket_id
      WHERE c.event_id = ? ORDER BY c.id DESC LIMIT ?`,
    [eventId, limit],
  );
}

export async function checkinCounts(eventId: number): Promise<{ total: number; used: number }> {
  const r = await queryOne<Row & { total: number; used: number }>(
    `SELECT SUM(CASE WHEN status IN ('valid','used') THEN 1 ELSE 0 END) AS total, SUM(CASE WHEN status = 'used' THEN 1 ELSE 0 END) AS used FROM tickets WHERE event_id = ?`, [eventId],
  );
  return { total: Number(r?.total ?? 0), used: Number(r?.used ?? 0) };
}
