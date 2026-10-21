'use server';

import { db, execute, queryOne, type Row } from '../db';
import { audit } from '../audit';
import { assertOrg, canAccessEvent, type OrgContext } from '../authz';
import { clientIp, userAgent } from '../request';
import { activeEventDate, getEvent, listEventDates, type EventDateRow } from '../events/queries';
import { offlineTicketHash, verifyTicketPayload } from '../tickets';
import { applyOfflineScans } from './offline';
import { checkinCounts } from '../orders/queries';
import { revalidatePath } from 'next/cache';
import { formatEventDate } from '../tz';

/**
 * Check-in. Every scan writes a checkin_log row (dispute evidence). The transition valid → used
 * is a single conditional UPDATE, so two devices scanning the same code at once cannot both admit.
 *
 * Multi-day events: a ticket type tied to one day is only valid on that day ("wrong_day" otherwise);
 * a pass (no day) is admitted once per day, tracked through tickets.last_checkin_date_id.
 */
export type ScanResult = {
  result: 'valid' | 'already_used' | 'cancelled' | 'refunded' | 'transferred' | 'wrong_event' | 'wrong_day' | 'invalid' | 'manual' | 'override' | 'undo';
  ticket?: { id: number; code: string; attendeeName: string | null; ticketType: string; seatLabel: string | null; dayLabel: string | null; addons: string | null; checkedInAt: string | null; checkedInBy: string | null; orderCode: string; buyerEmail: string };
  ageRestriction?: number | null;
  counts: { total: number; used: number };
  message: string;
};

type TicketLookup = Row & {
  id: number; code: string; secret: string; event_id: number; status: string; attendee_name: string | null; seat_label: string | null; checked_in_at: Date | null; last_checkin_date_id: number | null;
  ticket_type: string; ticket_date_id: number | null; day_label: string | null; order_code: string; buyer_email: string; checked_in_by_name: string | null; order_status: string; addons: string | null;
};

async function lookupTicket(where: string, params: (string | number)[]): Promise<TicketLookup | null> {
  return queryOne<TicketLookup>(
    `SELECT k.id, k.code, k.secret, k.event_id, k.status, k.attendee_name, k.seat_label, k.checked_in_at, k.last_checkin_date_id, t.name AS ticket_type, t.event_date_id AS ticket_date_id,
            COALESCE(d.label, DATE_FORMAT(d.starts_at, '%a, %b %e')) AS day_label, o.code AS order_code, o.buyer_email, o.status AS order_status, u.name AS checked_in_by_name,
            (SELECT GROUP_CONCAT(CONCAT(oa.quantity, ' × ', oa.addon_name) SEPARATOR ', ') FROM order_addons oa WHERE oa.order_id = o.id) AS addons
       FROM tickets k JOIN ticket_types t ON t.id = k.ticket_type_id LEFT JOIN event_dates d ON d.id = t.event_date_id JOIN orders o ON o.id = k.order_id LEFT JOIN users u ON u.id = k.checked_in_by WHERE ${where}`, params,
  );
}

async function log(eventId: number, ticketId: number | null, staffId: number, result: ScanResult['result'], reason: string | null) {
  const [ip, ua] = await Promise.all([clientIp(), userAgent()]);
  await execute(`INSERT INTO checkin_log (event_id, ticket_id, staff_user_id, result, reason, device, ip) VALUES (?, ?, ?, ?, ?, ?, ?)`, [eventId, ticketId, staffId, result, reason, ua?.slice(0, 255) ?? null, ip]);
}

function view(t: TicketLookup) {
  return { id: Number(t.id), code: t.code, attendeeName: t.attendee_name, ticketType: t.ticket_type, seatLabel: t.seat_label, dayLabel: t.day_label, addons: t.addons, checkedInAt: t.checked_in_at ? new Date(t.checked_in_at).toISOString() : null, checkedInBy: t.checked_in_by_name, orderCode: t.order_code, buyerEmail: t.buyer_email };
}

type ScanContext = { ctx: OrgContext; event: NonNullable<Awaited<ReturnType<typeof getEvent>>>; dates: EventDateRow[]; active: EventDateRow | null };

