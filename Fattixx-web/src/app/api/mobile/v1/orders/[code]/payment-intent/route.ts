import { canAccessOrder } from '@/lib/orders/access';
import { createPaymentIntentForOrder } from '@/lib/orders/payment';
import { getOrderByCode } from '@/lib/orders/queries';
import { fail, handle, json, readJson, v } from '@/lib/mobile/http';

export const dynamic = 'force-dynamic';

/** POST { t } → { clientSecret, publishableKey, mode } for Stripe's PaymentSheet. */
export const POST = handle<{ params: Promise<{ code: string }> }>(async (req, { params }) => {
  const { code } = await params;
  const body = await readJson(req, 2 * 1024);
  const order = await getOrderByCode(v.orderCode(code));
  if (!order || !(await canAccessOrder(order, v.orderToken(body.t)))) return fail(404, 'Order not found.');
  const r = await createPaymentIntentForOrder(order);
  if (r.error || !r.clientSecret) return fail(400, r.error ?? 'Payment could not be started.');
  return json({ clientSecret: r.clientSecret, publishableKey: r.publishableKey, mode: r.mode, amountCents: Number(order.total_cents), currency: order.currency });
});
