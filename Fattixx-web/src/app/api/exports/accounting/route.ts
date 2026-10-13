import { query, type Row } from '@/lib/db';
import { csvResponse, dollars, toCsv } from '@/lib/csv';
import { dateRange, financeExportScope, logExport } from '@/lib/exports';

/**
 * Accounting export (plan 7.5): one line per money movement in the range — sales (by paid date),
 * refunds (by refund date) and dispute fees — with fees and taxes split out, for import into accounting software.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const session = await financeExportScope();
  if (session instanceof Response) return session;
  const url = new URL(req.url);
  const { from, to, label } = dateRange(url);
  const [sales, refunds, disputes] = await Promise.all([
    query<Row>(
      `SELECT o.paid_at AS at, o.code, g.name AS org, e.title AS event, o.source, o.subtotal_cents, o.discount_cents, o.platform_fee_cents, o.processing_fee_cents, o.absorbed_fee_cents, o.tax_cents, o.total_cents, o.currency, o.stripe_payment_intent_id
         FROM orders o JOIN events e ON e.id = o.event_id JOIN organizations g ON g.id = o.organization_id
        WHERE o.paid_at >= ? AND o.paid_at < ? AND o.status IN ('paid','partially_refunded','refunded') ORDER BY o.paid_at`, [from, to]),
    query<Row>(
      `SELECT r.created_at AS at, o.code, g.name AS org, e.title AS event, r.kind, r.amount_cents, r.reason, r.stripe_refund_id, o.currency
         FROM refunds r JOIN orders o ON o.id = r.order_id JOIN events e ON e.id = o.event_id JOIN organizations g ON g.id = o.organization_id
        WHERE r.created_at >= ? AND r.created_at < ? AND r.status = 'succeeded' ORDER BY r.created_at`, [from, to]),
    query<Row>(
      `SELECT d.opened_at AS at, o.code, g.name AS org, e.title AS event, d.status, d.amount_cents, d.fee_cents, d.stripe_dispute_id, o.currency
         FROM disputes d JOIN orders o ON o.id = d.order_id JOIN events e ON e.id = o.event_id JOIN organizations g ON g.id = o.organization_id
        WHERE d.opened_at >= ? AND d.opened_at < ? ORDER BY d.opened_at`, [from, to]),
  ]);
  const header = ['date_utc', 'type', 'order', 'organization', 'event', 'source', 'gross_ticket_sales', 'discount', 'service_fee_buyer', 'processing_fee_buyer', 'fees_absorbed_by_organizer', 'tax_collected', 'amount', 'currency', 'reference', 'note'];
  const rows: unknown[][] = [
    ...sales.map((s) => [s.at, 'sale', s.code, s.org, s.event, s.source, dollars(s.subtotal_cents), dollars(s.discount_cents), dollars(s.platform_fee_cents), dollars(s.processing_fee_cents), dollars(s.absorbed_fee_cents), dollars(s.tax_cents), dollars(s.total_cents), s.currency, s.stripe_payment_intent_id, '']),
    ...refunds.map((r) => [r.at, `refund_${r.kind}`, r.code, r.org, r.event, '', '', '', '', '', '', '', `-${dollars(r.amount_cents)}`, r.currency, r.stripe_refund_id, r.reason]),
    ...disputes.map((d) => [d.at, `dispute_${d.status}`, d.code, d.org, d.event, '', '', '', '', '', '', '', `-${dollars(d.amount_cents)}`, d.currency, d.stripe_dispute_id, `dispute fee ${dollars(d.fee_cents)}`]),
  ].sort((a, b) => new Date(a[0] as Date).getTime() - new Date(b[0] as Date).getTime());
  await logExport(session.user.id, 'accounting', { from, to, rows: rows.length });
  return csvResponse(`accounting-${label}.csv`, toCsv(header, rows));
}
