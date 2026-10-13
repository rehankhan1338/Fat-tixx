import { audit } from '@/lib/audit';
import { execute } from '@/lib/db';
import { canAccessOrder } from '@/lib/orders/access';
import { getOrderByCode } from '@/lib/orders/queries';
import { fail, handle, json, readJson, v } from '@/lib/mobile/http';

export const dynamic = 'force-dynamic';

/** POST { t, ticketId, name } → put the attendee's name on a ticket that has not been used yet. */
export const POST = handle<{ params: Promise<{ code: string }> }>(async (req, { params }) => {
  const { code } = await params;
  const body = await readJson(req, 2 * 1024);
  const order = await getOrderByCode(v.orderCode(code));
  if (!order || !(await canAccessOrder(order, v.orderToken(body.t)))) return fail(404, 'Order not found.');
  const ticketId = v.int(body.ticketId, 'ticket', { min: 1 });
  const name = v.str(body.name, 160, 'name', { required: true, min: 2 });
  // A ticket the buyer transferred away belongs to its recipient now; the buyer cannot rename it.
  const r = await execute(
    `UPDATE tickets SET attendee_name = ? WHERE id = ? AND order_id = ? AND status = 'valid' AND NOT (transferred_from_id IS NOT NULL AND LOWER(COALESCE(attendee_email, '')) <> LOWER(?))`,
    [name, ticketId, order.id, order.buyer_email],
  );
  if (!r.affectedRows) return fail(400, 'Ticket not found or already used.');
  await audit('order.attendee_updated', { actorUserId: order.user_id, targetType: 'ticket', targetId: ticketId });
  return json({ ok: true });
});
