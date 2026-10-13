import 'server-only';
import { query, queryOne, type Row } from '../db';

// ---------------------------------------------------------------------------
// Promo codes
// ---------------------------------------------------------------------------
export type PromoRow = Row & {
  id: number; event_id: number; code: string; kind: 'percent' | 'amount'; value: number; ticket_type_ids: string | null; max_uses: number | null;
  starts_at: Date | null; ends_at: Date | null; active: number; created_at: Date; used: number; discount_total: number;
};

/** `used` = tickets on paid orders plus live holds; `discount_total` = discount given on paid orders. */
export async function listPromoCodes(eventId: number): Promise<PromoRow[]> {
  return query<PromoRow>(
    `SELECT p.*,
            (SELECT COALESCE(SUM(oi.quantity),0) FROM order_items oi JOIN orders o ON o.id = oi.order_id
              WHERE o.promo_code_id = p.id AND oi.unit_discount_cents > 0 AND (o.status IN ('paid','partially_refunded') OR (o.status = 'pending' AND o.hold_expires_at > NOW()))) AS used,
            (SELECT COALESCE(SUM(o.discount_cents),0) FROM orders o WHERE o.promo_code_id = p.id AND o.status IN ('paid','partially_refunded')) AS discount_total
       FROM promo_codes p WHERE p.event_id = ? ORDER BY p.created_at DESC`, [eventId],
  );
}

export async function findPromoCode(eventId: number, code: string): Promise<PromoRow | null> {
  const c = code.trim().toUpperCase();
  if (!/^[A-Z0-9_-]{2,40}$/.test(c)) return null;
  return queryOne<PromoRow>(`SELECT p.*, 0 AS used, 0 AS discount_total FROM promo_codes p WHERE p.event_id = ? AND p.code = ?`, [eventId, c]);
}

export function promoTicketTypeIds(p: { ticket_type_ids: string | null }): number[] | null {
  if (!p.ticket_type_ids) return null;
  const ids = p.ticket_type_ids.split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);
  return ids.length ? ids : null;
}

/** Per-ticket discount for a unit price. Percent is in basis points; amount is cents off each ticket. Never below zero. */
export function unitDiscount(p: { kind: string; value: number }, unitPriceCents: number): number {
  if (unitPriceCents <= 0) return 0;
  const d = p.kind === 'percent' ? Math.round((unitPriceCents * Math.min(10_000, Number(p.value))) / 10_000) : Number(p.value);
  return Math.max(0, Math.min(unitPriceCents, d));
}

export function promoLabel(p: { kind: string; value: number }, currency = 'USD'): string {
  return p.kind === 'percent' ? `${(Number(p.value) / 100).toFixed(Number(p.value) % 100 ? 2 : 0)}% off` : `${new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(p.value) / 100)} off per ticket`;
}

// ---------------------------------------------------------------------------
// Tracking links (promoters / UTM)
// ---------------------------------------------------------------------------
export type TrackingLinkRow = Row & {
  id: number; organization_id: number; event_id: number | null; code: string; name: string; utm_source: string | null; utm_medium: string | null; utm_campaign: string | null;
  clicks: number; active: number; created_at: Date; event_title: string | null; event_slug: string | null; orders: number; tickets: number; revenue_cents: number;
};

export async function listTrackingLinks(orgId: number, eventId?: number): Promise<TrackingLinkRow[]> {
  return query<TrackingLinkRow>(
    `SELECT l.*, e.title AS event_title, e.slug AS event_slug,
            (SELECT COUNT(*) FROM orders o WHERE o.tracking_link_id = l.id AND o.status IN ('paid','partially_refunded')) AS orders,
            (SELECT COALESCE(SUM(oi.quantity),0) FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.tracking_link_id = l.id AND o.status IN ('paid','partially_refunded')) AS tickets,
            (SELECT COALESCE(SUM(o.subtotal_cents - o.refunded_cents),0) FROM orders o WHERE o.tracking_link_id = l.id AND o.status IN ('paid','partially_refunded')) AS revenue_cents
       FROM tracking_links l LEFT JOIN events e ON e.id = l.event_id
      WHERE l.organization_id = ? ${eventId ? 'AND (l.event_id = ? OR l.event_id IS NULL)' : ''} ORDER BY l.created_at DESC`,
    eventId ? [orgId, eventId] : [orgId],
  );
}

export async function findTrackingLink(code: string): Promise<(Row & { id: number; organization_id: number; event_id: number | null; code: string; utm_source: string | null; utm_medium: string | null; utm_campaign: string | null; active: number; event_slug: string | null; event_visibility: string | null; private_key: string | null }) | null> {
  if (!/^[A-Za-z0-9_-]{2,40}$/.test(code)) return null;
  return queryOne(
    `SELECT l.id, l.organization_id, l.event_id, l.code, l.utm_source, l.utm_medium, l.utm_campaign, l.active, e.slug AS event_slug, e.visibility AS event_visibility, e.private_key
       FROM tracking_links l LEFT JOIN events e ON e.id = l.event_id WHERE l.code = ?`, [code],
  );
}

/** UTM report for an event: orders grouped by source / medium / campaign, whether or not they came through a tracking link. */
export async function utmReport(eventId: number) {
  return query<Row & { source: string; medium: string; campaign: string; channel: string; orders: number; tickets: number; revenue_cents: number }>(
    `SELECT COALESCE(o.utm_source, '(direct)') AS source, COALESCE(o.utm_medium, '—') AS medium, COALESCE(o.utm_campaign, '—') AS campaign, o.channel,
            COUNT(DISTINCT o.id) AS orders, COALESCE(SUM(oi.quantity),0) AS tickets, COALESCE(SUM(oi.quantity * oi.unit_price_cents),0) AS revenue_cents
       FROM orders o JOIN order_items oi ON oi.order_id = o.id
      WHERE o.event_id = ? AND o.status IN ('paid','partially_refunded')
      GROUP BY o.utm_source, o.utm_medium, o.utm_campaign, o.channel ORDER BY revenue_cents DESC`, [eventId],
  );
}
