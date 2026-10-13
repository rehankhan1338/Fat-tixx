import 'server-only';
import { headers } from 'next/headers';
import { env } from './env';

/**
 * Best-effort client IP. X-Forwarded-For is attacker-controlled unless a trusted reverse
 * proxy sets it, so it is only honoured when TRUST_PROXY=true. Otherwise every direct
 * connection is bucketed as "direct" (per-account lockout still protects each user).
 */
export async function clientIp(): Promise<string> {
  const h = await headers();
  if (env.TRUST_PROXY) {
    const xff = h.get('x-forwarded-for');
    if (xff) return xff.split(',')[0].trim().slice(0, 45);
    const real = h.get('x-real-ip');
    if (real) return real.trim().slice(0, 45);
  }
  return 'direct';
}

export async function userAgent(): Promise<string | null> {
  const h = await headers();
  return h.get('user-agent')?.slice(0, 512) ?? null;
}
