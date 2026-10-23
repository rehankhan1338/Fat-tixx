import { getPublicEventBySlug } from '@/lib/events/queries';
import { expireStaleHolds } from '@/lib/orders/checkout';
import { listEventSeats, STATUS_CODE } from '@/lib/seating/queries';

/**
 * GET /api/seating/events/<slug>[?key=…] → { seats: [[id, status letter], …] }: the live status of every seat, so the
 * seat picker can grey out seats other buyers take while the pop-up is open. Statuses only; never who bought what.
 * Private events answer only with their link key, like the event page.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const event = await getPublicEventBySlug((await params).slug);
  const key = new URL(req.url).searchParams.get('key');
  if (!event || !['published', 'postponed'].includes(event.status) || (event.visibility === 'private' && (!event.private_key || key !== event.private_key))) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  await expireStaleHolds();
  const seats = await listEventSeats(event.id);
  return Response.json({ seats: seats.map((s) => [s.id, STATUS_CODE[s.status]]) }, { headers: { 'Cache-Control': 'no-store' } });
}
