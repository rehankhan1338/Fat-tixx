/* Shared by the "Continue with Google" routes (src/app/api/auth/google). */

/** Short-lived HttpOnly cookie holding the state, nonce and PKCE verifier of one sign-in. */
export const GOOGLE_STATE_COOKIE = 'fx_google';

/** Where to return after Google: same-site relative paths only (as after /login), else /create. */
export function safeNextPath(raw: string | null | undefined): string {
  return raw && /^\/(?!\/)[\w\-./?=&%]*$/.test(raw) ? raw : '/create';
}
