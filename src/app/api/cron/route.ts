import { timingSafeEqual } from 'node:crypto';
import { runJobs } from '@/lib/jobs';

/**
 * Background jobs endpoint. Called every minute by the in-process scheduler (src/instrumentation.ts)
 * and usable by any external scheduler (Vercel Cron, cron + curl, uptime pinger):
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron
 */
export const dynamic = 'force-dynamic';

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(req.headers.get('authorization') ?? '');
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function GET(req: Request) {
  if (!authorized(req)) return new Response('Unauthorized', { status: 401 });
  try {
    return Response.json({ ok: true, ...(await runJobs()) });
  } catch (e) {
    console.error('[cron] jobs failed', e);
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
