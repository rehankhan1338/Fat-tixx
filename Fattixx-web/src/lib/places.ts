import 'server-only';
import { STATES } from './home/location';
import { guessTimeZone } from './home/timezone-guess';
import { isValidTimeZone } from './tz';

/**
 * Address suggestions, map position and time zone for the venue on /create (plan 5.6; "Events near you" needs the
 * position). Looked up on the server so no third-party script runs in the organizer's browser.
 *
 *  - GOOGLE_MAPS_API_KEY set: Google Places (New) autocomplete and details, Google Time Zone API.
 *  - Otherwise: Photon (photon.komoot.io, OpenStreetMap data, fair use) for suggestions and positions, and the
 *    built-in state / province / country table for the time zone (src/lib/home/timezone-guess.ts).
 */
export type ResolvedPlace = { name: string; address: string; city: string; region: string; postalCode: string; country: string; lat: number; lon: number };
/** `place` is filled in when the provider already gave the details (Photon); Google needs a second, details call. */
export type PlaceSuggestion = { id: string; primary: string; secondary: string; place?: ResolvedPlace };

const UA = 'Fattixx/1.0 (venue search; https://fattixx.com)';
const googleKey = () => process.env.GOOGLE_MAPS_API_KEY?.trim() || null;

export function placesProvider(): 'google' | 'photon' {
  return googleKey() ? 'google' : 'photon';
}

const clip = (s: unknown, n: number) => (typeof s === 'string' ? s.trim().slice(0, n) : '');

// ---------------------------------------------------------------------------
// Photon (OpenStreetMap)
// ---------------------------------------------------------------------------
type PhotonFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: { osm_id?: number; osm_type?: string; name?: string; housenumber?: string; street?: string; city?: string; town?: string; village?: string; district?: string; state?: string; postcode?: string; countrycode?: string; country?: string };
};

function fromPhoton(f: PhotonFeature): PlaceSuggestion | null {
  const p = f.properties ?? {};
  const [lon, lat] = f.geometry?.coordinates ?? [];
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  const country = clip(p.countrycode, 2).toUpperCase();
  const stateName = clip(p.state, 120);
  const region = country === 'US' ? STATES[stateName] ?? stateName : stateName;
  const address = [p.housenumber, p.street].filter(Boolean).join(' ').slice(0, 200);
  const city = clip(p.city ?? p.town ?? p.village ?? p.district, 120);
  const name = clip(p.name, 160);
  const primary = name || address || city;
  if (!primary) return null;
  const secondary = [name ? address : '', city, region, country && country !== 'US' ? clip(p.country, 60) : ''].filter(Boolean).join(', ');
  return {
    id: `osm:${p.osm_type ?? ''}${p.osm_id ?? `${lat},${lon}`}`,
    primary,
    secondary,
    place: { name, address, city, region: region.slice(0, 120), postalCode: clip(p.postcode, 20), country: country || 'US', lat, lon },
  };
}

async function photonSearch(q: string, near: { lat: number; lon: number } | null, limit: number): Promise<PlaceSuggestion[]> {
  const url = new URL('https://photon.komoot.io/api/');
  url.searchParams.set('q', q);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('lang', 'en');
  if (near) { url.searchParams.set('lat', String(near.lat)); url.searchParams.set('lon', String(near.lon)); }
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(6000), cache: 'no-store' });
  if (!res.ok) throw new Error(`Photon ${res.status}`);
  const json = (await res.json()) as { features?: PhotonFeature[] };
  const seen = new Set<string>();
  return (json.features ?? []).map(fromPhoton).filter((s): s is PlaceSuggestion => {
    if (!s) return false;
    const k = `${s.primary}|${s.secondary}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Google Places (New)
// ---------------------------------------------------------------------------
async function googleAutocomplete(key: string, q: string, near: { lat: number; lon: number } | null, session: string | null): Promise<PlaceSuggestion[]> {
  const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key },
    body: JSON.stringify({
      input: q,
      ...(session ? { sessionToken: session } : {}),
      ...(near ? { locationBias: { circle: { center: { latitude: near.lat, longitude: near.lon }, radius: 50000 } } } : {}),
    }),
    signal: AbortSignal.timeout(6000),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Places autocomplete ${res.status}`);
  const json = (await res.json()) as { suggestions?: { placePrediction?: { placeId?: string; text?: { text?: string }; structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } } } }[] };
  return (json.suggestions ?? []).flatMap((s) => {
    const p = s.placePrediction;
    if (!p?.placeId) return [];
    return [{ id: `g:${p.placeId}`, primary: clip(p.structuredFormat?.mainText?.text ?? p.text?.text, 160), secondary: clip(p.structuredFormat?.secondaryText?.text, 200) }];
  });
}

