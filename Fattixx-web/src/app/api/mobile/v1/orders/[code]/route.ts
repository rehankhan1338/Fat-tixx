import { expireStaleHolds } from '@/lib/orders/checkout';
import { canAccessOrder } from '@/lib/orders/access';
import { getOrderByCode } from '@/lib/orders/queries';
import { mobileOrderDetail } from '@/lib/mobile/orders';
import { fail, handle, json, v } from '@/lib/mobile/http';

export const dynamic = 'force-dynamic';

/**
 * GET ?t=<access token> (Bearer optional) → the order with its tickets and signed QR payloads.
 * Access: the per-order token, or the signed-in buyer, or the organiser's team / platform staff.
 */
export const GET = handle<{ params: Promise<{ code: string }> }>(async (req, { params }) => {
  const { code } = await params;
  await expireStaleHolds();
  const order = await getOrderByCode(v.orderCode(code));
  const token = v.orderToken(new URL(req.url).searchParams.get('t'));
  if (!order || !(await canAccessOrder(order, token))) return fail(404, 'Order not found.');
  return json(await mobileOrderDetail(order));
});
