import type Stripe from 'stripe';
import { execute, queryOne, type Row } from '@/lib/db';
import { audit } from '@/lib/audit';
import { getActiveStripe, stripeClient } from '@/lib/payments/stripe';
import { finalizePaidOrder } from '@/lib/orders/checkout';
import { getOrderById } from '@/lib/orders/queries';
import { handleOversoldAfterPayment } from '@/lib/orders/access';
import { notifyStaffOfNewDispute } from '@/lib/payments/dispute-alerts';
import { recordBuyerLocation } from '@/lib/orders/location';
import { applyNewPaymentMethod, syncInvoice, syncSubscription } from '@/lib/pro/subscription';
import { applyFeeSession, FEE_KIND as SEATMAP_FEE_KIND } from '@/lib/seating/fee';
import { markCampaignPaid } from '@/lib/ads/advertisers';
import { markSponsorshipPaid } from '@/lib/sponsorships/deals';

/**
 * Stripe → Fattixx. Signature-verified, idempotent (stripe_events table), and the source of truth
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
          if (chargeId) {
            const charge = await stripeClient(active.secretKey).charges.retrieve(chargeId).catch(() => null);
            await recordBuyerLocation(orderId, charge);
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
        // Refunds issued from the Stripe dashboard (not through Fattixx) are reflected here.
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
        const evidenceDueAt = d.evidence_details?.due_by ? new Date(d.evidence_details.due_by * 1000) : null;
        const r = await execute(
          `INSERT INTO disputes (order_id, stripe_dispute_id, amount_cents, fee_cents, reason, status, evidence_due_at, closed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE status = VALUES(status), fee_cents = VALUES(fee_cents), evidence_due_at = COALESCE(VALUES(evidence_due_at), evidence_due_at), closed_at = VALUES(closed_at)`,
          [order.id, d.id, d.amount, fee, d.reason ?? null, d.status, evidenceDueAt, event.type === 'charge.dispute.closed' ? new Date() : null],
        );
        // affectedRows is 1 for a new row and 2 for an update, so staff are alerted once per dispute (plan 7.4).
        if (r.affectedRows === 1) {
          await audit('dispute.opened', { targetType: 'order', targetId: order.id, metadata: { via: 'webhook', dispute: d.id, amount: d.amount } });
          await notifyStaffOfNewDispute({ orderId: order.id, stripeDisputeId: d.id, amountCents: d.amount, currency: d.currency?.toUpperCase(), reason: d.reason ?? null, evidenceDueAt });
        }
        break;
      }
      // ---------- Fattixx Pro subscriptions ----------
      case 'checkout.session.completed': {
        const s = event.data.object;
        const pi = typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id ?? null;
        if (s.mode === 'payment' && s.metadata?.kind === SEATMAP_FEE_KIND) {
          await applyFeeSession(s);
        } else if (s.mode === 'payment' && s.payment_status === 'paid' && s.metadata?.kind === 'ad_campaign') {
          // Advertiser portal (lib/ads/advertisers.ts): paid impressions go to review.
          await markCampaignPaid(s.id, pi, s.amount_total, Number(s.metadata.campaign_id));
        } else if (s.mode === 'payment' && s.payment_status === 'paid' && s.metadata?.kind === 'sponsorship') {
          // Sponsorship marketplace (lib/sponsorships/deals.ts)
          await markSponsorshipPaid(s.id, pi, s.amount_total, Number(s.metadata.deal_id));
        } else if (s.mode === 'subscription' && s.metadata?.kind === 'fattixx_pro' && s.subscription) {
          const sub = typeof s.subscription === 'string' ? await stripeClient(active.secretKey).subscriptions.retrieve(s.subscription) : s.subscription;
          await syncSubscription(sub);
        } else if (s.mode === 'setup') {
          await applyNewPaymentMethod(s);
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const orgId = await syncSubscription(event.data.object);
        if (orgId) await audit('pro.subscription.synced', { targetType: 'organization', targetId: orgId, metadata: { via: 'webhook', type: event.type, status: event.data.object.status } });
        break;
      }
      case 'invoice.paid':
      case 'invoice.payment_failed':
      case 'invoice.finalized':
        await syncInvoice(event.data.object);
        break;
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
