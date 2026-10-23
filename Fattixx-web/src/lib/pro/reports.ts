import 'server-only';
import { query, type Row } from '../db';

/**
 * Fattixx Pro advanced reports (plan 5.7.2): refund trends, where attendees are from, and events side by side.
 * Read-only aggregates, always scoped to one organization (and optionally the events the member may see).
 */
const PAID = `o.status IN ('paid','partially_refunded','refunded')`;
const marks = (n: number) => Array(n).fill('?').join(',');
const scopeSql = (eventIds: number[] | null) => (eventIds ? (eventIds.length ? ` AND o.event_id IN (${marks(eventIds.length)})` : ' AND 1=0') : '');

// ---------------------------------------------------------------------------
// Refund trends
// ---------------------------------------------------------------------------
export type RefundMonth = { month: string; grossCents: number; refundedCents: number; refunds: number; orders: number; rate: number };

/** The last `months` months: gross sales (by payment month), refunds (by refund month) and the refund rate. */
export async function refundTrend(orgId: number, eventIds: number[] | null, months = 12): Promise<RefundMonth[]> {
  const scope = scopeSql(eventIds);
  const params = eventIds ?? [];
  const [sales, refunds] = await Promise.all([
    query<Row & { m: string; gross: number; orders: number }>(
      `SELECT DATE_FORMAT(o.paid_at, '%Y-%m') AS m, COALESCE(SUM(o.total_cents),0) AS gross, COUNT(*) AS orders FROM orders o
        WHERE o.organization_id = ? AND ${PAID}${scope} AND o.paid_at >= DATE_FORMAT(NOW() - INTERVAL ? MONTH, '%Y-%m-01') GROUP BY DATE_FORMAT(o.paid_at, '%Y-%m')`,
      [orgId, ...params, months - 1],
    ),
    query<Row & { m: string; amount: number; n: number }>(
      `SELECT DATE_FORMAT(r.created_at, '%Y-%m') AS m, COALESCE(SUM(r.amount_cents),0) AS amount, COUNT(*) AS n FROM refunds r JOIN orders o ON o.id = r.order_id
        WHERE o.organization_id = ? AND r.status = 'succeeded'${scope} AND r.created_at >= DATE_FORMAT(NOW() - INTERVAL ? MONTH, '%Y-%m-01') GROUP BY DATE_FORMAT(r.created_at, '%Y-%m')`,
      [orgId, ...params, months - 1],
    ),
  ]);
  const s = new Map(sales.map((r) => [r.m, r])), f = new Map(refunds.map((r) => [r.m, r]));
  const out: RefundMonth[] = [];
  const now = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const m = d.toISOString().slice(0, 7);
    const gross = Number(s.get(m)?.gross ?? 0), refunded = Number(f.get(m)?.amount ?? 0);
    out.push({ month: m, grossCents: gross, refundedCents: refunded, refunds: Number(f.get(m)?.n ?? 0), orders: Number(s.get(m)?.orders ?? 0), rate: gross ? refunded / gross : 0 });
  }
  return out;
}

