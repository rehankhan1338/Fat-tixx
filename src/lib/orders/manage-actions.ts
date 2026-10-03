'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { execute, query, type Row } from '../db';
import { audit } from '../audit';
import { assertOrg, canAccessEvent } from '../authz';
import { assertSuperAdmin } from '../auth/guard';
import { sendEmail } from '../email';
import { renderEmail } from '../email-templates';
import { getEvent } from '../events/queries';
import { getOrderByCode, type OrderRow } from './queries';
import { returnAddonInventory } from './checkout';

/**
 * Order and ticket management beyond refunds: cancel an order (void its tickets without moving money),
 * void a single ticket, and — Super Admin only — delete an order outright.
 */
export type ActionState = { error?: string; ok?: boolean; message?: string } | undefined;
const str = (fd: FormData, k: string, max = 500) => String(fd.get(k) ?? '').trim().slice(0, max);

async function loadOrder(fd: FormData, needRefundPerm: boolean) {
  const orgSlug = str(fd, 'org', 64);
  const ctx = await assertOrg(orgSlug, 'organizer');
  const order = await getOrderByCode(str(fd, 'code', 12));
  if (!order || order.organization_id !== ctx.org.id) throw new Error('Order not found');
  const event = await getEvent(ctx.org.id, order.event_id);
  if (!event || !(await canAccessEvent(ctx, event))) throw new Error('Order not found');
  if (needRefundPerm && !ctx.perms.canRefund) throw new Error('You are not allowed to cancel or void tickets.');
  return { ctx, order };
}

/** Ids of this order's tickets that still count against inventory (valid or used). */
async function liveTicketIds(orderId: number): Promise<number[]> {
  const rows = await query<Row & { id: number }>(`SELECT id FROM tickets WHERE order_id = ? AND status IN ('valid','used')`, [orderId]);
  return rows.map((r) => Number(r.id));
}

/**
 * Give seats back to inventory for the given tickets. Table tickets are sold in units of
 * seats_per_unit, so partial voids round up to whole units. `sold` is UNSIGNED: subtracting past
 * zero is an error in MariaDB, so the subtraction is done in signed arithmetic and clamped.
 */
export async function returnInventoryForTickets(ticketIds: number[]): Promise<void> {
  if (ticketIds.length === 0) return;
  const rows = await query<Row & { ticket_type_id: number; n: number; seats_per_unit: number }>(
    `SELECT k.ticket_type_id, COUNT(*) AS n, t.seats_per_unit FROM tickets k JOIN ticket_types t ON t.id = k.ticket_type_id
      WHERE k.id IN (${ticketIds.map(() => '?').join(',')}) GROUP BY k.ticket_type_id, t.seats_per_unit`, ticketIds,
  );
  for (const r of rows) {
    const units = Math.ceil(Number(r.n) / Math.max(1, Number(r.seats_per_unit ?? 1)));
    await execute(`UPDATE ticket_types SET sold = GREATEST(0, CAST(sold AS SIGNED) - ?) WHERE id = ?`, [units, r.ticket_type_id]);
  }
}

function revalidateOrder(orgSlug: string, order: OrderRow) {
  revalidatePath(`/org/${orgSlug}/orders/${order.code}`);
  revalidatePath(`/org/${orgSlug}/orders`);
  revalidatePath(`/org/${orgSlug}/events/${order.event_id}`);
  revalidatePath(`/orders/${order.code}`);
  revalidatePath('/admin/orders');
}

/** Cancel an order: every ticket becomes invalid and inventory is returned. No money moves (use Refund for that). */
export async function cancelOrder(fd: FormData): Promise<ActionState> {
  let loaded;
  try { loaded = await loadOrder(fd, true); } catch (e) { return { error: (e as Error).message }; }
  const { ctx, order } = loaded;
  if (!['paid', 'partially_refunded'].includes(order.status)) return { error: 'Only paid orders can be cancelled.' };
  const reason = str(fd, 'reason', 300) || 'Cancelled by organizer';
  const live = await liveTicketIds(order.id);
  await execute(`UPDATE tickets SET status = 'cancelled' WHERE order_id = ? AND status IN ('valid','used')`, [order.id]);
  await execute(`UPDATE orders SET status = 'cancelled' WHERE id = ?`, [order.id]);
  await returnInventoryForTickets(live);
  await returnAddonInventory(order.id);
  const mail = await renderEmail('order_cancelled', { order_code: order.code, event_title: order.event_title, reason });
  await sendEmail({ to: order.buyer_email, toName: order.buyer_name, subject: mail.subject, text: mail.text, html: mail.html, related: { type: 'order', id: order.id } });
  await audit('order.cancelled', { actorUserId: ctx.session.user.id, targetType: 'order', targetId: order.id, metadata: { reason, by: 'staff' } });
  revalidateOrder(ctx.org.slug, order);
  return { ok: true, message: 'Order cancelled and tickets voided.' };
}

/** Void one ticket (lost, duplicate, fraud). The seat returns to inventory; the order stays. */
export async function voidTicket(fd: FormData): Promise<ActionState> {
  let loaded;
  try { loaded = await loadOrder(fd, true); } catch (e) { return { error: (e as Error).message }; }
  const { ctx, order } = loaded;
  const ticketId = Number(fd.get('ticket_id'));
  const reason = str(fd, 'reason', 300) || 'Voided by organizer';
  const r = await execute(`UPDATE tickets SET status = 'cancelled' WHERE id = ? AND order_id = ? AND status IN ('valid','used')`, [ticketId, order.id]);
  if (!r.affectedRows) return { error: 'Ticket not found or already invalid.' };
  await returnInventoryForTickets([ticketId]);
  await audit('ticket.voided', { actorUserId: ctx.session.user.id, targetType: 'ticket', targetId: ticketId, metadata: { order: order.code, reason } });
  revalidateOrder(ctx.org.slug, order);
  return { ok: true, message: 'Ticket voided.' };
}

/** Super Admin only: remove the order and its tickets entirely. Inventory is returned; no refund is issued. */
export async function deleteOrder(fd: FormData): Promise<ActionState> {
  const session = await assertSuperAdmin();
  const order = await getOrderByCode(str(fd, 'code', 12));
  if (!order) return { error: 'Order not found.' };
  const live = await liveTicketIds(order.id);
  await returnInventoryForTickets(live);
  if (['paid', 'partially_refunded'].includes(order.status)) await returnAddonInventory(order.id);
  await execute(`DELETE FROM orders WHERE id = ?`, [order.id]);
  await audit('order.deleted', { actorUserId: session.user.id, targetType: 'order', targetId: order.id, metadata: { code: order.code, status: order.status, total: order.total_cents, buyer: order.buyer_email, stripe: order.stripe_payment_intent_id } });
  revalidateOrder(order.org_slug, order);
  redirect(`/org/${order.org_slug}/orders?deleted=${order.code}`);
}
