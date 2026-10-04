import 'server-only';
import { execute } from '../db';
import { audit } from '../audit';
import { getActiveStripe, getStripe } from '../payments/stripe';
import { finalizePaidOrder } from './checkout';
import { handleOversoldAfterPayment } from './access';
import type { OrderRow } from './queries';

/**
 * Stripe PaymentIntent lifecycle for an order, shared by the website (Server Actions) and the
 * mobile API (route handlers). Callers must already have checked that the caller may access the order.
 */
export type PaymentIntentResult = { clientSecret?: string; error?: string; publishableKey?: string; mode?: 'test' | 'live' };

export async function createPaymentIntentForOrder(order: OrderRow): Promise<PaymentIntentResult> {
  const active = await getActiveStripe();
  if (!active) return { error: 'Card payments are not configured yet. Contact the organizer.' };
  if (order.status !== 'pending') return { error: 'This order is no longer pending.' };
  if (order.total_cents <= 0) return { error: 'This order is free.' };
  if (order.hold_expires_at && new Date(order.hold_expires_at).getTime() < Date.now()) return { error: 'Your reservation expired. Please start again.' };
  const { stripe: s } = await getStripe();
  if (order.stripe_payment_intent_id) {
    try {
      const existing = await s.paymentIntents.retrieve(order.stripe_payment_intent_id);
      if (existing.status !== 'canceled' && existing.amount === order.total_cents) return { clientSecret: existing.client_secret ?? undefined, publishableKey: active.publishableKey, mode: active.mode };
    } catch { /* intent from another mode/account: create a fresh one */ }
  }
  const pi = await s.paymentIntents.create({
    amount: order.total_cents, currency: order.currency.toLowerCase(), receipt_email: order.buyer_email,
    description: `${order.event_title} — order ${order.code}`,
    metadata: { order_id: String(order.id), order_code: order.code, event_id: String(order.event_id), organization_id: String(order.organization_id) },
    automatic_payment_methods: { enabled: true },
  }, { idempotencyKey: `order-${order.id}-${order.total_cents}-${active.mode}` });
  await execute(`UPDATE orders SET stripe_payment_intent_id = ? WHERE id = ?`, [pi.id, order.id]);
  return { clientSecret: pi.client_secret ?? undefined, publishableKey: active.publishableKey, mode: active.mode };
}

/**
 * After the client reports a successful payment: verify with Stripe, then issue the tickets.
 * Idempotent (a webhook may finish first). On an oversold-after-payment race the payment is refunded.
 */
export async function confirmPaidOrderWithStripe(order: OrderRow): Promise<{ ok: boolean; error?: string }> {
  if (order.status === 'paid') return { ok: true };
  if (!order.stripe_payment_intent_id) return { ok: false, error: 'No payment found.' };
  const { stripe: s } = await getStripe();
  const pi = await s.paymentIntents.retrieve(order.stripe_payment_intent_id, { expand: ['latest_charge'] });
  if (pi.status !== 'succeeded' || pi.amount_received < order.total_cents) return { ok: false, error: 'Payment not completed yet.' };
  try {
    const chargeId = typeof pi.latest_charge === 'string' ? pi.latest_charge : pi.latest_charge?.id ?? null;
    if (await finalizePaidOrder(order.id, { paymentIntentId: pi.id, chargeId })) {
      await audit('order.paid', { actorUserId: order.user_id, targetType: 'order', targetId: order.id, metadata: { pi: pi.id } });
    }
  } catch (e) {
    if ((e as Error).message === 'OVERSOLD') { await handleOversoldAfterPayment(order, pi.id); return { ok: false, error: 'Those tickets were just taken. Your payment has been refunded.' }; }
    throw e;
  }
  return { ok: true };
}

/** Issue the tickets of a zero-total order. */
export async function completeFreeOrderNow(order: OrderRow): Promise<{ ok: boolean; error?: string }> {
  if (order.status === 'paid') return { ok: true };
  if (order.status !== 'pending') return { ok: false, error: 'This order is no longer pending.' };
  if (order.total_cents !== 0) return { ok: false, error: 'This order requires payment.' };
  if (order.hold_expires_at && new Date(order.hold_expires_at).getTime() < Date.now()) return { ok: false, error: 'Your reservation expired. Please start again.' };
  try {
    await finalizePaidOrder(order.id, {});
  } catch (e) {
    if ((e as Error).message === 'OVERSOLD') return { ok: false, error: 'Sorry, those tickets were just taken.' };
    throw e;
  }
  await audit('order.paid', { actorUserId: order.user_id, targetType: 'order', targetId: order.id, metadata: { free: true } });
  return { ok: true };
}
