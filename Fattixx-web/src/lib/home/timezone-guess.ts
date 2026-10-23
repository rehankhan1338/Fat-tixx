/*
 * The event's time zone from where it happens (plan 5.6), when no time-zone service is configured (Google's Time Zone
 * API is used with GOOGLE_MAPS_API_KEY; see src/lib/places.ts). US states and Canadian provinces, with the split states
 * divided along their usual lines, plus single-zone countries. Returns null when it can't tell; the form then keeps
 * the zone it had.
 */

type Where = { country: string; region: string; lat: number | null; lon: number | null };

const US: Record<string, string> = {
  CT: "America/New_York", DE: "America/New_York", DC: "America/New_York", GA: "America/New_York", ME: "America/New_York", MD: "America/New_York",
  MA: "America/New_York", NH: "America/New_York", NJ: "America/New_York", NY: "America/New_York", NC: "America/New_York", OH: "America/New_York",
  PA: "America/New_York", RI: "America/New_York", SC: "America/New_York", VT: "America/New_York", VA: "America/New_York", WV: "America/New_York",
  MI: "America/Detroit", IN: "America/Indiana/Indianapolis", KY: "America/New_York", TN: "America/Chicago", FL: "America/New_York",
  AL: "America/Chicago", AR: "America/Chicago", IL: "America/Chicago", IA: "America/Chicago", LA: "America/Chicago", MN: "America/Chicago",
  MS: "America/Chicago", MO: "America/Chicago", OK: "America/Chicago", WI: "America/Chicago", TX: "America/Chicago", KS: "America/Chicago",
  NE: "America/Chicago", ND: "America/Chicago", SD: "America/Chicago",
  CO: "America/Denver", MT: "America/Denver", NM: "America/Denver", UT: "America/Denver", WY: "America/Denver", ID: "America/Boise",
  AZ: "America/Phoenix", CA: "America/Los_Angeles", NV: "America/Los_Angeles", WA: "America/Los_Angeles", OR: "America/Los_Angeles",
  AK: "America/Anchorage", HI: "Pacific/Honolulu", PR: "America/Puerto_Rico", VI: "America/St_Thomas", GU: "Pacific/Guam",
};

/** States split between two zones: the other zone, by position. */
function usSplit(state: string, lat: number, lon: number): string | null {
  switch (state) {
    case "FL": return lon < -85.0 ? "America/Chicago" : null; // the panhandle west of the Apalachicola
    case "KY": return lon < -86.0 ? "America/Chicago" : null;
    case "TN": return lon > -84.95 || (lat < 35.3 && lon > -85.6) ? "America/New_York" : null; // East Tennessee, Chattanooga
    case "IN": return (lat > 41.0 && lon < -86.9) || (lat < 38.5 && lon < -86.8) ? "America/Chicago" : null; // Gary, Evansville
    case "MI": return lat > 45.1 && lon < -87.6 ? "America/Menominee" : null;
    case "TX": return lon < -104.9 ? "America/Denver" : null; // El Paso
    case "KS": return lon < -101.4 ? "America/Denver" : null;
    case "NE": return lon < -101.2 ? "America/Denver" : null;
    case "ND": return lon < -101.5 && lat < 47.6 ? "America/Denver" : null;
    case "SD": return lon < -100.5 ? "America/Denver" : null; // west of the Missouri
    case "ID": return lat > 45.5 ? "America/Los_Angeles" : null; // the panhandle
    case "OR": return lon > -118.0 && lat < 44.5 ? "America/Boise" : null; // Malheur County
    default: return null;
  }
}

const CA: Record<string, string> = {
  BC: "America/Vancouver", AB: "America/Edmonton", SK: "America/Regina", MB: "America/Winnipeg", ON: "America/Toronto", QC: "America/Toronto",
  NB: "America/Halifax", NS: "America/Halifax", PE: "America/Halifax", NL: "America/St_Johns", YT: "America/Whitehorse", NT: "America/Yellowknife", NU: "America/Iqaluit",
};

const AU: Record<string, string> = {
  NSW: "Australia/Sydney", ACT: "Australia/Sydney", VIC: "Australia/Melbourne", TAS: "Australia/Hobart", QLD: "Australia/Brisbane",
  SA: "Australia/Adelaide", WA: "Australia/Perth", NT: "Australia/Darwin",
};

const COUNTRY: Record<string, string> = {
  GB: "Europe/London", IE: "Europe/Dublin", FR: "Europe/Paris", DE: "Europe/Berlin", ES: "Europe/Madrid", IT: "Europe/Rome", NL: "Europe/Amsterdam",
  BE: "Europe/Brussels", PT: "Europe/Lisbon", CH: "Europe/Zurich", AT: "Europe/Vienna", SE: "Europe/Stockholm", NO: "Europe/Oslo", DK: "Europe/Copenhagen",
  FI: "Europe/Helsinki", PL: "Europe/Warsaw", CZ: "Europe/Prague", GR: "Europe/Athens", HU: "Europe/Budapest", RO: "Europe/Bucharest", TR: "Europe/Istanbul",
  IS: "Atlantic/Reykjavik", JP: "Asia/Tokyo", KR: "Asia/Seoul", IN: "Asia/Kolkata", PK: "Asia/Karachi", AE: "Asia/Dubai", SA: "Asia/Riyadh", QA: "Asia/Qatar",
  IL: "Asia/Jerusalem", SG: "Asia/Singapore", PH: "Asia/Manila", TH: "Asia/Bangkok", HK: "Asia/Hong_Kong", NZ: "Pacific/Auckland", ZA: "Africa/Johannesburg",
  NG: "Africa/Lagos", GH: "Africa/Accra", KE: "Africa/Nairobi", EG: "Africa/Cairo", JM: "America/Jamaica", BS: "America/Nassau", TT: "America/Port_of_Spain",
  BB: "America/Barbados", DO: "America/Santo_Domingo", CO: "America/Bogota", PE: "America/Lima", CL: "America/Santiago", AR: "America/Argentina/Buenos_Aires",
  MX: "America/Mexico_City", CR: "America/Costa_Rica", PA: "America/Panama",
};

export function guessTimeZone(w: Where): string | null {
  const country = w.country.trim().toUpperCase();
  const region = w.region.trim().toUpperCase();
  const pos = w.lat != null && w.lon != null && Number.isFinite(w.lat) && Number.isFinite(w.lon) ? { lat: w.lat, lon: w.lon } : null;
  if (country === "US" || country === "") {
    const base = US[region];
    if (!base) return null;
    return (pos && usSplit(region, pos.lat, pos.lon)) || base;
  }
  if (country === "CA") {
    if (region === "ON" && pos && pos.lon < -90) return "America/Winnipeg"; // northwestern Ontario
    return CA[region] ?? null;
  }
  if (country === "AU") return AU[region] ?? null;
  return COUNTRY[country] ?? null;
}