async function loadScanContext(orgSlug: string, eventId: number): Promise<ScanContext> {
  const ctx = await assertOrg(orgSlug);
  const event = await getEvent(ctx.org.id, eventId);
  if (!event || !(await canAccessEvent(ctx, event))) throw new Error('Event not found');
  const dates = await listEventDates(event.id);
  return { ctx, event, dates, active: activeEventDate(dates) };
}

function dayName(d: EventDateRow, tz: string): string {
  return d.label ?? formatEventDate(new Date(d.starts_at), tz, { withTime: false });
}

/**
 * Admit a ticket. valid → used always; for a pass on a multi-day event, used → used again on a new day.
 * Returns the result to report, or null when the conditional UPDATE did not match (race / already in).
 */
async function tryAdmit(t: TicketLookup, sc: ScanContext, kind: 'valid' | 'manual'): Promise<ScanResult | null> {
  const staffId = sc.ctx.session.user.id;
  const isPass = t.ticket_date_id == null;
  const activeId = sc.active ? Number(sc.active.id) : null;
  // Day-specific ticket on a different day.
  if (!isPass && sc.active && Number(t.ticket_date_id) !== activeId) {
    await log(sc.event.id, Number(t.id), staffId, 'wrong_day', null);
    return { result: 'wrong_day', ticket: view(t), counts: await checkinCounts(sc.event.id), message: `This ticket is for ${t.day_label ?? 'another day'}; today is ${dayName(sc.active, sc.event.timezone)}.` };
  }
  let r;
  if (t.status === 'valid') {
    r = await execute(`UPDATE tickets SET status = 'used', checked_in_at = NOW(), checked_in_by = ?, last_checkin_date_id = ? WHERE id = ? AND status = 'valid'`, [staffId, activeId, t.id]);
  } else if (t.status === 'used' && isPass && activeId !== null) {
    // Pass: once per day.
    r = await execute(`UPDATE tickets SET checked_in_at = NOW(), checked_in_by = ?, last_checkin_date_id = ? WHERE id = ? AND status = 'used' AND (last_checkin_date_id IS NULL OR last_checkin_date_id <> ?)`, [staffId, activeId, t.id, activeId]);
  } else return null;
  if (r.affectedRows !== 1) return null;
  await log(sc.event.id, Number(t.id), staffId, kind, null);
  const fresh = await lookupTicket('k.id = ?', [Number(t.id)]);
  const dayNote = sc.active && isPass ? ` Pass · ${dayName(sc.active, sc.event.timezone)}.` : '';
  return { result: kind, ticket: view(fresh ?? t), ageRestriction: sc.event.age_restriction, counts: await checkinCounts(sc.event.id), message: kind === 'valid' ? `Valid — welcome!${dayNote}` : `Checked in manually.${dayNote}` };
}

export async function scanTicket(orgSlug: string, eventId: number, payload: string): Promise<ScanResult> {
  const sc = await loadScanContext(orgSlug, eventId);
  const { ctx, event } = sc;
  const counts = () => checkinCounts(event.id);
  const parsed = verifyTicketPayload(payload);
  // Fall back to a bare ticket code typed manually (12 chars) — verified against the DB, not the signature.
  const code = parsed?.code ?? (/^[A-Z0-9]{12}$/i.test(payload.trim()) ? payload.trim().toUpperCase() : null);
  if (!code) { await log(event.id, null, ctx.session.user.id, 'invalid', 'bad_payload'); return { result: 'invalid', counts: await counts(), message: 'Not a Fattixx ticket.' }; }
  const t = await lookupTicket('k.code = ?', [code]);
  if (!t || (parsed && t.secret !== parsed.secret)) { await log(event.id, null, ctx.session.user.id, 'invalid', 'unknown_code'); return { result: 'invalid', counts: await counts(), message: 'Ticket not found or signature mismatch.' }; }
  if (Number(t.event_id) !== event.id) { await log(event.id, Number(t.id), ctx.session.user.id, 'wrong_event', null); return { result: 'wrong_event', ticket: view(t), counts: await counts(), message: 'This ticket is for a different event.' }; }
  if (t.status === 'refunded' || t.status === 'cancelled' || t.status === 'transferred') { await log(event.id, Number(t.id), ctx.session.user.id, t.status, null); return { result: t.status, ticket: view(t), counts: await counts(), message: `Ticket was ${t.status}.` }; }
  const admitted = await tryAdmit(t, sc, 'valid');
  if (admitted) return admitted;
  await log(event.id, Number(t.id), ctx.session.user.id, 'already_used', t.status === 'used' ? null : 'race');
  const when = t.checked_in_at ? new Date(t.checked_in_at).toLocaleTimeString() : '';
  const todayNote = sc.active && t.ticket_date_id == null ? ' today' : '';
  return { result: 'already_used', ticket: view(t), counts: await counts(), message: t.status === 'used' ? `Already scanned${todayNote} ${when}${t.checked_in_by_name ? ` by ${t.checked_in_by_name}` : ''}.` : 'Already scanned on another device.' };
}

