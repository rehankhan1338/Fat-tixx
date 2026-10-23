import { placeDetails, timeZoneAt, type ResolvedPlace } from '@/lib/places';
import { clientIp } from '@/lib/request';
import { rateLimited } from '@/lib/security/bot';

/**
 * The chosen suggestion's full place and its time zone: GET /api/places/details?id=g:… (Google), or
 * ?lat=…&lon=…&country=US&region=SC for a suggestion that already carried its place (OpenStreetMap).
 */
export const dynamic = 'force-dynamic';

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET(req: Request) {
  const ip = await clientIp();
  if (rateLimited(`places-details:${ip}`, ip === 'direct' ? 2000 : 100, 10 * 60_000)) return json({ error: 'Too many lookups. Try again in a few minutes.' }, 429);
  const url = new URL(req.url);
  const id = (url.searchParams.get('id') ?? '').slice(0, 300);
  const session = (url.searchParams.get('session') ?? '').replace(/[^\w-]/g, '').slice(0, 64) || null;
  try {
    let place: ResolvedPlace | null = null;
    if (id.startsWith('g:')) {
      place = await placeDetails(id, session);
      if (!place) return json({ error: 'That place could not be found. Type the address instead.' }, 404);
    }
    const lat = place?.lat ?? Number(url.searchParams.get('lat'));
    const lon = place?.lon ?? Number(url.searchParams.get('lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return json({ error: 'Missing position.' }, 400);
    const timezone = await timeZoneAt({
      lat, lon,
      country: place?.country ?? (url.searchParams.get('country') ?? '').slice(0, 2),
      region: place?.region ?? (url.searchParams.get('region') ?? '').slice(0, 120),
    });
    return json({ place, timezone });
  } catch (e) {
    console.error('[places] details failed', e);
    return json({ error: 'Address lookup is unavailable right now.' }, 502);
  }
}
