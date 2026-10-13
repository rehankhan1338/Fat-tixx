import 'server-only';
import { execute, query, type Row } from '../db';
import { getActiveStripe, stripeClient } from './stripe';

/**
 * Compare Stripe payments with Fat Tixx orders for the last `days` days (plan 7.5). Used by the
 * Finance "Run reconciliation" button and by the daily job. Returns null when Stripe is not configured.
 */
export async function reconcileWithStripe(days: number, runBy: number | null): Promise<{ id: number; days: number; discrepancies: number } | null> {
  const active = await getActiveStripe();
  if (!active) return null;
  days = Math.min(31, Math.max(1, Math.floor(days)));
  const end = new Date();
  const start = new Date(end.getTime() - days * 86_400_000);
  const s = stripeClient(active.secretKey);

  const stripeIntents = new Map<string, { amount: number; status: string; refunded: number }>();
  for await (const pi of s.paymentIntents.list({ created: { gte: Math.floor(start.getTime() / 1000), lte: Math.floor(end.getTime() / 1000) }, limit: 100, expand: ['data.latest_charge'] })) {
    if (pi.status !== 'succeeded') continue;
    const charge = typeof pi.latest_charge === 'object' && pi.latest_charge ? pi.latest_charge : null;
    stripeIntents.set(pi.id, { amount: pi.amount_received, status: pi.status, refunded: charge?.amount_refunded ?? 0 });
  }
  const dbOrders = await query<Row & { code: string; stripe_payment_intent_id: string | null; total_cents: number; refunded_cents: number; status: string }>(
    `SELECT code, stripe_payment_intent_id, total_cents, refunded_cents, status FROM orders WHERE total_cents > 0 AND status IN ('paid','partially_refunded','refunded') AND paid_at BETWEEN ? AND ?`, [start, end],
  );
  const discrepancies: { kind: string; ref: string; detail: string }[] = [];
  const seen = new Set<string>();
  for (const o of dbOrders) {
    if (!o.stripe_payment_intent_id) { discrepancies.push({ kind: 'no_stripe_payment', ref: o.code, detail: 'Paid order without a Stripe payment (box office / recorded manually)' }); continue; }
    const pi = stripeIntents.get(o.stripe_payment_intent_id);
    seen.add(o.stripe_payment_intent_id);
    if (!pi) { discrepancies.push({ kind: 'missing_in_stripe', ref: o.code, detail: `No succeeded payment ${o.stripe_payment_intent_id} in this range` }); continue; }
    if (pi.amount !== Number(o.total_cents)) discrepancies.push({ kind: 'amount_mismatch', ref: o.code, detail: `Stripe ${pi.amount} vs order ${o.total_cents}` });
    if (pi.refunded !== Number(o.refunded_cents)) discrepancies.push({ kind: 'refund_mismatch', ref: o.code, detail: `Stripe refunded ${pi.refunded} vs order ${o.refunded_cents}` });
  }
  for (const [id, pi] of stripeIntents) if (!seen.has(id)) discrepancies.push({ kind: 'missing_in_db', ref: id, detail: `Stripe payment of ${pi.amount} has no paid order` });

  const stripeCents = [...stripeIntents.values()].reduce((n, p) => n + p.amount, 0);
  const dbCents = dbOrders.reduce((n, o) => n + Number(o.total_cents), 0);
  const r = await execute(
    `INSERT INTO reconciliation_runs (mode, range_start, range_end, stripe_count, stripe_cents, db_count, db_cents, discrepancies, run_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [active.mode, start, end, stripeIntents.size, stripeCents, dbOrders.length, dbCents, JSON.stringify(discrepancies), runBy],
  );
  return { id: r.insertId, days, discrepancies: discrepancies.length };
}