/** Manual check-in from the attendee list (no QR). */
export async function manualCheckin(orgSlug: string, eventId: number, ticketId: number): Promise<ScanResult> {
  const sc = await loadScanContext(orgSlug, eventId);
  const { ctx, event } = sc;
  const t = await lookupTicket('k.id = ? AND k.event_id = ?', [ticketId, event.id]);
  if (!t) return { result: 'invalid', counts: await checkinCounts(event.id), message: 'Ticket not found.' };
  if (t.status !== 'valid' && t.status !== 'used') return { result: t.status as ScanResult['result'], ticket: view(t), counts: await checkinCounts(event.id), message: `Ticket is ${t.status}.` };
  const admitted = await tryAdmit(t, sc, 'manual');
  if (admitted) {
    if (admitted.result === 'manual') await audit('checkin.manual', { actorUserId: ctx.session.user.id, targetType: 'ticket', targetId: t.id, metadata: { eventId: event.id } });
    return admitted;
  }
  return { result: 'already_used', ticket: view(t), counts: await checkinCounts(event.id), message: 'Ticket is already checked in.' };
}

/** Admit despite a non-valid status (already used / refunded / wrong day). Requires permission and a reason; always logged. */
export async function overrideCheckin(orgSlug: string, eventId: number, ticketId: number, reason: string): Promise<ScanResult> {
  const sc = await loadScanContext(orgSlug, eventId);
  const { ctx, event } = sc;
  if (!ctx.perms.canOverrideCheckin) throw new Error('You are not allowed to override check-in.');
  if (reason.trim().length < 3) throw new Error('A reason is required for an override.');
  const t = await lookupTicket('k.id = ? AND k.event_id = ?', [ticketId, event.id]);
  if (!t) return { result: 'invalid', counts: await checkinCounts(event.id), message: 'Ticket not found.' };
  await execute(`UPDATE tickets SET status = 'used', checked_in_at = NOW(), checked_in_by = ?, last_checkin_date_id = ? WHERE id = ?`, [ctx.session.user.id, sc.active ? Number(sc.active.id) : null, t.id]);
  await log(event.id, Number(t.id), ctx.session.user.id, 'override', reason.trim().slice(0, 300));
  await audit('checkin.override', { actorUserId: ctx.session.user.id, targetType: 'ticket', targetId: t.id, metadata: { eventId: event.id, previous: t.status, reason } });
  const fresh = await lookupTicket('k.id = ?', [Number(t.id)]);
  return { result: 'override', ticket: view(fresh ?? t), counts: await checkinCounts(event.id), message: 'Admitted by override (logged).' };
}

