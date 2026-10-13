import { query, type Row } from '@/lib/db';
import { csvResponse, dollars, toCsv } from '@/lib/csv';
import { dateRange, financeExportScope, logExport } from '@/lib/exports';

/**
 * Tax report by jurisdiction and event (plan 7.5 / 11.2): taxable admissions, tax rate and tax collected,
 * net of refunds, grouped by venue state / city. Based on paid date.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const session = await financeExportScope();
  if (session instanceof Response) return session;
  const { from, to, label } = dateRange(new URL(req.url));
  const rows = await query<Row & { country: string | null; region: string | null; city: string | null; venue: string | null; org: string; event: string; event_id: number; tax_label: string | null; tax_bps: number | null; orders: number; taxable_cents: number; tax_cents: number; refunded_tax_cents: number; currency: string }>(
    `SELECT v.country, v.region, v.city, v.name AS venue, g.name AS org, e.title AS event, e.id AS event_id,
            COALESCE(e.tax_label, v.tax_label) AS tax_label, COALESCE(e.tax_bps, v.tax_bps) AS tax_bps, e.currency,
            COUNT(o.id) AS orders, COALESCE(SUM(o.subtotal_cents),0) AS taxable_cents, COALESCE(SUM(o.tax_cents),0) AS tax_cents,
            -- Refunded tax: the tax share of each refund (full refunds return all of it).
            COALESCE(SUM(CASE WHEN o.total_cents > 0 THEN ROUND(o.tax_cents * LEAST(o.refunded_cents, o.total_cents) / o.total_cents) ELSE 0 END),0) AS refunded_tax_cents
       FROM orders o JOIN events e ON e.id = o.event_id JOIN organizations g ON g.id = o.organization_id LEFT JOIN venues v ON v.id = e.venue_id
      WHERE o.paid_at >= ? AND o.paid_at < ? AND o.status IN ('paid','partially_refunded','refunded')
      GROUP BY v.country, v.region, v.city, v.name, g.name, e.title, e.id, COALESCE(e.tax_label, v.tax_label), COALESCE(e.tax_bps, v.tax_bps), e.currency
      ORDER BY v.country, v.region, v.city, e.title`, [from, to],
  );
  await logExport(session.user.id, 'tax', { from, to, rows: rows.length });
  return csvResponse(`tax-by-jurisdiction-${label}.csv`, toCsv(
    ['country', 'state_region', 'city', 'venue', 'organization', 'event', 'event_id', 'tax_label', 'tax_rate_pct', 'orders', 'taxable_ticket_sales', 'tax_collected', 'tax_refunded', 'net_tax', 'currency'],
    rows.map((r) => [r.country ?? '', r.region ?? '(no venue)', r.city ?? '', r.venue ?? '', r.org, r.event, r.event_id, r.tax_label ?? '', r.tax_bps == null ? '' : (Number(r.tax_bps) / 100).toFixed(2),
      r.orders, dollars(r.taxable_cents), dollars(r.tax_cents), dollars(r.refunded_tax_cents), dollars(Number(r.tax_cents) - Number(r.refunded_tax_cents)), r.currency]),
  ));
}
