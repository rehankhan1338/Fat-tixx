import 'server-only';
import { execute, queryOne, type Row } from '../db';

/**
 * Applying offline check-ins (plan 8.2). Kept free of request/session state so it can be tested directly;
 * the `syncOfflineScans` server action does the permission checks and calls this.
 *
 * Rules:
 *  - Idempotent per `ref` (unique checkin_log.client_ref), so a retried sync never double-counts.
 *  - valid → used uses the same conditional UPDATE as online scanning, so it cannot race another device.
 *  - When the ticket was already used (another device) or refunded / cancelled / transferred meanwhile, the
 *    scan is logged as `offline_conflict` for an organizer to review. The person is already inside, so nothing
 *    is undone automatically.
 *  - The device clock is trusted only up to "now": a check-in is never recorded in the future.
 */
export type OfflineScanItem = { ref: string; ticketId: number; kind: 'valid' | 'manual'; at: string };
export type OfflineConflict = { ref: string; ticketId: number; code: string; name: string | null; reason: string };

type TicketState = Row & { id: number; code: string; status: string; attendee_name: string | null; ticket_date_id: number | null; checked_in_at: Date | null; checked_in_by_name: string | null };

async function ticketState(ticketId: number, eventId: number): Promise<TicketState | null> {
  return queryOne<TicketState>(
    `SELECT k.id, k.code, k.status, k.attendee_name, t.event_date_id AS ticket_date_id, k.checked_in_at, u.name AS checked_in_by_name
       FROM tickets k JOIN ticket_types t ON t.id = k.ticket_type_id LEFT JOIN users u ON u.id = k.checked_in_by
      WHERE k.id = ? AND k.event_id = ?`, [ticketId, eventId],
  );
}

export async function applyOfflineScans(input: {
  eventId: number; staffId: number; activeDateId: number | null; deviceId: string; ip: string | null; userAgent: string | null; items: OfflineScanItem[];
}): Promise<{ synced: number; conflicts: OfflineConflict[] }> {
  const { eventId, staffId, activeDateId } = input;
  const deviceId = input.deviceId.replace(/[^\w-]/g, '').slice(0, 40) || 'unknown';
  const device = `offline:${deviceId} ${input.userAgent ?? ''}`.slice(0, 255);
  const conflicts: OfflineConflict[] = [];
  let synced = 0;
  for (const item of input.items.slice(0, 500)) {
    const ref = String(item.ref ?? '');
    if (!/^[\w-]{8,64}$/.test(ref)) continue;
    if (await queryOne(`SELECT id FROM checkin_log WHERE client_ref = ?`, [ref])) { synced++; continue; }
    const t = await ticketState(Number(item.ticketId), eventId);
    if (!t) continue;
    const at = new Date(Math.min(Date.parse(item.at) || Date.now(), Date.now()));
    const kind = item.kind === 'manual' ? 'manual' : 'valid';
    const isPass = t.ticket_date_id == null;
    let admitted = false;
    if (t.status === 'valid') {
      const r = await execute(`UPDATE tickets SET status = 'used', checked_in_at = ?, checked_in_by = ?, last_checkin_date_id = ? WHERE id = ? AND status = 'valid'`, [at, staffId, activeDateId, t.id]);
      admitted = r.affectedRows === 1;
    } else if (t.status === 'used' && isPass && activeDateId !== null) {
      // Multi-day pass: once per day.
      const r = await execute(
        `UPDATE tickets SET checked_in_at = ?, checked_in_by = ?, last_checkin_date_id = ? WHERE id = ? AND status = 'used' AND (last_checkin_date_id IS NULL OR last_checkin_date_id <> ?)`,
        [at, staffId, activeDateId, t.id, activeDateId],
      );
      admitted = r.affectedRows === 1;
    }
    let reason: string | null = null;
    if (!admitted) {
      const now = await ticketState(Number(t.id), eventId);
      reason = now?.status === 'used'
        ? `Admitted offline at ${at.toISOString()}, but it was already checked in${now.checked_in_at ? ` at ${new Date(now.checked_in_at).toISOString()}` : ''}${now.checked_in_by_name ? ` by ${now.checked_in_by_name}` : ''}`
        : `Admitted offline at ${at.toISOString()}, but the ticket is ${now?.status ?? 'missing'}`;
    }
    const ins = await execute(
      `INSERT IGNORE INTO checkin_log (event_id, ticket_id, staff_user_id, result, reason, device, ip, offline, scanned_at, device_id, client_ref) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      [eventId, t.id, staffId, admitted ? kind : 'offline_conflict', reason?.slice(0, 300) ?? null, device, input.ip, at, deviceId, ref],
    );
    synced++;
    if (ins.affectedRows === 1 && !admitted) conflicts.push({ ref, ticketId: Number(t.id), code: t.code, name: t.attendee_name, reason: reason ?? '' });
  }
  return { synced, conflicts };
}
