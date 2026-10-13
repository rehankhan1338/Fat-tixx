'use server';

import { revalidatePath } from 'next/cache';
import { execute, query, queryOne, type Row } from '../db';
import { audit } from '../audit';
import { assertOrg, canAccessEvent } from '../authz';
import { env } from '../env';
import { sendEmail } from '../email';
import { renderEmail } from '../email-templates';
import { clientIp } from '../request';
import { ipIsThrottled } from '../security/rate-limit';
import { randomToken } from '../security/crypto';
import { formatEventDate } from '../tz';
import { isEmail } from '../users';
import { getEvent, getPublicEventBySlug, publicEventPath, type WaitlistRow } from '../events/queries';

/**
 * Waitlist. Attendees join when an event or a ticket type is sold out; organizers release tickets to the
 * waitlist (oldest first) which emails a buy link. Buying marks the entry converted (see finalizePaidOrder).
 */
export type ActionState = { error?: string; ok?: boolean; message?: string } | undefined;
const str = (fd: FormData, k: string, max = 500) => String(fd.get(k) ?? '').trim().slice(0, max);

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------
export async function joinWaitlist(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ip = await clientIp();
  if (await ipIsThrottled(ip)) return { error: 'Too many attempts from this network. Please try again later.' };
  const event = await getPublicEventBySlug(str(fd, 'event', 120));
  if (!event || !['published', 'postponed'].includes(event.status)) return { error: 'This event is not accepting a waitlist.' };
  if (!event.waitlist_enabled) return { error: 'This event has no waitlist.' };
  const email = str(fd, 'email', 254).toLowerCase();
  const name = str(fd, 'name', 160);
  if (!isEmail(email)) return { error: 'Enter a valid email address.' };
  const qty = Math.min(10, Math.max(1, Number(str(fd, 'quantity', 3)) || 1));
  const ttRaw = Number(str(fd, 'ticket_type_id', 20));
  let ticketTypeId: number | null = null;
  if (Number.isInteger(ttRaw) && ttRaw > 0) {
    const tt = await queryOne<Row & { id: number }>(`SELECT id FROM ticket_types WHERE id = ? AND event_id = ? AND hidden = 0`, [ttRaw, event.id]);
    if (!tt) return { error: 'Ticket type not found.' };
    ticketTypeId = Number(tt.id);
  }
  const existing = await queryOne<Row & { id: number; status: string }>(
    `SELECT id, status FROM waitlist_entries WHERE event_id = ? AND email = ? AND ${ticketTypeId ? 'ticket_type_id = ?' : 'ticket_type_id IS NULL'}`,
    ticketTypeId ? [event.id, email, ticketTypeId] : [event.id, email],
  );
  if (existing) {
    if (existing.status === 'waiting' || existing.status === 'notified') return { ok: true, message: 'You are already on the waitlist. We will email you if tickets free up.' };
    await execute(`UPDATE waitlist_entries SET status = 'waiting', quantity = ?, name = COALESCE(NULLIF(?, ''), name), notified_at = NULL WHERE id = ?`, [qty, name, existing.id]);
  } else {
    await execute(
      `INSERT INTO waitlist_entries (event_id, ticket_type_id, email, name, quantity, token) VALUES (?, ?, ?, ?, ?, ?)`,
      [event.id, ticketTypeId, email, name || null, qty, randomToken(16)],
    );
  }
  await audit('waitlist.joined', { targetType: 'event', targetId: event.id, metadata: { email, ticketTypeId, qty } });
  revalidatePath(`/events/${event.slug}`);
  return { ok: true, message: 'You are on the waitlist. We will email you as soon as tickets free up.' };
}

/** Unsubscribe link from the waitlist email (?leave=<token>). */
export async function leaveWaitlist(token: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return false;
  const r = await execute(`UPDATE waitlist_entries SET status = 'removed' WHERE token = ? AND status IN ('waiting','notified')`, [token]);
  if (r.affectedRows) await audit('waitlist.left', { targetType: 'waitlist', metadata: { token: token.slice(0, 6) } });
  return r.affectedRows > 0;
}

// ---------------------------------------------------------------------------
// Organizer
// ---------------------------------------------------------------------------
async function loadEvent(fd: FormData) {
  const orgSlug = str(fd, 'org', 64);
  const ctx = await assertOrg(orgSlug, 'organizer');
  const event = await getEvent(ctx.org.id, Number(fd.get('event_id')));
  if (!event || !(await canAccessEvent(ctx, event))) throw new Error('Event not found');
  return { ctx, event };
}