/** Why and how orders were refunded: kind (full / partial / event cancellation) and the most common reasons. */
export async function refundBreakdown(orgId: number, eventIds: number[] | null) {
  const scope = scopeSql(eventIds);
  const params = eventIds ?? [];
  const [kinds, reasons, timing, events] = await Promise.all([
    query<Row & { kind: string; n: number; amount: number }>(
      `SELECT r.kind, COUNT(*) AS n, COALESCE(SUM(r.amount_cents),0) AS amount FROM refunds r JOIN orders o ON o.id = r.order_id
        WHERE o.organization_id = ? AND r.status = 'succeeded'${scope} GROUP BY r.kind ORDER BY amount DESC`, [orgId, ...params]),
    query<Row & { reason: string; n: number; amount: number }>(
      `SELECT LEFT(TRIM(r.reason), 80) AS reason, COUNT(*) AS n, COALESCE(SUM(r.amount_cents),0) AS amount FROM refunds r JOIN orders o ON o.id = r.order_id
        WHERE o.organization_id = ? AND r.status = 'succeeded'${scope} GROUP BY LEFT(TRIM(r.reason), 80) ORDER BY n DESC LIMIT 8`, [orgId, ...params]),
    // how long before the event refunds happen
    query<Row & { bucket: string; n: number }>(
      `SELECT x.bucket, COUNT(*) AS n FROM (
         SELECT CASE WHEN r.created_at >= e.starts_at THEN 'After the event started'
                     WHEN TIMESTAMPDIFF(DAY, r.created_at, e.starts_at) < 2 THEN 'Last 48 hours'
                     WHEN TIMESTAMPDIFF(DAY, r.created_at, e.starts_at) < 7 THEN '2–7 days before'
                     WHEN TIMESTAMPDIFF(DAY, r.created_at, e.starts_at) < 30 THEN '1–4 weeks before'
                     ELSE 'More than a month before' END AS bucket
           FROM refunds r JOIN orders o ON o.id = r.order_id JOIN events e ON e.id = o.event_id
          WHERE o.organization_id = ? AND r.status = 'succeeded'${scope}) x GROUP BY x.bucket`, [orgId, ...params]),
    query<Row & { id: number; title: string; currency: string; gross: number; refunded: number; refunded_orders: number; orders: number }>(
      `SELECT e.id, e.title, e.currency, COALESCE(SUM(o.total_cents),0) AS gross, COALESCE(SUM(o.refunded_cents),0) AS refunded,
              SUM(o.refunded_cents > 0) AS refunded_orders, COUNT(*) AS orders
         FROM orders o JOIN events e ON e.id = o.event_id
        WHERE o.organization_id = ? AND ${PAID}${scope} GROUP BY e.id, e.title, e.currency HAVING refunded > 0 ORDER BY refunded / GREATEST(gross, 1) DESC LIMIT 10`, [orgId, ...params]),
  ]);
  const order = ['More than a month before', '1–4 weeks before', '2–7 days before', 'Last 48 hours', 'After the event started'];
  return {
    kinds: kinds.map((k) => ({ kind: k.kind, count: Number(k.n), amountCents: Number(k.amount) })),
    reasons: reasons.map((r) => ({ reason: r.reason || '(none given)', count: Number(r.n), amountCents: Number(r.amount) })),
    timing: order.map((b) => ({ bucket: b, count: Number(timing.find((t) => t.bucket === b)?.n ?? 0) })),
    events: events.map((e) => ({ id: Number(e.id), title: e.title, currency: e.currency, grossCents: Number(e.gross), refundedCents: Number(e.refunded), refundedOrders: Number(e.refunded_orders), orders: Number(e.orders) })),
  };
}

// ---------------------------------------------------------------------------
// Where attendees are from
// ---------------------------------------------------------------------------
export type GeoRow = { key: string; country: string | null; orders: number; tickets: number };

/**
 * From the card billing address Stripe collected (lib/orders/location.ts): countries, states / regions, cities and
 * postal codes, how many orders have a location, and how many came from outside the venue's state.
 */
