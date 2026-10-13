import 'server-only';

/**
 * Lightweight bot protection for public forms (checkout, registration, waitlist, organizer applications;
 * plan 6.2 / 12). Three layers, none of which needs a third-party service:
 *
 *  1. Honeypot: a visually hidden "website" field that people never fill in.
 *  2. Fill time: the form records when it was rendered (`_ft`); submissions faster than MIN_FILL_MS are bots.
 *     Missing `_ft` (no JavaScript) is allowed, so the forms keep working without scripts.
 *  3. Per-IP rate limit (in memory, per app instance) on top of the database login throttling.
 *
 * A CAPTCHA (e.g. Cloudflare Turnstile) can be added later behind the same `botCheck` call.
 */
const MIN_FILL_MS = 800;

export function botCheck(fd: FormData): string | null {
  // Not "website": real forms (e.g. /sell) have a website field, and the names would collide.
  if (String(fd.get('homepage') ?? '').trim()) return 'honeypot';
  const ft = Number(fd.get('_ft'));
  if (ft && Number.isFinite(ft) && Date.now() - ft < MIN_FILL_MS) return 'too_fast';
  return null;
}

type Bucket = { hits: number[] };
const g = globalThis as typeof globalThis & { __fxRate?: Map<string, Bucket> };
const buckets: Map<string, Bucket> = (g.__fxRate ??= new Map<string, Bucket>());

/** Sliding-window limiter. Returns true when the caller is over the limit. */
export function rateLimited(key: string, max: number, windowMs: number): boolean {
  if (process.env.RATE_LIMITS_DISABLED === 'true') return false;
  const now = Date.now();
  const b = buckets.get(key) ?? { hits: [] };
  b.hits = b.hits.filter((t) => now - t < windowMs);
  if (b.hits.length >= max) { buckets.set(key, b); return true; }
  b.hits.push(now);
  buckets.set(key, b);
  if (buckets.size > 50_000) for (const [k, v] of buckets) if (!v.hits.some((t) => now - t < windowMs)) buckets.delete(k);
  return false;
}

export const BOT_MESSAGE = 'Something went wrong with that submission. Please wait a moment and try again.';
