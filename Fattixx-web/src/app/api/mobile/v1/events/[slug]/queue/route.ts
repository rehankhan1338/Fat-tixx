import { getPublicEventBySlug } from '@/lib/events/queries';
import { queueStatus } from '@/lib/queue';
import { fail, handle, json, v } from '@/lib/mobile/http';

export const dynamic = 'force-dynamic';

/**
 * GET → the caller's place in the virtual waiting room. The first call returns `token`; the app sends it
 * back as the X-Fx-Queue-Token header on this and the checkout request.
 */
export const GET = handle<{ params: Promise<{ slug: string }> }>(async (_req, { params }) => {
  const { slug } = await params;
  const event = await getPublicEventBySlug(v.slug(slug));
  if (!event || !event.queue_enabled || !['published', 'postponed'].includes(event.status)) return fail(404, 'Event not found.');
  return json(await queueStatus(event, { viaHeader: true }));
});