/** Reverse a check-in (used → valid). Requires permission; logged. */
export async function undoCheckin(orgSlug: string, eventId: number, ticketId: number, reason: string): Promise<ScanResult> {
  const sc = await loadScanContext(orgSlug, eventId);
  const { ctx, event } = sc;
  if (!ctx.perms.canUndoCheckin) throw new Error('You are not allowed to undo a check-in.');
  const t = await lookupTicket('k.id = ? AND k.event_id = ?', [ticketId, event.id]);
  if (!t) return { result: 'invalid', counts: await checkinCounts(event.id), message: 'Ticket not found.' };
  if (t.status !== 'used') return { result: 'invalid', ticket: view(t), counts: await checkinCounts(event.id), message: 'Ticket is not checked in.' };
  await execute(`UPDATE tickets SET status = 'valid', checked_in_at = NULL, checked_in_by = NULL, last_checkin_date_id = NULL WHERE id = ? AND status = 'used'`, [t.id]);
  await log(event.id, Number(t.id), ctx.session.user.id, 'undo', reason.trim().slice(0, 300) || null);
  await audit('checkin.undo', { actorUserId: ctx.session.user.id, targetType: 'ticket', targetId: t.id, metadata: { eventId: event.id, reason } });
  const fresh = await lookupTicket('k.id = ?', [Number(t.id)]);
  return { result: 'undo', ticket: view(fresh ?? t), counts: await checkinCounts(event.id), message: 'Check-in undone.' };
}

export async function liveCounts(orgSlug: string, eventId: number): Promise<{ total: number; used: number }> {
  const { event } = await loadScanContext(orgSlug, eventId);
  return checkinCounts(event.id);
}

// ---------------------------------------------------------------------------
// Offline scanning (plan 8.2). The device downloads a snapshot, validates scans locally while the
// connection is down, queues its check-ins and syncs them later. A ticket admitted on two devices
// (or one that was refunded in the meantime) is recorded as an `offline_conflict` for review.
// ---------------------------------------------------------------------------
export type OfflineTicket = {
  id: number; code: string; h: string; attendeeName: string | null; seatLabel: string | null; dayLabel: string | null; dateId: number | null;
  lastDateId: number | null; status: string; ticketType: string; orderCode: string; buyerEmail: string; buyerName: string | null; addons: string | null;
};
export type ScannerSnapshot = {
  eventId: number; generatedAt: string; expiresAt: string; activeDateId: number | null; ageRestriction: number | null; tickets: OfflineTicket[];
};

/** Everything a scanner needs to keep working without a connection. Includes refunded / transferred tickets so they show a clear state. */
export async function scannerSnapshot(orgSlug: string, eventId: number): Promise<ScannerSnapshot> {
  const { event, active } = await loadScanContext(orgSlug, eventId);
  const [rows] = await db.query<(Row & { id: number; code: string; secret: string; attendee_name: string | null; seat_label: string | null; day_label: string | null; event_date_id: number | null; last_checkin_date_id: number | null; status: string; ticket_type: string; order_code: string; buyer_email: string; buyer_name: string | null; addons: string | null })[]>(
    `SELECT k.id, k.code, k.secret, k.attendee_name, k.seat_label, COALESCE(d.label, DATE_FORMAT(d.starts_at, '%a, %b %e')) AS day_label, t.event_date_id, k.last_checkin_date_id,
            k.status, t.name AS ticket_type, o.code AS order_code, o.buyer_email, o.buyer_name,
            (SELECT GROUP_CONCAT(CONCAT(oa.quantity, ' × ', oa.addon_name) SEPARATOR ', ') FROM order_addons oa WHERE oa.order_id = o.id) AS addons
       FROM tickets k JOIN ticket_types t ON t.id = k.ticket_type_id LEFT JOIN event_dates d ON d.id = t.event_date_id JOIN orders o ON o.id = k.order_id
      WHERE k.event_id = ? ORDER BY COALESCE(k.attendee_name, o.buyer_name)`, [event.id],
  );
  const end = new Date(event.ends_at ?? event.starts_at);
  return {
    eventId: event.id, generatedAt: new Date().toISOString(), expiresAt: new Date(end.getTime() + 24 * 3_600_000).toISOString(),
    activeDateId: active ? Number(active.id) : null, ageRestriction: event.age_restriction,
    tickets: rows.map((r) => ({
      id: Number(r.id), code: r.code, h: offlineTicketHash(r.code, r.secret), attendeeName: r.attendee_name, seatLabel: r.seat_label, dayLabel: r.day_label,
      dateId: r.event_date_id == null ? null : Number(r.event_date_id), lastDateId: r.last_checkin_date_id == null ? null : Number(r.last_checkin_date_id),
      status: r.status, ticketType: r.ticket_type, orderCode: r.order_code, buyerEmail: r.buyer_email, buyerName: r.buyer_name, addons: r.addons,
    })),
  };
}

