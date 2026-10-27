import 'server-only';
import type Stripe from 'stripe';
import { execute } from '../db';
import { audit } from '../audit';
import { stripeReturnUrl } from '../return-url';
import { getStripe } from '../payments/stripe';
import { getSeatMapRequest, type SeatMapRequestRow } from './queries';

/*
 * The one-time seat map set-up fee (plan 5.7.3–5.7.13). Paid through Stripe Checkout (payment mode) on the platform's
 * account; the webhook (checkout.session.completed, kind fattixx_seatmap_fee) or the organizer's return from Checkout
 * marks it paid. Staff can also mark it paid (invoiced elsewhere) or waive it. A map can only be approved for use
 * once its fee is settled.
 */
export const FEE_KIND = 'fattixx_seatmap_fee';

export function feeSettled(r: Pick<SeatMapRequestRow, 'fee_status' | 'fee_cents'>): boolean {
  return r.fee_status !== 'unpaid' || Number(r.fee_cents) === 0;
}

const requestUrl = (slug: string, id: number, q = '') => stripeReturnUrl(`/org/${slug}/seating/${id}${q}`);

/** Stripe Checkout page for a request's set-up fee. */
export async function createFeeCheckout(r: SeatMapRequestRow, payerEmail: string): Promise<string> {
  const { stripe } = await getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer_email: payerEmail,
    client_reference_id: String(r.organization_id),
    line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: Number(r.fee_cents), product_data: { name: 'Seat map set-up', description: `${r.map_name} · ${r.venue_name}` } } }],
    metadata: { kind: FEE_KIND, request_id: String(r.id), organization_id: String(r.organization_id) },
    payment_intent_data: { metadata: { kind: FEE_KIND, request_id: String(r.id), organization_id: String(r.organization_id) }, description: `Fattixx seat map set-up: ${r.map_name} (${r.org_name})` },
    success_url: requestUrl(r.org_slug, r.id, '?fee=paid&session_id={CHECKOUT_SESSION_ID}'),
    cancel_url: requestUrl(r.org_slug, r.id, '?fee=cancelled'),
  });
  if (!session.url) throw new Error('Stripe did not return a checkout page.');
  await execute(`UPDATE seat_map_requests SET stripe_session_id = ? WHERE id = ?`, [session.id, r.id]);
  return session.url;
}

/** Record a completed fee payment (webhook or return from Checkout). Idempotent. */
export async function applyFeeSession(s: Stripe.Checkout.Session): Promise<boolean> {
  if (s.metadata?.kind !== FEE_KIND || s.payment_status !== 'paid') return false;
  const r = await getSeatMapRequest(Number(s.metadata.request_id));
  if (!r || String(r.organization_id) !== s.metadata.organization_id || r.fee_status !== 'unpaid') return false;
  const pi = typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id ?? null;
  const res = await execute(
    `UPDATE seat_map_requests SET fee_status = 'paid', fee_paid_at = NOW(), stripe_session_id = ?, stripe_payment_intent_id = ? WHERE id = ? AND fee_status = 'unpaid'`, [s.id, pi, r.id],
  );
  if (!res.affectedRows) return false;
  await execute(`INSERT INTO seat_map_request_notes (request_id, from_staff, body) VALUES (?, 0, ?)`, [r.id, `Set-up fee paid (${(Number(s.amount_total ?? r.fee_cents) / 100).toFixed(2)} ${(s.currency ?? 'usd').toUpperCase()}).`]);
  await audit('seatmap.request.fee', { targetType: 'seat_map_request', targetId: r.id, metadata: { status: 'paid', session: s.id, via: 'stripe' } });
  return true;
}

/** The organizer is back from Checkout: read the session now instead of waiting for the webhook. */
export async function syncFeeSession(requestId: number, sessionId: string): Promise<void> {
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return;
  const { stripe } = await getStripe();
  const s = await stripe.checkout.sessions.retrieve(sessionId);
  if (s.metadata?.request_id !== String(requestId)) return;
  await applyFeeSession(s);
}
