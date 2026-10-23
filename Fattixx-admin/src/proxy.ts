import { NextResponse, type NextRequest } from 'next/server';

/**
 * Runs before every request of the admin console:
 *  1. Per-request CSP nonce + strict security headers (same policy as the main app, minus the public-site allowances).
 *  2. Optimistic redirect: any page except the sign-in page (/) without a session cookie → /.
 *     (Real session validation happens in the server components; this only saves a render.)
 *  3. Defence-in-depth CSRF check for non-GET requests: Origin must match Host.
 * Old links (/admin/login, /login) land on the sign-in page.
 */

// The console's own cookie (see SESSION_COOKIE in src/lib/auth/session.ts); the public site's cookie is ignored here.
const SESSION_COOKIE = process.env.NODE_ENV === 'production' ? '__Host-fx_admin' : 'fx_admin';

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

  // --- The sign-in page is the homepage; old sign-in paths go there ---
  if (pathname === '/admin/login' || pathname === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  // --- Optimistic auth redirect (cookie presence only) ---
  // (the scanner's service worker is a public file, as on the public site)
  if (pathname !== '/' && pathname !== '/scan-sw.js' && !pathname.startsWith('/api/') && !request.cookies.has(SESSION_COOKIE)) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  // --- CSP with per-request nonce ---
  // Branding images (logo, site photos) are addressed on the public site's origin; uploads may live on Vercel Blob.
  const site = (process.env.APP_URL?.trim() || 'http://localhost:3000').replace(/\/+$/, '');
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' blob: data: ${site} https://*.public.blob.vercel-storage.com`,
    `font-src 'self'`,
    `connect-src 'self'`,
    `worker-src 'self'`,
    `frame-src 'none'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    ...(isDev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Camera for the ticket scanner (staff can open an organizer's scan page from here); nothing else.
  response.headers.set('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), payment=(), usb=()');
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  response.headers.set('Cross-Origin-Resource-Policy', 'same-origin');
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
