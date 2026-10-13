import { query, type Row } from '@/lib/db';
import { csvResponse, dollars, toCsv } from '@/lib/csv';
import { logExport, orgExportScope } from '@/lib/exports';

/** Organizer orders export (one row per order) with fees, tax, discounts and attribution. */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const scope = await orgExportScope(url);
  if (scope instanceof Response) return scope;
  const { ctx, eventId } = scope;
  const rows = await query<Row>(
    `SELECT o.code, e.title AS event, e.starts_at, o.created_at, o.paid_at, o.status, o.source, o.channel, o.buyer_name, o.buyer_email, o.buyer_phone,
            (SELECT COALESCE(SUM(oi.quantity),0) FROM order_items oi WHERE oi.order_id = o.id) AS tickets,
            o.subtotal_cents, o.discount_cents, p.code AS promo_code, o.platform_fee_cents, o.processing_fee_cents, o.absorbed_fee_cents, o.tax_cents, o.total_cents, o.refunded_cents,
            o.currency, o.utm_source, o.utm_medium, o.utm_campaign, l.name AS tracking_link, o.marketing_opt_in
       FROM orders o JOIN events e ON e.id = o.event_id LEFT JOIN promo_codes p ON p.id = o.promo_code_id LEFT JOIN tracking_links l ON l.id = o.tracking_link_id
      WHERE o.organization_id = ? ${eventId ? 'AND o.event_id = ?' : ''} AND o.status <> 'pending' ORDER BY o.created_at`,
    eventId ? [ctx.org.id, eventId] : [ctx.org.id],
  );
  await logExport(ctx.session.user.id, 'orders', { org: ctx.org.id, eventId, rows: rows.length });
  const body = toCsv(
    ['order', 'event', 'event_start_utc', 'created_utc', 'paid_utc', 'status', 'source', 'channel', 'buyer_name', 'buyer_email', 'buyer_phone', 'tickets',
      'ticket_subtotal', 'discount', 'promo_code', 'service_fee_buyer', 'processing_fee_buyer', 'fees_absorbed', 'tax', 'total_paid', 'refunded', 'currency',
      'utm_source', 'utm_medium', 'utm_campaign', 'tracking_link', 'marketing_opt_in'],
    rows.map((r) => [r.code, r.event, r.starts_at, r.created_at, r.paid_at, r.status, r.source, r.channel, r.buyer_name, r.buyer_email, r.buyer_phone, r.tickets,
      dollars(r.subtotal_cents), dollars(r.discount_cents), r.promo_code, dollars(r.platform_fee_cents), dollars(r.processing_fee_cents), dollars(r.absorbed_fee_cents), dollars(r.tax_cents),
      dollars(r.total_cents), dollars(r.refunded_cents), r.currency, r.utm_source, r.utm_medium, r.utm_campaign, r.tracking_link, r.marketing_opt_in ? 'yes' : 'no']),
  );
  return csvResponse(`orders-${ctx.org.slug}${eventId ? `-event-${eventId}` : ''}.csv`, body);
}
