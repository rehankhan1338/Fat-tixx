import { mobileEventDetail } from '@/lib/mobile/events';
import { fail, handle, json, optionalUser, v } from '@/lib/mobile/http';

export const dynamic = 'force-dynamic';

/** GET ?code=<access code>&key=<private link key> → full event detail with ticket options. */
export const GET = handle<{ params: Promise<{ slug: string }> }>(async (req, { params }) => {
  const { slug } = await params;
  const url = new URL(req.url);
  const detail = await mobileEventDetail(v.slug(slug), {
    accessCode: url.searchParams.get('code') ?? '',
    linkKey: url.searchParams.get('key'),
    session: await optionalUser(),
  });
  if (!detail) return fail(404, 'Event not found.');
  return json(detail);
});
