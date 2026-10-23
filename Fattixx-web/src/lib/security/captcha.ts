import 'server-only';

/**
 * CAPTCHA on checkout and sign-up (plan 6.2 / 12): Cloudflare Turnstile, on top of the honeypot, fill-time check and
 * rate limits in ./bot.ts. Turnstile usually passes people without a puzzle and keeps no tracking cookies.
 *
 * On when both keys are set (Cloudflare dashboard → Turnstile → Add site, widget mode "Managed"):
 *   NEXT_PUBLIC_TURNSTILE_SITE_KEY  shown in the page (inlined at build time)
 *   TURNSTILE_SECRET_KEY            server only
 * Off when either is missing, so local development and the test suites need nothing. Cloudflare's test keys
 * (site 1x00000000000000000000AA, secret 1x0000000000000000000000000000000AA) always pass.
 *
 * If Cloudflare cannot be reached the check passes and the failure is logged: an outage at Cloudflare must not stop
 * ticket sales, and the other layers still apply. A token Cloudflare rejects (missing, expired, reused, forged) fails.
 */
export const CAPTCHA_FIELD = 'cf-turnstile-response';
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export function captchaEnabled(): boolean {
  return !!(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() && process.env.TURNSTILE_SECRET_KEY?.trim());
}

/** The site key for the widget, or null when the CAPTCHA is off. */
export function captchaSiteKey(): string | null {
  return captchaEnabled() ? process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY!.trim() : null;
}

export async function verifyCaptcha(token: string | null | undefined, ip: string | null): Promise<boolean> {
  if (!captchaEnabled()) return true;
  const response = String(token ?? '').trim();
  if (!response || response.length > 2048) return false;
  const body = new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY!.trim(), response });
  // clientIp() returns "direct" when there is no trusted proxy; only a real address helps Cloudflare.
  if (ip && ip !== 'direct') body.set('remoteip', ip);
  try {
    const r = await fetch(VERIFY_URL, { method: 'POST', body, signal: AbortSignal.timeout(8_000), cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = (await r.json()) as { success?: boolean; 'error-codes'?: string[] };
    if (data.success) return true;
    // Our own configuration is wrong: do not lock every buyer out because of it.
    if (data['error-codes']?.some((c) => c === 'invalid-input-secret' || c === 'missing-input-secret')) {
      console.error('[captcha] TURNSTILE_SECRET_KEY was rejected by Cloudflare; the check is skipped until it is fixed');
      return true;
    }
    return false;
  } catch (e) {
    console.error('[captcha] Turnstile verification unavailable, allowing the request', (e as Error).message);
    return true;
  }
}