type GoogleComponent = { longText?: string; shortText?: string; types?: string[] };

async function googleDetails(key: string, placeId: string, session: string | null): Promise<ResolvedPlace | null> {
  const url = new URL(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`);
  if (session) url.searchParams.set('sessionToken', session);
  const res = await fetch(url, {
    headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'displayName,addressComponents,location,types' },
    signal: AbortSignal.timeout(6000),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Places details ${res.status}`);
  const p = (await res.json()) as { displayName?: { text?: string }; addressComponents?: GoogleComponent[]; location?: { latitude?: number; longitude?: number }; types?: string[] };
  const lat = p.location?.latitude, lon = p.location?.longitude;
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  const c = (type: string, short = false) => {
    const hit = p.addressComponents?.find((x) => x.types?.includes(type));
    return (short ? hit?.shortText : hit?.longText) ?? '';
  };
  const address = [c('street_number'), c('route')].filter(Boolean).join(' ');
  // a street address has no venue name of its own
  const isAddress = (p.types ?? []).some((t) => ['street_address', 'premise', 'subpremise', 'route'].includes(t));
  return {
    name: isAddress ? '' : clip(p.displayName?.text, 160),
    address: address.slice(0, 200),
    city: clip(c('locality') || c('postal_town') || c('sublocality') || c('administrative_area_level_2'), 120),
    region: clip(c('administrative_area_level_1', true), 120),
    postalCode: clip(c('postal_code'), 20),
    country: clip(c('country', true), 2).toUpperCase() || 'US',
    lat, lon,
  };
}

async function googleTimeZone(key: string, lat: number, lon: number): Promise<string | null> {
  const url = new URL('https://maps.googleapis.com/maps/api/timezone/json');
  url.searchParams.set('location', `${lat},${lon}`);
  url.searchParams.set('timestamp', String(Math.floor(Date.now() / 1000)));
  url.searchParams.set('key', key);
  const res = await fetch(url, { signal: AbortSignal.timeout(6000), cache: 'no-store' });
  if (!res.ok) return null;
  const json = (await res.json()) as { status?: string; timeZoneId?: string };
  return json.status === 'OK' && json.timeZoneId && isValidTimeZone(json.timeZoneId) ? json.timeZoneId : null;
}

// ---------------------------------------------------------------------------
// What the routes and the create action use
// ---------------------------------------------------------------------------
export async function searchPlaces(q: string, near: { lat: number; lon: number } | null, session: string | null): Promise<PlaceSuggestion[]> {
  const text = q.trim().slice(0, 200);
  if (text.length < 3) return [];
  const key = googleKey();
  return key ? googleAutocomplete(key, text, near, session) : photonSearch(text, near, 6);
}

/** The full place behind a Google suggestion (Photon suggestions already carry it). */
export async function placeDetails(id: string, session: string | null): Promise<ResolvedPlace | null> {
  const key = googleKey();
  if (!key || !id.startsWith('g:')) return null;
  return googleDetails(key, id.slice(2), session);
}

export async function timeZoneAt(w: { lat: number; lon: number; country: string; region: string }): Promise<string | null> {
  const key = googleKey();
  if (key) {
    const tz = await googleTimeZone(key, w.lat, w.lon).catch(() => null);
    if (tz) return tz;
  }
  return guessTimeZone(w);
}

/** Map position for an address typed without picking a suggestion; null when nothing matches. */
export async function geocodeAddress(parts: { name?: string; address?: string; city?: string; region?: string; postalCode?: string; country?: string }): Promise<ResolvedPlace | null> {
  const text = [parts.address || parts.name, parts.city, parts.region, parts.postalCode, parts.country && parts.country !== 'US' ? parts.country : ''].filter(Boolean).join(', ');
  if (text.length < 4) return null;
  try {
    const key = googleKey();
    if (key) {
      const [first] = await googleAutocomplete(key, text, null, null);
      return first ? await googleDetails(key, first.id.slice(2), null) : null;
    }
    const [first] = await photonSearch(text, null, 1);
    return first?.place ?? null;
  } catch {
    return null;
  }
}
