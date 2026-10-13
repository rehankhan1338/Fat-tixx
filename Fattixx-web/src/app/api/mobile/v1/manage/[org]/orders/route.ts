import { manageOrders } from '@/lib/mobile/manage';
import { handle, json, requireUser, v } from '@/lib/mobile/http';

export const dynamic = 'force-dynamic';

/** GET ?q=&eventId= (Bearer, organizer or above) → order search across the organisation. */
export const GET = handle<{ params: Promise<{ org: string }> }>(async (req, { params }) => {
  await requireUser();
  const { org } = await params;
  const sp = new URL(req.url).searchParams;
  const eventId = sp.get('eventId');
  return json(await manageOrders(v.slug(org, 'organization'), sp.get('q') ?? '', eventId && /^\d+$/.test(eventId) ? Number(eventId) : undefined));
});
