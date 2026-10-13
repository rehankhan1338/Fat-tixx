import { manageAttendees } from '@/lib/mobile/manage';
import { handle, json, requireUser, v } from '@/lib/mobile/http';

export const dynamic = 'force-dynamic';

/** GET ?q= (Bearer) → the door list: every ticket with its check-in state, filtered by name, email or code. */
export const GET = handle<{ params: Promise<{ org: string; eventId: string }> }>(async (req, { params }) => {
  await requireUser();
  const { org, eventId } = await params;
  const q = (new URL(req.url).searchParams.get('q') ?? '').slice(0, 120);
  return json(await manageAttendees(v.slug(org, 'organization'), v.int(eventId, 'event', { min: 1 }), q));
});
