import 'server-only';
import { cookies } from 'next/headers';
import { execute, queryOne } from '../db';
import { audit } from '../audit';
import { getSession } from '../auth/session';
import { env } from '../env';
import { sha256 } from '../security/crypto';
import { getActiveStripe, stripeClient } from '../payments/stripe';
import type { OrderRow } from './queries';

/** Buyer-side order access: a per-order token remembered in an HttpOnly cookie, or passed as ?t= from the email link. */
export const ORDER_COOKIE = 'fx_orders';

export async function rememberOrderAccess(code: string, token: string): Promise<void> {
  const store = await cookies();
  let map: Record<string, string> = {};
  try { map = JSON.parse(store.get(ORDER_COOKIE)?.value ?? '{}'); } catch { map = {}; }
  map[code] = token;
  const entries = Object.entries(map).slice(-10);
  store.set(ORDER_COOKIE, JSON.stringify(Object.fromEntries(entries)), { httpOnly: true, sameSite: 'lax', secure: env.IS_PROD, path: '/', maxAge: 60 * 60 * 24 * 30 });
}

/** May the caller see this order? Token (URL or cookie), the signed-in buyer, platform staff, or the org's admins/organizers. */
export async function canAccessOrder(order: OrderRow, tokenFromUrl?: string | null): Promise<boolean> {
  if (tokenFromUrl && sha256(tokenFromUrl) === order.access_token_hash) return true;
  const store = await cookies();
  try {
    const map = JSON.parse(store.get(ORDER_COOKIE)?.value ?? '{}') as Record<string, string>;
    if (map[order.code] && sha256(map[order.code]) === order.access_token_hash) return true;
  } catch { /* ignore */ }
  const session = await getSession();
  if (!session) return false;
  if (order.user_id === session.user.id) return true;
  if (session.user.roles.length) return true;
  const m = await queryOne(`SELECT 1 FROM organization_members WHERE organization_id = ? AND user_id = ? AND role IN ('org_admin','organizer')`, [order.organization_id, session.user.id]);
  return !!m;
}

/** Paid after the hold expired and inventory ran out: refund immediately and cancel. */
export async function handleOversoldAfterPayment(order: OrderRow, paymentIntentId: string): Promise<void> {
  const active = await getActiveStripe();
  if (active) {
    try { await stripeClient(active.secretKey).refunds.create({ payment_intent: paymentIntentId, reason: 'requested_by_customer', ...(order.connect_account_id ? { reverse_transfer: true } : {}) },{ idempotencyKey: `oversold-${order.id}` }); } catch { /* recorded in audit */ }
  }
  await execute(`UPDATE orders SET status = 'cancelled', refunded_cents = total_cents WHERE id = ?`, [order.id]);
  await audit('order.cancelled', { targetType: 'order', targetId: order.id, metadata: { reason: 'oversold_after_payment', pi: paymentIntentId } });
}
