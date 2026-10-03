import 'server-only';
import { cookies } from 'next/headers';
import { db, execute, queryOne, type Row } from './db';
import { env } from './env';
import { randomToken, sha256 } from './security/crypto';

/**
 * Virtual waiting room for high-demand on-sales (plan 6.2). When an event has `queue_enabled`, visitors
 * get a place in line (first come, first served) and at most `queue_rate_per_min` people are let through
 * per minute. Admission lasts ADMIT_MINUTES, enough to finish a checkout with its 10-minute hold.
 * The ticket form is hidden until admitted, and `startCheckout` re-checks admission on the server.
 */
const ADMIT_MINUTES = 20;
const cookieName = (eventId: number) => `fx_q_${eventId}`;

export type QueueStatus = { admitted: boolean; position: number; ahead: number; etaMinutes: number; expiresAt: string | null };

async function entryFor(eventId: number): Promise<(Row & { id: number; admitted_at: Date | null; expires_at: Date | null }) | null> {
  const token = (await cookies()).get(cookieName(eventId))?.value;
  if (!token || token.length > 64) return null;
  return queryOne(`SELECT id, admitted_at, expires_at FROM queue_entries WHERE event_id = ? AND token_hash = ?`, [eventId, sha256(token)]);
}

/** Let the next people in line through, at the event's rate. Serialized per event with a named lock. */
async function admitNext(eventId: number, ratePerMin: number): Promise<void> {
  const conn = await db.getConnection();
  try {
    const [[lock]] = await conn.query<(Row & { l: number })[]>(`SELECT GET_LOCK(?, 2) AS l`, [`fxq_${eventId}`]);
    if (!Number(lock?.l)) return;
    try {
      const [[recent]] = await conn.query<(Row & { n: number })[]>(`SELECT COUNT(*) AS n FROM queue_entries WHERE event_id = ? AND admitted_at > NOW() - INTERVAL 1 MINUTE`, [eventId]);
      const slots = Math.max(0, ratePerMin - Number(recent.n));
      if (slots > 0) {
        await conn.query(
          `UPDATE queue_entries SET admitted_at = NOW(), expires_at = NOW() + INTERVAL ? MINUTE WHERE event_id = ? AND admitted_at IS NULL ORDER BY id LIMIT ?`,
          [ADMIT_MINUTES, eventId, slots],
        );
      }
    } finally {
      await conn.query(`SELECT RELEASE_LOCK(?)`, [`fxq_${eventId}`]);
    }
  } finally {
    conn.release();
  }
}

/** Join the line (once per browser) and report where the visitor stands. */
export async function queueStatus(event: { id: number; queue_rate_per_min: number }): Promise<QueueStatus> {
  let entry = await entryFor(event.id);
  if (!entry) {
    const token = randomToken(24);
    const r = await execute(`INSERT INTO queue_entries (event_id, token_hash) VALUES (?, ?)`, [event.id, sha256(token)]);
    (await cookies()).set(cookieName(event.id), token, { httpOnly: true, sameSite: 'lax', secure: env.IS_PROD, path: '/', maxAge: 6 * 3600 });
    entry = { id: r.insertId, admitted_at: null, expires_at: null } as NonNullable<typeof entry>;
  }
  const rate = Math.max(1, Number(event.queue_rate_per_min) || 100);
  if (!entry.admitted_at) {
    await admitNext(event.id, rate);
    entry = (await queryOne<Row & { id: number; admitted_at: Date | null; expires_at: Date | null }>(`SELECT id, admitted_at, expires_at FROM queue_entries WHERE id = ?`, [entry.id]))!;
  }
  if (entry.admitted_at) {
    const live = entry.expires_at && new Date(entry.expires_at).getTime() > Date.now();
    return { admitted: !!live, position: 0, ahead: 0, etaMinutes: 0, expiresAt: entry.expires_at ? new Date(entry.expires_at).toISOString() : null };
  }
  const ahead = await queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM queue_entries WHERE event_id = ? AND admitted_at IS NULL AND id < ?`, [event.id, entry.id]);
  const n = Number(ahead?.n ?? 0);
  return { admitted: false, position: n + 1, ahead: n, etaMinutes: Math.max(1, Math.ceil((n + 1) / rate)), expiresAt: null };
}

/** True when this browser holds a live admission for the event. Does not join the line. */
export async function isAdmitted(eventId: number): Promise<boolean> {
  const e = await entryFor(eventId);
  return !!(e?.admitted_at && e.expires_at && new Date(e.expires_at).getTime() > Date.now());
}

export async function queueStats(eventId: number): Promise<{ waiting: number; admittedLastHour: number }> {
  const r = await queryOne<Row & { waiting: number; admitted: number }>(
    `SELECT SUM(admitted_at IS NULL) AS waiting, SUM(admitted_at > NOW() - INTERVAL 1 HOUR) AS admitted FROM queue_entries WHERE event_id = ? AND created_at > NOW() - INTERVAL 1 DAY`, [eventId],
  );
  return { waiting: Number(r?.waiting ?? 0), admittedLastHour: Number(r?.admitted ?? 0) };
}
