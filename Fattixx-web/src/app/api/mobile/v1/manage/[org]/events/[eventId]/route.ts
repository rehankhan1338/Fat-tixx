import { manageEventDetail } from '@/lib/mobile/manage';
import { handle, json, requireUser, v } from '@/lib/mobile/http';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ org: string; eventId: string }> };

/** GET (Bearer) → the event's check-in picture: live counts, ticket types (no prices), recent scans, override / undo rights. */
export const GET = handle<Ctx>(async (_req, { params }) => {
  await requireUser();
  const { org, eventId } = await params;
  return json(await manageEventDetail(v.slug(org, 'organization'), v.int(eventId, 'event', { min: 1 })));
});
