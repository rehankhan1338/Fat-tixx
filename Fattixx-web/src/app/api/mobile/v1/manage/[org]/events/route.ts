import { manageEvents } from '@/lib/mobile/manage';
import { handle, json, requireUser, v } from '@/lib/mobile/http';

export const dynamic = 'force-dynamic';

/** GET ?filter=upcoming|past|all (Bearer) → events the member may see, with sales and check-in figures. */
export const GET = handle<{ params: Promise<{ org: string }> }>(async (req, { params }) => {
  await requireUser();
  const { org } = await params;
  const f = new URL(req.url).searchParams.get('filter');
  const filter = f === 'past' || f === 'all' ? f : 'upcoming';
  return json(await manageEvents(v.slug(org, 'organization'), filter));
});
