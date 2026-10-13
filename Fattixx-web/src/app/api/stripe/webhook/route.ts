import type Stripe from 'stripe';
import { execute, queryOne, type Row } from '@/lib/db';
import { audit } from '@/lib/audit';
import { getActiveStripe, stripeClient } from '@/lib/payments/stripe';
import { finalizePaidOrder } from '@/lib/orders/checkout';
import { getOrderById } from '@/lib/orders/queries';
import { handleOversoldAfterPayment } from '@/lib/orders/access';

/**
 * Stripe → Fat Tixx. Signature-verified, idempotent (stripe_events table), and the source of truth
 * for payment state: even if the buyer closes the tab, the order is marked paid and tickets issued.
 */
export async function POST(req: Request) {
  const active = await getActiveStripe();
  if (!active) return new Response('Stripe not configured', { status: 503 });
  if (!active.webhookSecret) return new Response('Webhook secret not configured', { status: 503 });
  const sig = req.headers.get('stripe-signature');
  if (!sig) return new Response('Missing signature', { status: 400 });
  const raw = await req.text();

  let event: Stripe.Event;
  try {
    event = stripeClient(active.secretKey).webhooks.constructEvent(raw, sig, active.webhookSecret);
  } catch (e) {
    return new Response(`Invalid signature: ${(e as Error).message}`, { status: 400 });
  }

  // Idempotency: Stripe retries; process each event once.
  const seen = await queryOne(`SELECT 1 FROM stripe_events WHERE id = ?`, [event.id]);
  if (seen) return Response.json({ received: true, duplicate: true });
  await execute(`INSERT IGNORE INTO stripe_events (id, type) VALUES (?, ?)`, [event.id, event.type]);

  try {
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const pi = event.data.object;
        const orderId = Number(pi.metadata?.order_id);
        if (!orderId) break;
        const order = await getOrderById(orderId);
        if (!order) break;
        try {
          const chargeId = typeof pi.latest_charge === 'string' ? pi.latest_charge : pi.latest_charge?.id ?? null;
          if (await finalizePaidOrder(orderId, { paymentIntentId: pi.id, chargeId })) {
            await audit('order.paid', { targetType: 'order', targetId: orderId, metadata: { via: 'webhook', pi: pi.id } });
          }
        } catch (e) {
          if ((e as Error).message === 'OVERSOLD') await handleOversoldAfterPayment(order, pi.id);
          else throw e;
        }
        break;
      }
      case 'charge.refunded': {
        const charge = event.data.object;
        const piId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
        if (!piId) break;
        const order = await queryOne<Row & { id: number; total_cents: number; refunded_cents: number }>(`SELECT id, total_cents, refunded_cents FROM orders WHERE stripe_payment_intent_id = ?`, [piId]);
        if (!order) break;
        // Refunds issued from the Stripe dashboard (not through Fat Tixx) are reflected here.
        if (charge.amount_refunded > Number(order.refunded_cents)) {
          const full = charge.amount_refunded >= Number(order.total_cents);
          await execute(`UPDATE orders SET refunded_cents = ?, status = ? WHERE id = ?`, [charge.amount_refunded, full ? 'refunded' : 'partially_refunded', order.id]);
          await execute(`INSERT INTO refunds (order_id, amount_cents, reason, kind, status, stripe_refund_id) VALUES (?, ?, 'Refunded in Stripe dashboard', ?, 'succeeded', NULL)`, [order.id, charge.amount_refunded - Number(order.refunded_cents), full ? 'full' : 'partial']);
          if (full) await execute(`UPDATE tickets SET status = 'refunded' WHERE order_id = ? AND status IN ('valid','used')`, [order.id]);
          await audit('order.refunded', { targetType: 'order', targetId: order.id, metadata: { via: 'stripe_dashboard', amount: charge.amount_refunded } });
        }
        break;
      }
      case 'charge.dispute.created':
      case 'charge.dispute.updated':
      case 'charge.dispute.closed': {
        const d = event.data.object;
        const piId = typeof d.payment_intent === 'string' ? d.payment_intent : d.payment_intent?.id;
        if (!piId) break;
        const order = await queryOne<Row & { id: number }>(`SELECT id FROM orders WHERE stripe_payment_intent_id = ?`, [piId]);
        if (!order) break;
        const fee = d.balance_transactions?.reduce((n, bt) => n + Math.abs(bt.fee ?? 0), 0) ?? 0;
        await execute(
          `INSERT INTO disputes (order_id, stripe_dispute_id, amount_cents, fee_cents, reason, status, closed_at) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE status = VALUES(status), fee_cents = VALUES(fee_cents), closed_at = VALUES(closed_at)`,
          [order.id, d.id, d.amount, fee, d.reason ?? null, d.status, event.type === 'charge.dispute.closed' ? new Date() : null],
        );
        break;
      }
      default:
        break;
    }
  } catch (e) {
    // Let Stripe retry: drop the idempotency marker so the retry is processed.
    await execute(`DELETE FROM stripe_events WHERE id = ?`, [event.id]);
    return new Response(`Handler error: ${(e as Error).message}`, { status: 500 });
  }
  return Response.json({ received: true });
}