export type OfflineScan = { ref: string; ticketId: number; kind: 'valid' | 'manual'; at: string };
export type SyncResult = { synced: number; conflicts: { ref: string; code: string; name: string | null; reason: string }[]; counts: { total: number; used: number } };

/** Apply a device's queued offline check-ins. Idempotent per `ref`, so a retried sync never double-counts. */
export async function syncOfflineScans(orgSlug: string, eventId: number, deviceId: string, items: OfflineScan[]): Promise<SyncResult> {
  const sc = await loadScanContext(orgSlug, eventId);
  const { ctx, event } = sc;
  const [ip, ua] = await Promise.all([clientIp(), userAgent()]);
  const { synced, conflicts } = await applyOfflineScans({
    eventId: event.id, staffId: ctx.session.user.id, activeDateId: sc.active ? Number(sc.active.id) : null, deviceId, ip, userAgent: ua, items,
  });
  for (const c of conflicts) {
    await audit('checkin.offline_conflict', { actorUserId: ctx.session.user.id, targetType: 'ticket', targetId: c.ticketId, metadata: { eventId: event.id, deviceId, reason: c.reason } });
  }
  if (synced) revalidatePath(`/org/${orgSlug}/events/${event.id}`);
  return { synced, conflicts: conflicts.map(({ ref, code, name, reason }) => ({ ref, code, name, reason })), counts: await checkinCounts(event.id) };
}

export type ConflictRow = { id: number; at: string; code: string | null; name: string | null; staff: string | null; reason: string | null; deviceId: string | null };

export async function listOfflineConflicts(orgSlug: string, eventId: number): Promise<ConflictRow[]> {
  const { event } = await loadScanContext(orgSlug, eventId);
  const [rows] = await db.query<(Row & { id: number; created_at: Date; scanned_at: Date | null; code: string | null; attendee_name: string | null; staff: string | null; reason: string | null; device_id: string | null })[]>(
    `SELECT l.id, l.created_at, l.scanned_at, k.code, k.attendee_name, u.name AS staff, l.reason, l.device_id
       FROM checkin_log l LEFT JOIN tickets k ON k.id = l.ticket_id LEFT JOIN users u ON u.id = l.staff_user_id
      WHERE l.event_id = ? AND l.result = 'offline_conflict' AND l.resolved_at IS NULL ORDER BY l.id DESC LIMIT 200`, [event.id],
  );
  return rows.map((r) => ({ id: Number(r.id), at: new Date(r.scanned_at ?? r.created_at).toISOString(), code: r.code, name: r.attendee_name, staff: r.staff, reason: r.reason, deviceId: r.device_id }));
}

/** Mark a flagged conflict as reviewed. Organizers and admins only (not door staff). */
export async function resolveOfflineConflict(fd: FormData): Promise<{ ok?: boolean; error?: string }> {
  const orgSlug = String(fd.get('org') ?? ''); const eventId = Number(fd.get('event')); const id = Number(fd.get('id'));
  const { ctx, event } = await loadScanContext(orgSlug, eventId);
  if (ctx.role === 'staff') return { error: 'Only organizers can resolve conflicts.' };
  const r = await execute(`UPDATE checkin_log SET resolved_at = NOW(), resolved_by = ? WHERE id = ? AND event_id = ? AND result = 'offline_conflict' AND resolved_at IS NULL`, [ctx.session.user.id, id, event.id]);
  if (r.affectedRows) await audit('checkin.conflict_resolved', { actorUserId: ctx.session.user.id, targetType: 'checkin_log', targetId: id, metadata: { eventId: event.id } });
  revalidatePath(`/org/${orgSlug}/events/${event.id}`);
  return { ok: true };
}
