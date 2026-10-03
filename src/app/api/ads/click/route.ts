import { clientIp } from '@/lib/request';
import { adDestination, parseAdToken, recordAdStat } from '@/lib/ads/serve';
import { rateLimited } from '@/lib/security/bot';

/** Tracked ad click → the campaign's destination URL (looked up server-side; the link cannot redirect anywhere else). */
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('d') ?? '';
  const t = parseAdToken(token);
  if (!t) return Response.redirect(new URL('/', req.url), 302);
  const dest = await adDestination(t.campaignId);
  if (!dest || !/^https?:\/\//i.test(dest)) return Response.redirect(new URL('/', req.url), 302);
  if (!rateLimited(`adclick:${await clientIp()}:${token}`, 1, 10_000)) {
    try { await recordAdStat(t, 'click'); } catch { /* still redirect */ }
  }
  return new Response(null, { status: 302, headers: { Location: dest, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer-when-downgrade' } });
}
