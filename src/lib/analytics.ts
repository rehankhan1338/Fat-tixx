import 'server-only';
import { query, queryOne, type Row } from './db';

/**
 * Advanced analytics & reporting (plan 5.2, Phase 2). Read-only aggregates over orders, tickets and
 * check-ins; every query is scoped to one event or one organization by the caller.
 */
const PAID = `o.status IN ('paid','partially_refunded')`;

export type DayPoint = { day: string; orders: number; tickets: number; revenue_cents: number };

/** Daily sales, oldest first, filling days with no sales so the chart's time axis is continuous. */
export async function salesByDay(scope: { eventId?: number; orgId?: number }, days = 30): Promise<DayPoint[]> {
  const where = scope.eventId ? 'o.event_id = ?' : 'o.organization_id = ?';
  const rows = await query<Row & { day: string; orders: number; tickets: number; revenue_cents: number }>(
    `SELECT DATE_FORMAT(o.paid_at, '%Y-%m-%d') AS day, COUNT(DISTINCT o.id) AS orders,
            COALESCE(SUM((SELECT SUM(oi.quantity) FROM order_items oi WHERE oi.order_id = o.id)),0) AS tickets,
            COALESCE(SUM(o.subtotal_cents),0) AS revenue_cents
       FROM orders o WHERE ${where} AND ${PAID} AND o.paid_at >= UTC_DATE() - INTERVAL ? DAY GROUP BY day`,
    [scope.eventId ?? scope.orgId!, days - 1],
  );
  const by = new Map(rows.map((r) => [r.day, r]));
  const out: DayPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    const r = by.get(d);
    out.push({ day: d, orders: Number(r?.orders ?? 0), tickets: Number(r?.tickets ?? 0), revenue_cents: Number(r?.revenue_cents ?? 0) });
  }
  return out;
}

export async function ticketTypeBreakdown(eventId: number) {
  return query<Row & { name: string; sold: number; quantity: number; seats: number; revenue_cents: number; discount_cents: number }>(
    `SELECT t.name, t.sold, t.quantity, t.seats_per_unit AS seats,
            (SELECT COALESCE(SUM(oi.quantity * oi.unit_price_cents),0) FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.ticket_type_id = t.id AND ${PAID}) AS revenue_cents,
            (SELECT COALESCE(SUM(oi.quantity * oi.unit_discount_cents),0) FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.ticket_type_id = t.id AND ${PAID}) AS discount_cents
       FROM ticket_types t WHERE t.event_id = ? ORDER BY t.sort_order, t.id`, [eventId],
  );
}

/** Checkout funnel: reservations started vs. completed vs. abandoned (hold expired). */
export async function checkoutFunnel(eventId: number) {
  const r = await queryOne<Row & { started: number; paid: number; abandoned: number; refunded: number; online: number; box_office: number; comps: number; embed: number }>(
    `SELECT COUNT(*) AS started, SUM(${PAID}) AS paid, SUM(o.status = 'expired') AS abandoned, SUM(o.status = 'refunded') AS refunded,
            SUM(${PAID} AND o.source = 'online') AS online, SUM(${PAID} AND o.source = 'box_office') AS box_office, SUM(${PAID} AND o.source = 'complimentary') AS comps,
            SUM(${PAID} AND o.channel = 'embed') AS embed
       FROM orders o WHERE o.event_id = ?`, [eventId],
  );
  const n = (k: keyof NonNullable<typeof r>) => Number(r?.[k] ?? 0);
  return { started: n('started'), paid: n('paid'), abandoned: n('abandoned'), refunded: n('refunded'), online: n('online'), boxOffice: n('box_office'), comps: n('comps'), embed: n('embed') };
}

/** Buyer metrics: average order value, tickets per order, returning buyers (bought another event of the same organization). */
export async function buyerMetrics(eventId: number) {
  const r = await queryOne<Row & { orders: number; revenue: number; tickets: number; returning_buyers: number; opted_in: number }>(
    `SELECT COUNT(*) AS orders, COALESCE(SUM(o.subtotal_cents),0) AS revenue,
            COALESCE(SUM((SELECT SUM(oi.quantity) FROM order_items oi WHERE oi.order_id = o.id)),0) AS tickets,
            SUM(EXISTS (SELECT 1 FROM orders p WHERE p.buyer_email = o.buyer_email AND p.organization_id = o.organization_id AND p.event_id <> o.event_id AND p.status IN ('paid','partially_refunded'))) AS returning_buyers,
            SUM(o.marketing_opt_in) AS opted_in
       FROM orders o WHERE o.event_id = ? AND ${PAID}`, [eventId],
  );
  const orders = Number(r?.orders ?? 0);
  return {
    orders, avgOrderCents: orders ? Math.round(Number(r?.revenue ?? 0) / orders) : 0, ticketsPerOrder: orders ? Number(r?.tickets ?? 0) / orders : 0,
    returning: Number(r?.returning_buyers ?? 0), optedIn: Number(r?.opted_in ?? 0),
  };
}

/** Check-ins in 15-minute buckets (event time zone), for door staffing. */
export async function checkinsByQuarterHour(eventId: number, timezone: string) {
  const rows = await query<Row & { t: Date }>(`SELECT checked_in_at AS t FROM tickets WHERE event_id = ? AND checked_in_at IS NOT NULL ORDER BY checked_in_at`, [eventId]);
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: timezone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const buckets = new Map<number, number>();
  for (const r of rows) {
    const q = Math.floor(new Date(r.t).getTime() / 900_000) * 900_000;
    buckets.set(q, (buckets.get(q) ?? 0) + 1);
  }
  if (!buckets.size) return [];
  const keys = [...buckets.keys()];
  const first = Math.min(...keys), last = Math.max(...keys);
  const out: { label: string; value: number }[] = [];
  // Continuous axis, capped at 2 days of quarter hours.
  for (let t = first; t <= last && out.length < 192; t += 900_000) out.push({ label: fmt.format(new Date(t)), value: buckets.get(t) ?? 0 });
  return out;
}

/** Organization overview: per-event performance. */
export async function orgEventPerformance(orgId: number) {
  return query<Row & { id: number; title: string; starts_at: Date; timezone: string; currency: string; status: string; sold: number; capacity: number; revenue_cents: number; orders: number; checked_in: number }>(
    `SELECT e.id, e.title, e.starts_at, e.timezone, e.currency, e.status,
            (SELECT COALESCE(SUM(t.sold * t.seats_per_unit),0) FROM ticket_types t WHERE t.event_id = e.id) AS sold,
            (SELECT COALESCE(SUM(t.quantity * t.seats_per_unit),0) FROM ticket_types t WHERE t.event_id = e.id) AS capacity,
            (SELECT COALESCE(SUM(o.subtotal_cents - o.refunded_cents),0) FROM orders o WHERE o.event_id = e.id AND ${PAID}) AS revenue_cents,
            (SELECT COUNT(*) FROM orders o WHERE o.event_id = e.id AND ${PAID}) AS orders,
            (SELECT COUNT(*) FROM tickets k WHERE k.event_id = e.id AND k.checked_in_at IS NOT NULL) AS checked_in
       FROM events e WHERE e.organization_id = ? ORDER BY e.starts_at DESC LIMIT 100`, [orgId],
  );
}
