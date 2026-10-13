import { queryOne } from '@/lib/db';

/**
 * Uptime-monitor endpoint (plan 13.1). Returns 200 when the app can reach the database, 503 otherwise.
 * Deliberately reveals nothing beyond up/down and latency.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const started = Date.now();
  try {
    await queryOne('SELECT 1 AS ok');
    return Response.json({ status: 'ok', db: 'ok', latencyMs: Date.now() - started }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ status: 'error', db: 'unreachable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
