import { clientIp } from '@/lib/request';
import { parseAdToken, recordAdStat } from '@/lib/ads/serve';
import { rateLimited } from '@/lib/security/bot';

/** Impression beacon: sent by the ad slot once the ad has actually been in view. One count per visitor per ad per minute. */
export async function POST(req: Request) {
  const token = (await req.text()).trim().slice(0, 200);
  const t = parseAdToken(token);
  if (!t) return new Response(null, { status: 204 });
  if (rateLimited(`adimp:${await clientIp()}:${token}`, 1, 60_000)) return new Response(null, { status: 204 });
  try { await recordAdStat(t, 'impression'); } catch { /* never fail the page */ }
  return new Response(null, { status: 204 });
}
