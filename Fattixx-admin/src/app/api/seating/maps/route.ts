import { headers } from 'next/headers';
import { assertPlatformRole } from '@/lib/auth/guard';
import { queryOne, type Row } from '@/lib/db';
import { rateLimited } from '@/lib/security/bot';
import { createStaffMap } from '@/lib/seating/requests';
import { saveFloorPlanUpload } from '@/lib/uploads';

/**
 * POST /api/seating/maps (multipart, Super Admin): start a new seat map without an organizer's request, for one
 * organization or for the Venue Library, with an optional floor plan to trace. A Route Handler rather than a Server
 * Action because floor plans are bigger than the 1 MB Server Action limit. Answers { redirect } to the map's builder.
 */
export const dynamic = 'force-dynamic';

const str = (fd: FormData, k: string, max: number) => String(fd.get(k) ?? '').trim().slice(0, max);
const fail = (error: string, status = 400) => Response.json({ error }, { status });

export async function POST(req: Request) {
  // The session cookie is SameSite=strict; the Origin check is a second line against cross-site posts.
  const h = await headers();
  const origin = h.get('origin');
  if (origin && new URL(origin).host !== (h.get('x-forwarded-host') ?? h.get('host'))) return fail('Cross-site request refused.', 403);

  let session;
  try { session = await assertPlatformRole(['super_admin']); } catch { return fail('Only a Super Admin can create seat maps.', 403); }
  let fd: FormData;
  try { fd = await req.formData(); } catch { return fail('The upload could not be read. The floor plan must be 4 MB or smaller.'); }
  if (rateLimited(`seatmap-create:${session.user.id}`, 30, 60 * 60_000)) return fail('Many maps were created in the last hour. Try again later.', 429);

  const orgId = Number(str(fd, 'organization_id', 12)) || null;
  if (orgId && !(await queryOne<Row>(`SELECT id FROM organizations WHERE id = ?`, [orgId]))) return fail('Choose an organization from the list.');
  const venueName = str(fd, 'venue_name', 160);
  if (venueName.length < 2) return fail('Enter the venue’s name.');
  const mapName = str(fd, 'map_name', 160) || `${venueName} seating`;

  let floorPlan = null;
  const file = fd.get('floor_plan');
  if (file instanceof File && file.size > 0) {
    try { floorPlan = await saveFloorPlanUpload(file); } catch (e) { return fail((e as Error).message); }
  }
  const id = await createStaffMap({
    organizationId: orgId, userId: session.user.id, mapName, venueName,
    venueCity: str(fd, 'venue_city', 120) || null, venueRegion: str(fd, 'venue_region', 120) || null, floorPlan,
  });
  return Response.json({ redirect: `/admin/seating/maps/${id}` });
}
