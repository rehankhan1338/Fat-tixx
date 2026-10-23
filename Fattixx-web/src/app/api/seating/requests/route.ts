import { headers } from 'next/headers';
import { assertOrg } from '@/lib/authz';
import { queryOne, type Row } from '@/lib/db';
import { isStripeConfigured } from '@/lib/payments/stripe';
import { orgIsPro } from '@/lib/pro/gate';
import { rateLimited } from '@/lib/security/bot';
import { createFeeCheckout } from '@/lib/seating/fee';
import { createSeatMapRequest } from '@/lib/seating/requests';
import { saveFloorPlanUpload } from '@/lib/uploads';

/**
 * POST /api/seating/requests (multipart): an organizer requests a new seat map and uploads the venue's floor plan.
 * A Route Handler rather than a Server Action because floor plans are bigger than the 1 MB Server Action limit.
 * Answers { redirect } — Stripe Checkout for the set-up fee when there is one, otherwise the request's page.
 */
export const dynamic = 'force-dynamic';

const str = (fd: FormData, k: string, max: number) => String(fd.get(k) ?? '').trim().slice(0, max);
const fail = (error: string, status = 400) => Response.json({ error }, { status });

export async function POST(req: Request) {
  // The session cookie is SameSite=strict; the Origin check is a second line against cross-site posts.
  const h = await headers();
  const origin = h.get('origin');
  if (origin && new URL(origin).host !== (h.get('x-forwarded-host') ?? h.get('host'))) return fail('Cross-site request refused.', 403);

  let fd: FormData;
  try { fd = await req.formData(); } catch { return fail('The upload could not be read. The floor plan must be 4 MB or smaller.'); }
  let ctx;
  try { ctx = await assertOrg(str(fd, 'org', 64), 'organizer'); } catch { return fail('Sign in as an organizer of this organization.', 403); }
  if (!orgIsPro(ctx.org)) return fail('Reserved seating is part of Fattixx Pro.', 403);
  if (rateLimited(`seatmap-request:${ctx.session.user.id}`, 10, 60 * 60_000)) return fail('You have sent many requests in the last hour. Please try again later.', 429);

  const venueId = Number(str(fd, 'venue_id', 12)) || null;
  let venueName = str(fd, 'venue_name', 160), venueCity = str(fd, 'venue_city', 120) || null;
  if (venueId) {
    const v = await queryOne<Row & { name: string; city: string | null }>(`SELECT name, city FROM venues WHERE id = ? AND organization_id = ?`, [venueId, ctx.org.id]);
    if (!v) return fail('Choose one of your venues.');
    venueName = v.name; venueCity = v.city;
  }
  if (venueName.length < 2) return fail('Choose the venue, or type its name.');
  const mapName = str(fd, 'map_name', 160) || `${venueName} seating`;
  const notes = str(fd, 'notes', 5000) || null;
  const file = fd.get('floor_plan');
  if (!(file instanceof File) || file.size === 0) return fail('Upload the venue’s floor plan or official seating chart (PDF, JPG or PNG).');

  let floorPlan;
  try { floorPlan = await saveFloorPlanUpload(file); } catch (e) { return fail((e as Error).message); }
  const r = await createSeatMapRequest({ organizationId: ctx.org.id, userId: ctx.session.user.id, venueId, venueName, venueCity, mapName, notes, floorPlan, baseMapId: null });

  const page = `/org/${ctx.org.slug}/seating/${r.id}`;
  if (Number(r.fee_cents) > 0 && (await isStripeConfigured())) {
    try { return Response.json({ redirect: await createFeeCheckout(r, ctx.session.user.email) }); } catch (e) { console.error('[seating] fee checkout failed', e); }
  }
  return Response.json({ redirect: page });
}