/** Email the next N waiting people (oldest first), optionally only those waiting for one ticket type. */
export async function notifyWaitlist(_prev: ActionState, fd: FormData): Promise<ActionState> {
  let loaded;
  try { loaded = await loadEvent(fd); } catch (e) { return { error: (e as Error).message }; }
  const { ctx, event } = loaded;
  if (!['published', 'postponed'].includes(event.status)) return { error: 'Publish the event before releasing tickets to the waitlist.' };
  const count = Math.min(500, Math.max(1, Number(str(fd, 'count', 5)) || 10));
  const ttRaw = Number(str(fd, 'ticket_type_id', 20));
  const ticketTypeId = Number.isInteger(ttRaw) && ttRaw > 0 ? ttRaw : null;
  const rows = await query<WaitlistRow>(
    `SELECT w.*, t.name AS ticket_type_name FROM waitlist_entries w LEFT JOIN ticket_types t ON t.id = w.ticket_type_id
      WHERE w.event_id = ? AND w.status = 'waiting' ${ticketTypeId ? 'AND (w.ticket_type_id = ? OR w.ticket_type_id IS NULL)' : ''} ORDER BY w.created_at, w.id LIMIT ?`,
    ticketTypeId ? [event.id, ticketTypeId, count] : [event.id, count],
  );
  if (rows.length === 0) return { error: 'Nobody is waiting.' };
  const when = formatEventDate(new Date(event.starts_at), event.timezone);
  const url = `${env.APP_URL}${publicEventPath(event)}`;
  for (const w of rows) {
    const leaveUrl = `${env.APP_URL}/events/${event.slug}?leave=${w.token}`;
    const mail = await renderEmail('waitlist_available', {
      event_title: event.title, event_when: when, url, leave_url: leaveUrl,
      ticket_note: w.ticket_type_name ? `You asked about: ${w.ticket_type_name}${w.quantity > 1 ? ` (${w.quantity} tickets)` : ''}.` : `You asked for ${w.quantity} ticket${w.quantity === 1 ? '' : 's'}.`,
    });
    await sendEmail({ to: w.email, toName: w.name, subject: mail.subject, text: mail.text, html: mail.html, related: { type: 'event', id: event.id } });
    await execute(`UPDATE waitlist_entries SET status = 'notified', notified_at = NOW() WHERE id = ?`, [w.id]);
  }
  await audit('waitlist.notified', { actorUserId: ctx.session.user.id, targetType: 'event', targetId: event.id, metadata: { notified: rows.length, ticketTypeId } });
  revalidatePath(`/org/${ctx.org.slug}/events/${event.id}`);
  return { ok: true, message: `${rows.length} ${rows.length === 1 ? 'person' : 'people'} notified.` };
}

export async function removeWaitlistEntry(fd: FormData): Promise<ActionState> {
  let loaded;
  try { loaded = await loadEvent(fd); } catch (e) { return { error: (e as Error).message }; }
  const { ctx, event } = loaded;
  const id = Number(fd.get('entry_id'));
  const r = await execute(`UPDATE waitlist_entries SET status = 'removed' WHERE id = ? AND event_id = ?`, [id, event.id]);
  if (!r.affectedRows) return { error: 'Entry not found.' };
  await audit('waitlist.removed', { actorUserId: ctx.session.user.id, targetType: 'waitlist', targetId: id, metadata: { eventId: event.id } });
  revalidatePath(`/org/${ctx.org.slug}/events/${event.id}`);
  return { ok: true };
}

/** Put a notified entry back to waiting (e.g. they did not buy and tickets sold out again). */
export async function requeueWaitlistEntry(fd: FormData): Promise<ActionState> {
  let loaded;
  try { loaded = await loadEvent(fd); } catch (e) { return { error: (e as Error).message }; }
  const { ctx, event } = loaded;
  const id = Number(fd.get('entry_id'));
  const r = await execute(`UPDATE waitlist_entries SET status = 'waiting', notified_at = NULL WHERE id = ? AND event_id = ? AND status = 'notified'`, [id, event.id]);
  if (!r.affectedRows) return { error: 'Entry not found.' };
  revalidatePath(`/org/${ctx.org.slug}/events/${event.id}`);
  return { ok: true };
}
