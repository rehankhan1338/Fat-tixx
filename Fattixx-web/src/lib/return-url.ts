import { env } from './env';

/**
 * The address Stripe sends people back to after a hosted page (Checkout, billing portal, Connect onboarding).
 * The session cookie is SameSite=Strict, so a navigation that comes from stripe.com arrives signed out; /return is a
 * public page that forwards to `path` from our own origin, and that second navigation carries the cookie again.
 */
export function stripeReturnUrl(path: string): string {
  // Stripe fills in {CHECKOUT_SESSION_ID} only when the braces appear literally, so keep that placeholder unencoded.
  return `${env.APP_URL}/return?to=${encodeURIComponent(path).replace('%7BCHECKOUT_SESSION_ID%7D', '{CHECKOUT_SESSION_ID}')}`;
}

/** A same-origin path that is safe to forward to, or null. */
export function safeReturnPath(to: unknown): string | null {
  if (typeof to !== 'string' || !to.startsWith('/') || to.startsWith('//') || to.includes('\\')) return null;
  return to;
}
