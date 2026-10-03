import { parseAdToken, recordAdStat } from '@/lib/ads/serve';

/** 1×1 impression pixel for ads inside emails. */
export const dynamic = 'force-dynamic';

const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

export async function GET(req: Request) {
  const t = parseAdToken(new URL(req.url).searchParams.get('d') ?? '');
  if (t) { try { await recordAdStat(t, 'impression'); } catch { /* ignore */ } }
  return new Response(GIF, { headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store, private', 'Cross-Origin-Resource-Policy': 'cross-origin' } });
}
