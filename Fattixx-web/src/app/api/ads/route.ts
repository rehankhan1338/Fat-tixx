import { getSession } from '@/lib/auth/session';
import { isPlacement } from '@/lib/ads/placements';
import { orderTicketKinds, pickAd, upcomingTicketKinds, viewerRoles } from '@/lib/ads/serve';
import { canAccessOrder } from '@/lib/orders/access';
import { getOrderByCode } from '@/lib/orders/queries';

/**
 * GET /api/ads?placement=event_detail&event=12 → one ad for the slot, or 204 when none is active.
 * `order=<code>` (order confirmation) lets ticket-type targeting use that order's tickets; it is only read when the
 * caller may see the order.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const placement = url.searchParams.get('placement') ?? '';
  if (!isPlacement(placement) || placement === 'email') return new Response(null, { status: 204 });
  let eventId = Number(url.searchParams.get('event')) || null;
  try {
    const session = await getSession();
    const userId = session?.user.id ?? null;
    let ticketKinds: string[] | undefined;
    const code = url.searchParams.get('order');
    if (code && placement === 'order_confirmation') {
      const order = await getOrderByCode(code.slice(0, 12));
      if (order && (await canAccessOrder(order))) { ticketKinds = await orderTicketKinds(order.id); eventId = Number(order.event_id); }
    } else if (placement === 'ticket_dashboard' && userId) {
      ticketKinds = await upcomingTicketKinds(userId);
    }
    const ad = await pickAd(placement, { eventId, signedIn: !!session, roles: await viewerRoles(userId), ticketKinds });
    if (!ad) return new Response(null, { status: 204 });
    return Response.json(ad, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    // An ad problem must never break the page.
    return new Response(null, { status: 204 });
  }
}
