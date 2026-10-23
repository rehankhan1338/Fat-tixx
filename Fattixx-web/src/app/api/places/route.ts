import { searchPlaces } from '@/lib/places';
import { clientIp } from '@/lib/request';
import { rateLimited } from '@/lib/security/bot';

/** Venue / address suggestions for the /create location field: GET /api/places?q=…&lat=…&lon=…&session=… */
export const dynamic = 'force-dynamic';

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET(req: Request) {
  const ip = await clientIp();
  // Without a trusted proxy every visitor shares the "direct" bucket, so it gets a wider allowance.
  if (rateLimited(`places:${ip}`, ip === 'direct' ? 3000 : 150, 10 * 60_000)) return json({ error: 'Too many searches. Try again in a few minutes.' }, 429);
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') ?? '').slice(0, 200);
  const lat = Number(url.searchParams.get('lat')), lon = Number(url.searchParams.get('lon'));
  const near = url.searchParams.has('lat') && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
  const session = (url.searchParams.get('session') ?? '').replace(/[^\w-]/g, '').slice(0, 64) || null;
  try {
    return json({ suggestions: await searchPlaces(q, near, session) });
  } catch (e) {
    console.error('[places] search failed', e);
    return json({ suggestions: [], error: 'Address search is unavailable right now. Type the address instead.' }, 502);
  }
}
