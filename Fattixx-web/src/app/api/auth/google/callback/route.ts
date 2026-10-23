import { cookies } from 'next/headers';
import { GOOGLE_STATE_COOKIE, safeNextPath } from '@/lib/auth/google-flow';
import { googleConfig, googleSignIn, type GoogleProfile } from '@/lib/auth/passwordless';
import { env } from '@/lib/env';
import { safeEqual } from '@/lib/security/crypto';

/**
 * Google sends the browser back here. The authorization code is exchanged with Google directly over TLS (with the PKCE
 * verifier), so the ID token in the answer is Google's own; its issuer, audience, expiry and nonce are still checked.
 * Then: sign in, or start the last sign-up step (names, terms) back on /create.
 */
export const dynamic = 'force-dynamic';

type Saved = { state: string; nonce: string; verifier: string; next: string };

/**
 * Finish with a same-site page that moves on by itself: the session cookie is SameSite=Strict, and browsers leave it off a
 * redirect chain that started at Google, so a plain 302 would land on /create looking signed out.
 */
function continueTo(path: string): Response {
  const href = path.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${href}"><title>Signing you in…</title></head><body><p>Signing you in… <a href="${href}">Continue</a></p></body></html>`,
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
  );
}

const withParam = (path: string, k: string, v: string) => `${path}${path.includes('?') ? '&' : '?'}${k}=${encodeURIComponent(v)}`;

function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const part = jwt.split('.')[1];
  if (!part) return null;
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const store = await cookies();
  const raw = store.get(GOOGLE_STATE_COOKIE)?.value;
  store.set(GOOGLE_STATE_COOKIE, '', { httpOnly: true, secure: env.IS_PROD, sameSite: 'lax', path: '/api/auth/google', maxAge: 0 });
  let saved: Saved | null = null;
  try {
    saved = raw ? (JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Saved) : null;
  } catch {
    saved = null;
  }
  const next = safeNextPath(saved?.next);
  const cfg = googleConfig();
  const state = url.searchParams.get('state') ?? '';
  if (!cfg || !saved || !state || !safeEqual(state, saved.state)) return continueTo(withParam(next, 'google', 'error'));
  if (url.searchParams.get('error')) return continueTo(withParam(next, 'google', 'cancelled'));
  const code = url.searchParams.get('code');
  if (!code) return continueTo(withParam(next, 'google', 'error'));

  let profile: GoogleProfile | null = null;
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: cfg.redirectUri, grant_type: 'authorization_code', code_verifier: saved.verifier }),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => ({}))) as { id_token?: string };
    const claims = res.ok && json.id_token ? decodeJwtPayload(json.id_token) : null;
    const now = Math.floor(Date.now() / 1000);
    if (
      claims &&
      (claims.iss === 'https://accounts.google.com' || claims.iss === 'accounts.google.com') &&
      claims.aud === cfg.clientId &&
      typeof claims.exp === 'number' && claims.exp > now &&
      typeof claims.nonce === 'string' && safeEqual(claims.nonce, saved.nonce) &&
      typeof claims.sub === 'string' && claims.sub
    ) {
      profile = {
        sub: claims.sub,
        email: typeof claims.email === 'string' ? claims.email : null,
        emailVerified: claims.email_verified === true || claims.email_verified === 'true',
        givenName: typeof claims.given_name === 'string' ? claims.given_name : null,
        familyName: typeof claims.family_name === 'string' ? claims.family_name : null,
      };
    }
  } catch (e) {
    console.error('[google] token exchange failed', e);
  }
  if (!profile) return continueTo(withParam(next, 'google', 'error'));

  const r = await googleSignIn(profile);
  if ('error' in r) return continueTo(withParam(next, 'google_error', r.error));
  return continueTo(withParam(next, r.status === 'signed_in' ? 'signedin' : 'signup', '1'));
}
