import { canAccessOrder } from '@/lib/orders/access';
import { completeFreeOrderNow, confirmPaidOrderWithStripe } from '@/lib/orders/payment';
import { getOrderByCode } from '@/lib/orders/queries';
import { fail, handle, json, readJson, v } from '@/lib/mobile/http';

export const dynamic = 'force-dynamic';

/**
 * POST { t } → finalize the order: verifies the payment with Stripe (or issues a free order's tickets)
 * and returns { ok, status }. Idempotent; the Stripe webhook may have finished first.
 */
export const POST = handle<{ params: Promise<{ code: string }> }>(async (req, { params }) => {
  const { code } = await params;
  const body = await readJson(req, 2 * 1024);
  const order = await getOrderByCode(v.orderCode(code));
  if (!order || !(await canAccessOrder(order, v.orderToken(body.t)))) return fail(404, 'Order not found.');
  const r = Number(order.total_cents) === 0 ? await completeFreeOrderNow(order) : await confirmPaidOrderWithStripe(order);
  if (!r.ok) return fail(402, r.error ?? 'Payment could not be confirmed.');
  return json({ ok: true });
});
