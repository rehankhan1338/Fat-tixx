import { queryOne, type Row } from '@/lib/db';
import { queueStatus } from '@/lib/queue';

/** POST /api/queue/:eventId → join the waiting room (first call) and get the current position / admission. */
export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const id = Number((await params).eventId);
  const event = await queryOne<Row & { id: number; queue_enabled: number; queue_rate_per_min: number; status: string }>(
    `SELECT id, queue_enabled, queue_rate_per_min, status FROM events WHERE id = ?`, [id],
  );
  if (!event || !['published', 'postponed'].includes(event.status)) return Response.json({ error: 'not_found' }, { status: 404 });
  if (!event.queue_enabled) return Response.json({ admitted: true, position: 0, ahead: 0, etaMinutes: 0, expiresAt: null });
  return Response.json(await queueStatus({ id: Number(event.id), queue_rate_per_min: Number(event.queue_rate_per_min) }), { headers: { 'Cache-Control': 'no-store' } });
}
