import { getOrderByCode } from '@/lib/orders/queries';
import { rememberOrderAccess } from '@/lib/orders/access';
import { sha256 } from '@/lib/security/crypto';

/**
 * Hand-off from the embeddable checkout widget: the widget opens this URL in a new top-level tab.
 * The order token is verified, stored in the buyer's first-party order cookie, and the buyer lands on
 * the normal Fat Tixx checkout page (payment fields are never shown inside a third-party iframe).
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code') ?? '';
  const token = url.searchParams.get('t') ?? '';
  const order = /^FTX-[A-Z0-9]{4,8}$/.test(code) ? await getOrderByCode(code) : null;
  if (!order || !token || sha256(token) !== order.access_token_hash) return Response.redirect(new URL('/', req.url), 302);
  await rememberOrderAccess(order.code, token);
  return Response.redirect(new URL(`/checkout/${order.code}`, req.url), 302);
}
