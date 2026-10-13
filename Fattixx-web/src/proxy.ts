import { NextResponse, type NextRequest } from 'next/server';

/**
 * Runs before every page request:
 *  1. Per-request CSP nonce + strict security headers.
 *  2. /admin/* → the admin console (a separate app, see Fattixx-admin/ and ADMIN_URL).
 *     (Real session validation happens in the server components; this only saves a render.)
 *  3. Defence-in-depth CSRF check for non-GET requests: Origin must match Host.
 *     Next.js already does this for Server Actions; this extends it to everything.
 */

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isDev = process.env.NODE_ENV === 'development';

  // --- CSRF: same-origin enforcement for state-changing requests ---
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    const origin = request.headers.get('origin');
    const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
    if (origin && host) {
      let originHost: string | null = null;
      try { originHost = new URL(origin).host; } catch { /* malformed */ }
      if (originHost !== host) {
        return new NextResponse('Cross-origin request blocked', { status: 403 });
      }
    }
  }

  // --- The staff console is a separate app (Fattixx-admin/, ADMIN_URL); old /admin links go there ---
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    const admin = (process.env.ADMIN_URL?.trim() || 'http://localhost:3100').replace(/\/+$/, '');
    const target = pathname === '/admin/login' ? '/' : pathname;
    return NextResponse.redirect(`${admin}${target}${request.nextUrl.search}`);
  }

  // --- CSP with per-request nonce ---
  // Organizer tracking pixels (consent-gated) may run on public event pages only, never on checkout (plan 11.4).
  const isEventPage = pathname.startsWith('/events/');
  // The embeddable checkout widget is the only page other sites may frame.
  const isEmbed = pathname.startsWith('/embed/');
  // Public pages' location box: approximate city from IP (geojs.io) and GPS → city name (bigdatacloud.net). Disclosed in the privacy policy.
  const isPublicPage = !/^\/(admin|org|api|checkout|embed|app-login|t|r)(\/|$)/.test(pathname);
  const geoConnect = isPublicPage ? ' https://get.geojs.io https://api.bigdatacloud.net' : '';
  const pixelConnect = isEventPage ? ' https://connect.facebook.net https://www.facebook.com https://www.google-analytics.com https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com' : '';
  const pixelImg = isEventPage ? ' https://www.facebook.com https://www.google-analytics.com https://*.google-analytics.com https://www.googletagmanager.com' : '';
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://js.stripe.com${isDev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' blob: data: https://*.stripe.com https://*.public.blob.vercel-storage.com${pixelImg}`,
    `font-src 'self'`,
    `connect-src 'self' https://api.stripe.com https://m.stripe.com https://r.stripe.com${pixelConnect}${geoConnect}`,
    `worker-src 'self'`,
    // Stripe Elements renders card fields inside iframes hosted by Stripe.
    `frame-src https://js.stripe.com https://hooks.stripe.com https://m.stripe.network`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors ${isEmbed ? '*' : "'none'"}`,
    ...(isDev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  if (!isEmbed) response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Camera / geolocation: `self` on every page, not per path. Permissions-Policy is fixed when the document loads,
  // and the App Router navigates client-side (login → dashboard → scanner) without reloading, so a `camera=()`
  // from the first page stuck to the scanner and getUserMedia was rejected with NotAllowedError. `self` still
  // blocks third-party frames and the user must still grant permission. Payment for Stripe's frames (Apple/Google Pay).
  response.headers.set('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(self), payment=(self "https://js.stripe.com"), usb=()');
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  // The widget script, email ad pixel and uploaded images are loaded by other sites / mail clients.
  const shared = pathname === '/embed.js' || pathname === '/api/ads/px' || pathname.startsWith('/api/uploads/');
  response.headers.set('Cross-Origin-Resource-Policy', shared ? 'cross-origin' : 'same-origin');
  response.headers.set('Cache-Control', 'no-store');
  if (!isDev) response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  return response;
}

export const config = {
  matcher: [
    {
      source: '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
