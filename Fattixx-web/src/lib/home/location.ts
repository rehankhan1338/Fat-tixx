import type { Place } from "./types";

/* GeoJS supplies IP location; BigDataCloud reverse-geocodes browser GPS coordinates. */

const STATES: Record<string, string> = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA", Colorado: "CO", Connecticut: "CT",
  Delaware: "DE", "District of Columbia": "DC", Florida: "FL", Georgia: "GA", Hawaii: "HI", Idaho: "ID", Illinois: "IL",
  Indiana: "IN", Iowa: "IA", Kansas: "KS", Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD",
  Massachusetts: "MA", Michigan: "MI", Minnesota: "MN", Mississippi: "MS", Missouri: "MO", Montana: "MT",
  Nebraska: "NE", Nevada: "NV", "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY",
  "North Carolina": "NC", "North Dakota": "ND", Ohio: "OH", Oklahoma: "OK", Oregon: "OR", Pennsylvania: "PA",
  "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT",
  Vermont: "VT", Virginia: "VA", Washington: "WA", "West Virginia": "WV", Wisconsin: "WI", Wyoming: "WY",
};

export const LOC_KEY = "fx_loc"; // localStorage key for a place the visitor picked

export function placeLabel(city?: string, region?: string, country?: string): string {
  if (!city) return "";
  if (country && country !== "US") return `${city}, ${country}`;
  return city + (region ? ", " + (STATES[region] || region) : "");
}

async function fetchJSON<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(String(r.status));
  return r.json() as Promise<T>;
}

export async function byIP(): Promise<Place> {
  const d = await fetchJSON<{ city?: string; region?: string; country_code?: string; latitude?: string; longitude?: string }>(
    "https://get.geojs.io/v1/ip/geo.json",
  );
  const lat = parseFloat(d.latitude ?? "");
  const lon = parseFloat(d.longitude ?? "");
  if (!d.city || isNaN(lat)) throw new Error("no city");
  return { label: placeLabel(d.city, d.region, d.country_code), lat, lon, src: "ip" };
}

export async function byGPS(): Promise<Place> {
  const p = await new Promise<GeolocationPosition>((ok, fail) => {
    if (!navigator.geolocation) return fail(new Error("unsupported"));
    navigator.geolocation.getCurrentPosition(ok, fail, { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 });
  });
  const lat = p.coords.latitude;
  const lon = p.coords.longitude;
  try {
    const d = await fetchJSON<{ city?: string; locality?: string; principalSubdivisionCode?: string; principalSubdivision?: string; countryCode?: string }>(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`,
    );
    const st = (d.principalSubdivisionCode || "").split("-")[1] || d.principalSubdivision;
    return { label: placeLabel(d.city || d.locality, st, d.countryCode), lat, lon, src: "gps" };
  } catch {
    return { label: "Your location", lat, lon, src: "gps" };
  }
}

/* Precise location if the visitor already allowed it for this site, otherwise the IP guess */
export async function autoLocate(): Promise<Place> {
  try {
    if (navigator.permissions?.query) {
      const s = await navigator.permissions.query({ name: "geolocation" as PermissionName });
      if (s.state === "granted") return await byGPS();
    }
  } catch {
    /* fall through to IP */
  }
  return byIP();
}

export function loadSavedPlace(): Place | null {
  try {
    const p = JSON.parse(localStorage.getItem(LOC_KEY) || "null");
    return p && p.label && typeof p.lat === "number" ? p : null;
  } catch {
    return null;
  }
}

export function savePlace(p: Place | null) {
  try {
    if (p) localStorage.setItem(LOC_KEY, JSON.stringify(p));
    else localStorage.removeItem(LOC_KEY);
  } catch {
    /* storage blocked: ignore */
  }
}
