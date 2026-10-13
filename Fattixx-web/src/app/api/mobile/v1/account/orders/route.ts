import { listOrdersForEmail } from '@/lib/orders/queries';
import { mobileOrderSummary } from '@/lib/mobile/orders';
import { handle, json, requireUser } from '@/lib/mobile/http';

export const dynamic = 'force-dynamic';

/**
 * GET (Bearer) → the user's orders. Until the email is confirmed only orders placed while signed in are
 * listed; guest orders with the same address attach once the address is verified (same rule as the website).
 */
export const GET = handle(async () => {
  const session = await requireUser();
  const orders = await listOrdersForEmail(session.user.emailVerified ? session.user.email : null, session.user.id);
  return json({ orders: orders.map(mobileOrderSummary), emailVerified: session.user.emailVerified });
});
