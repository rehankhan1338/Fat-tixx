import { execute } from '@/lib/db';
import { env } from '@/lib/env';
import { findTrackingLink } from '@/lib/marketing/queries';

/**
 * Promoter / affiliate link: /r/<code>. Counts the click, remembers the link for 7 days (first-party cookie,
 * no personal data) so a later checkout is attributed, and forwards to the event with UTM parameters.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const code = (await params).code;
  const link = await findTrackingLink(code);
  if (!link || !link.active) return Response.redirect(new URL('/', req.url), 302);
  await execute(`UPDATE tracking_links SET clicks = clicks + 1 WHERE id = ?`, [link.id]);
  const target = new URL(link.event_slug ? `/events/${link.event_slug}` : '/', req.url);
  if (link.event_visibility === 'private' && link.private_key) target.searchParams.set('key', link.private_key);
  target.searchParams.set('ref', link.code);
  if (link.utm_source) target.searchParams.set('utm_source', link.utm_source);
  if (link.utm_medium) target.searchParams.set('utm_medium', link.utm_medium);
  if (link.utm_campaign) target.searchParams.set('utm_campaign', link.utm_campaign);
  const cookie = JSON.stringify({ ref: link.code, s: link.utm_source, m: link.utm_medium, c: link.utm_campaign });
  return new Response(null, {
    status: 302,
    headers: {
      Location: target.toString(),
      'Set-Cookie': `fx_ref=${encodeURIComponent(cookie)}; Path=/; Max-Age=${7 * 86400}; SameSite=Lax; HttpOnly${env.IS_PROD ? '; Secure' : ''}`,
      'Cache-Control': 'no-store',
    },
  });
}
