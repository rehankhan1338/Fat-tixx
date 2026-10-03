/**
 * Time-zone helpers without a library. Events store UTC instants plus an IANA zone name;
 * forms edit "wall clock" values (datetime-local) in that zone.
 */

export const COMMON_TIMEZONES = [
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles',
  'America/Anchorage', 'Pacific/Honolulu', 'America/Toronto', 'America/Vancouver', 'America/Mexico_City',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Stockholm', 'Europe/Madrid', 'Europe/Rome',
  'Asia/Dubai', 'Asia/Karachi', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney',
];

export function isValidTimeZone(tz: string): boolean {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

/** Offset (minutes) of `tz` from UTC at the given instant. */
function offsetMinutes(tz: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = Object.fromEntries(dtf.formatToParts(at).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** "2026-10-31T20:00" in `tz` → UTC Date. */
export function wallClockToUtc(local: string, tz: string): Date | null {
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
  // Two passes handle DST transitions correctly.
  let utc = guess - offsetMinutes(tz, new Date(guess)) * 60_000;
  utc = guess - offsetMinutes(tz, new Date(utc)) * 60_000;
  return new Date(utc);
}

/** UTC Date → "YYYY-MM-DDTHH:mm" wall clock in `tz` (for datetime-local inputs). */
export function utcToWallClock(date: Date, tz: string): string {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(date).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** Move an instant by whole days / months while keeping the same wall-clock time in `tz` (DST-safe). */
export function shiftWallClock(date: Date, tz: string, by: { days?: number; months?: number }): Date {
  const wall = utcToWallClock(date, tz);
  const m = wall.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/)!;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
  if (by.months) {
    const day = d.getUTCDate();
    d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + by.months);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
  }
  if (by.days) d.setUTCDate(d.getUTCDate() + by.days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return wallClockToUtc(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`, tz)!;
}

export function formatEventDate(date: Date, tz: string, opts: { withTime?: boolean; withZone?: boolean } = {}): string {
  const { withTime = true, withZone = true } = opts;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
    ...(withTime && withZone ? { timeZoneName: 'short' } : {}),
  }).format(date);
}

export function formatTimeOnly(date: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(date);
}
