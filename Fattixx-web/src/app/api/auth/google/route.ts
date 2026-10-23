import { createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import { GOOGLE_STATE_COOKIE, safeNextPath } from '@/lib/auth/google-flow';
import { googleConfig } from '@/lib/auth/passwordless';
import { env } from '@/lib/env';
import { randomToken } from '@/lib/security/crypto';

/**
 * "Continue with Google" on /create (plan 5.6): sends the browser to Google's sign-in with a one-time state, nonce and
 * PKCE verifier kept in a short-lived HttpOnly cookie; ./callback/route.ts checks all three. The draft stays in the
 * browser meanwhile, so the organizer returns to the same event.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const next = safeNextPath(url.searchParams.get('next'));
  const cfg = googleConfig();
  if (!cfg) return Response.redirect(new URL(`${next}${next.includes('?') ? '&' : '?'}google=off`, env.APP_URL), 302);
  const state = randomToken(24);
  const nonce = randomToken(24);
  const verifier = randomToken(48);
  (await cookies()).set(GOOGLE_STATE_COOKIE, Buffer.from(JSON.stringify({ state, nonce, verifier, next })).toString('base64url'), {
    httpOnly: true, secure: env.IS_PROD, sameSite: 'lax', path: '/api/auth/google', maxAge: 10 * 60,
  });
  const google = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  google.search = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    nonce,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();
  return Response.redirect(google.toString(), 302);
}
