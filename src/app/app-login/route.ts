import { NextResponse } from 'next/server';
import { audit } from '@/lib/audit';
import { APP_WEB_UA_PREFIX, createSession, getSession } from '@/lib/auth/session';
import { env } from '@/lib/env';
import { rateLimited } from '@/lib/security/bot';
import { appAccessError } from '@/lib/mobile/http';

export const dynamic = 'force-dynamic';

/**
 * Sign-in handoff for the mobile app's in-app browser.
 *
 * The app opens this URL in a WebView with its `Authorization: Bearer` header on the first request only.
 * We turn that into an ordinary browser session (HttpOnly cookie, 12 h / 30 min idle) and redirect to the
 * requested dashboard page, so organisers and admins use the full website inside the app without typing
 * a password again. The browser session is labelled so signing out of the app revokes it as well.
 *
 * No token ever appears in a URL: without the header this endpoint just sends the visitor to /login.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const next = safeNext(url.searchParams.get('next'));
  const session = await getSession();
  if (!session || session.via !== 'bearer' || appAccessError(session.user.roles)) {
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(next)}`, env.APP_URL));
  }
  if (rateLimited(`app-login:${session.user.id}`, 20, 10 * 60_000)) return new NextResponse('Too many requests', { status: 429 });
  const device = (req.headers.get('x-fat-tixx-device') ?? 'app').replace(/[^\w .,/()+:-]/g, '').slice(0, 120);
  await createSession(session.user.id, { label: `${APP_WEB_UA_PREFIX}${device}` });
  await audit('auth.session.created', { actorUserId: session.user.id, metadata: { client: 'mobile-webview', next } });
  return NextResponse.redirect(new URL(next, env.APP_URL), { status: 303 });
}

/** Only same-site relative paths. */
function safeNext(raw: string | null): string {
  const s = raw ?? '';
  return /^\/(?!\/)[\w\-./?=&%#]*$/.test(s) ? s : '/dashboard';
}
