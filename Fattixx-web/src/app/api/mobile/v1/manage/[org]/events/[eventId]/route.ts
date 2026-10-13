import { revalidatePath } from 'next/cache';
import { manageEventDetail, manageSetEventStatus } from '@/lib/mobile/manage';
import { handle, json, readJson, requireUser, v } from '@/lib/mobile/http';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ org: string; eventId: string }> };

/** GET (Bearer) → event management detail: counts, sales (not for staff), ticket types, recent scans. */
export const GET = handle<Ctx>(async (_req, { params }) => {
  await requireUser();
  const { org, eventId } = await params;
  return json(await manageEventDetail(v.slug(org, 'organization'), v.int(eventId, 'event', { min: 1 })));
});

/** POST { status: 'draft' | 'published' | 'completed' } (Bearer, organizer or above). */
export const POST = handle<Ctx>(async (req, { params }) => {
  await requireUser();
  const { org, eventId } = await params;
  const body = await readJson(req, 2 * 1024);
  const slug = v.slug(org, 'organization');
  const id = v.int(eventId, 'event', { min: 1 });
  await manageSetEventStatus(slug, id, v.str(body.status, 20, 'status', { required: true }));
  revalidatePath(`/org/${slug}/events/${id}`);
  revalidatePath('/');
  return json({ ok: true });
});
