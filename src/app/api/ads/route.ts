import { getSession } from '@/lib/auth/session';
import { isPlacement } from '@/lib/ads/placements';
import { pickAd } from '@/lib/ads/serve';

/** GET /api/ads?placement=event_detail&event=12 → one ad for the slot, or 204 when none is active. */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const placement = url.searchParams.get('placement') ?? '';
  if (!isPlacement(placement) || placement === 'email') return new Response(null, { status: 204 });
  const eventId = Number(url.searchParams.get('event')) || null;
  try {
    const ad = await pickAd(placement, { eventId, signedIn: !!(await getSession()) });
    if (!ad) return new Response(null, { status: 204 });
    return Response.json(ad, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    // An ad problem must never break the page.
    return new Response(null, { status: 204 });
  }
}