export async function attendeeGeography(orgId: number, eventIds: number[] | null) {
  const scope = scopeSql(eventIds);
  const params = eventIds ?? [];
  const tickets = `(SELECT COALESCE(SUM(oi.quantity),0) FROM order_items oi WHERE oi.order_id = o.id)`;
  const group = (col: string, limit: number) => query<Row & { k: string; country: string | null; orders: number; tickets: number }>(
    `SELECT ${col} AS k, MAX(o.buyer_country) AS country, COUNT(*) AS orders, COALESCE(SUM(${tickets}),0) AS tickets FROM orders o
      WHERE o.organization_id = ? AND o.status IN ('paid','partially_refunded')${scope} AND ${col} IS NOT NULL
      GROUP BY ${col} ORDER BY tickets DESC LIMIT ${limit}`, [orgId, ...params]);
  const [countries, regions, cities, postal, totals] = await Promise.all([
    group('o.buyer_country', 20),
    group(`CONCAT(o.buyer_region, ', ', o.buyer_country)`, 20),
    group(`CONCAT(o.buyer_city, ', ', COALESCE(o.buyer_region, o.buyer_country))`, 20),
    group(`CONCAT(o.buyer_postal_code, ' ', o.buyer_country)`, 25),
    query<Row & { orders: number; located: number; online: number; away: number; comparable: number }>(
      `SELECT COUNT(*) AS orders, SUM(o.buyer_country IS NOT NULL OR o.buyer_postal_code IS NOT NULL) AS located, SUM(o.source = 'online') AS online,
              SUM(o.buyer_region IS NOT NULL AND v.region IS NOT NULL AND UPPER(o.buyer_region) <> UPPER(v.region)) AS away,
              SUM(o.buyer_region IS NOT NULL AND v.region IS NOT NULL) AS comparable
         FROM orders o JOIN events e ON e.id = o.event_id LEFT JOIN venues v ON v.id = e.venue_id
        WHERE o.organization_id = ? AND o.status IN ('paid','partially_refunded')${scope}`, [orgId, ...params]),
  ]);
  const map = (rows: typeof countries): GeoRow[] => rows.map((r) => ({ key: r.k, country: r.country, orders: Number(r.orders), tickets: Number(r.tickets) }));
  const t = totals[0];
  return {
    countries: map(countries), regions: map(regions), cities: map(cities), postalCodes: map(postal),
    orders: Number(t?.orders ?? 0), located: Number(t?.located ?? 0), online: Number(t?.online ?? 0),
    fromAway: Number(t?.away ?? 0), comparable: Number(t?.comparable ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Comparing events
// ---------------------------------------------------------------------------
export const PACE_DAYS = [60, 30, 14, 7, 3, 1, 0] as const;

export type EventComparison = {
  id: number; title: string; startsAt: Date; timezone: string; currency: string; status: string;
  capacity: number; sold: number; orders: number; grossCents: number; netCents: number; refundedCents: number; avgOrderCents: number;
  checkedIn: number; promoOrders: number; daysOnSale: number | null;
  /** share of the final paid tickets already sold N days before the start, for each of PACE_DAYS */
  pace: number[];
};

export async function compareEvents(orgId: number, ids: number[]): Promise<EventComparison[]> {
  if (!ids.length) return [];
  const events = await query<Row & { id: number; title: string; starts_at: Date; timezone: string; currency: string; status: string; capacity: number; sold: number; checked_in: number }>(
    `SELECT e.id, e.title, e.starts_at, e.timezone, e.currency, e.status,
            (SELECT COALESCE(SUM(t.quantity * t.seats_per_unit),0) FROM ticket_types t WHERE t.event_id = e.id) AS capacity,
            (SELECT COALESCE(SUM(t.sold * t.seats_per_unit),0) FROM ticket_types t WHERE t.event_id = e.id) AS sold,
            (SELECT COUNT(*) FROM tickets k WHERE k.event_id = e.id AND k.checked_in_at IS NOT NULL) AS checked_in
       FROM events e WHERE e.organization_id = ? AND e.id IN (${marks(ids.length)})`, [orgId, ...ids],
  );
  const orders = await query<Row & { event_id: number; paid_at: Date; total_cents: number; refunded_cents: number; subtotal_cents: number; promo: number; tickets: number; status: string }>(
    `SELECT o.event_id, o.paid_at, o.total_cents, o.refunded_cents, o.subtotal_cents, o.promo_code_id IS NOT NULL AS promo, o.status,
            (SELECT COALESCE(SUM(oi.quantity),0) FROM order_items oi WHERE oi.order_id = o.id) AS tickets
       FROM orders o WHERE o.organization_id = ? AND o.event_id IN (${marks(ids.length)}) AND ${PAID} AND o.paid_at IS NOT NULL ORDER BY o.paid_at`, [orgId, ...ids],
  );
  return ids.flatMap((id) => {
    const e = events.find((x) => Number(x.id) === id);
    if (!e) return [];
    const mine = orders.filter((o) => Number(o.event_id) === id);
    const live = mine.filter((o) => o.status !== 'refunded');
    const start = new Date(e.starts_at).getTime();
    const totalTickets = live.reduce((n, o) => n + Number(o.tickets), 0);
    const pace = PACE_DAYS.map((d) => {
      if (!totalTickets) return 0;
      const cutoff = start - d * 86_400_000;
      return live.filter((o) => new Date(o.paid_at).getTime() <= cutoff).reduce((n, o) => n + Number(o.tickets), 0) / totalTickets;
    });
    const gross = mine.reduce((n, o) => n + Number(o.total_cents), 0), refunded = mine.reduce((n, o) => n + Number(o.refunded_cents), 0);
    const first = mine[0] ? new Date(mine[0].paid_at).getTime() : null;
    return [{
      id, title: e.title, startsAt: new Date(e.starts_at), timezone: e.timezone, currency: e.currency, status: e.status,
      capacity: Number(e.capacity), sold: Number(e.sold), orders: mine.length, grossCents: gross, refundedCents: refunded, netCents: gross - refunded,
      avgOrderCents: mine.length ? Math.round(gross / mine.length) : 0, checkedIn: Number(e.checked_in), promoOrders: mine.filter((o) => Number(o.promo)).length,
      daysOnSale: first ? Math.max(0, Math.round((start - first) / 86_400_000)) : null, pace,
    }];
  });
}
