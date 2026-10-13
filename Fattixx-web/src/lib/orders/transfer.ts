import 'server-only';
import { randomBytes } from 'node:crypto';
import { db, query, queryOne, type Row } from '../db';
import { env } from '../env';
import { sendEmail } from '../email';
import { renderEmail } from '../email-templates';
import { humanCode } from '../slug';
import { ticketUrl } from '../tickets';
import { formatEventDate } from '../tz';
import { getOrderById } from './queries';

/**
 * Ticket transfers. The old ticket becomes 'transferred' (its QR stops scanning) and a new ticket with a
 * fresh code and secret is issued to the recipient on the same order, so nobody holding the old link
 * or a screenshot can still get in. Inventory is untouched: one live ticket is swapped for another.
 */
export class TransferError extends Error {}

export type TransferInput = {
  ticketId: number; orderId: number; toName: string; toEmail: string;
  initiatedBy: 'holder' | 'staff'; actorUserId: number | null; note?: string | null;
};

export async function transferTicket(input: TransferInput): Promise<{ newTicketId: number; code: string; secret: string }> {
  const conn = await db.getConnection();
  let result: { newTicketId: number; code: string; secret: string };
  try {
    await conn.beginTransaction();
    const [[t]] = await conn.query<(Row & { id: number; order_id: number; order_item_id: number; event_id: number; ticket_type_id: number; attendee_name: string | null; attendee_email: string | null; seat_label: string | null; status: string })[]>(
      `SELECT id, order_id, order_item_id, event_id, ticket_type_id, attendee_name, attendee_email, seat_label, status FROM tickets WHERE id = ? AND order_id = ? FOR UPDATE`,
      [input.ticketId, input.orderId],
    );
    if (!t) throw new TransferError('Ticket not found.');
    if (t.status !== 'valid') throw new TransferError(t.status === 'used' ? 'This ticket has already been checked in and cannot be transferred.' : `This ticket is ${t.status} and cannot be transferred.`);
    await conn.query(`UPDATE tickets SET status = 'transferred' WHERE id = ?`, [t.id]);
    const code = humanCode(12), secret = randomBytes(16).toString('hex');
    const [ins] = await conn.query<import('mysql2').ResultSetHeader>(
      `INSERT INTO tickets (code, secret, order_id, order_item_id, event_id, ticket_type_id, transferred_from_id, attendee_name, attendee_email, seat_label)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [code, secret, t.order_id, t.order_item_id, t.event_id, t.ticket_type_id, t.id, input.toName, input.toEmail.toLowerCase(), t.seat_label],
    );
    await conn.query(
      `INSERT INTO ticket_transfers (event_id, order_id, from_ticket_id, to_ticket_id, from_name, from_email, to_name, to_email, initiated_by, actor_user_id, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [t.event_id, t.order_id, t.id, ins.insertId, t.attendee_name, t.attendee_email, input.toName, input.toEmail.toLowerCase(), input.initiatedBy, input.actorUserId, input.note?.slice(0, 300) || null],
    );
    await conn.commit();
    result = { newTicketId: ins.insertId, code, secret };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  await sendTransferEmail(result.newTicketId, input.note ?? null);
  return result;
}

/** Email the current holder of a transferred-in ticket its link. Also used by "resend tickets". */
export async function sendTransferEmail(ticketId: number, note: string | null): Promise<void> {
  const t = await queryOne<Row & { code: string; secret: string; order_id: number; attendee_name: string | null; attendee_email: string | null; seat_label: string | null; ticket_type_name: string; day_label: string | null; from_name: string | null; from_email: string | null }>(
    `SELECT k.code, k.secret, k.order_id, k.attendee_name, k.attendee_email, k.seat_label, t.name AS ticket_type_name, COALESCE(d.label, DATE_FORMAT(d.starts_at, '%a, %b %e')) AS day_label,
            tr.from_name, tr.from_email
       FROM tickets k JOIN ticket_types t ON t.id = k.ticket_type_id LEFT JOIN event_dates d ON d.id = t.event_date_id
       LEFT JOIN ticket_transfers tr ON tr.to_ticket_id = k.id
      WHERE k.id = ?`, [ticketId],
  );
  if (!t?.attendee_email) return;
  const order = await getOrderById(Number(t.order_id));
  if (!order) return;
  const mail = await renderEmail('ticket_transferred', {
    recipient_name: t.attendee_name ?? 'there', from_name: t.from_name ?? t.from_email ?? order.buyer_name ?? 'Someone',
    event_title: order.event_title, event_when: formatEventDate(new Date(order.event_starts_at), order.event_timezone), venue_line: order.venue_name ?? '',
    ticket_line: [t.ticket_type_name, t.day_label, t.seat_label].filter(Boolean).join(' · '), ticket_code: t.code, url: ticketUrl(t.code, t.secret),
    note: note ? `Message: “${note}”` : '', age_notice: order.age_restriction ? `This event is ${order.age_restriction}+. Bring a valid photo ID.` : '', find_tickets_url: `${env.APP_URL}/tickets/find`,
  });
  await sendEmail({ to: t.attendee_email, toName: t.attendee_name, subject: mail.subject, text: mail.text, html: mail.html, related: { type: 'order', id: order.id } });
}

/** True when the ticket is held by someone other than the buyer because it was transferred to them. */
export function heldByRecipient(t: { transferred_from_id: number | null; attendee_email: string | null }, buyerEmail: string): boolean {
  return t.transferred_from_id != null && (t.attendee_email ?? '').toLowerCase() !== buyerEmail.toLowerCase();
}

/** Can the holder transfer tickets on this order themselves? Staff can always transfer a valid ticket. */
export function holderMayTransfer(order: { allow_transfers: number; status: string; event_status: string; event_starts_at: Date | string }): string | null {
  if (!order.allow_transfers) return 'The organizer does not allow ticket transfers for this event.';
  if (!['paid', 'partially_refunded'].includes(order.status)) return 'Only tickets on a paid order can be transferred.';
  if (order.event_status === 'cancelled') return 'This event was cancelled.';
  if (new Date(order.event_starts_at).getTime() <= Date.now()) return 'Transfers close when the event starts.';
  return null;
}

export type TransferRow = Row & {
  id: number; order_id: number; order_code: string; from_ticket_code: string; to_ticket_code: string; to_ticket_status: string; from_name: string | null; from_email: string | null;
  to_name: string; to_email: string; initiated_by: 'holder' | 'staff'; actor_name: string | null; note: string | null; created_at: Date;
};

const TRANSFER_SELECT = `
  SELECT tr.*, o.code AS order_code, f.code AS from_ticket_code, n.code AS to_ticket_code, n.status AS to_ticket_status, u.name AS actor_name
    FROM ticket_transfers tr JOIN orders o ON o.id = tr.order_id JOIN tickets f ON f.id = tr.from_ticket_id JOIN tickets n ON n.id = tr.to_ticket_id
    LEFT JOIN users u ON u.id = tr.actor_user_id`;

export async function listEventTransfers(eventId: number): Promise<TransferRow[]> {
  return query<TransferRow>(`${TRANSFER_SELECT} WHERE tr.event_id = ? ORDER BY tr.id DESC`, [eventId]);
}

export async function listOrderTransfers(orderId: number): Promise<TransferRow[]> {
  return query<TransferRow>(`${TRANSFER_SELECT} WHERE tr.order_id = ? ORDER BY tr.id`, [orderId]);
}

/** People holding live tickets on this event by transfer who are not themselves a buyer (event-wide notices must reach them too). */
export async function listTransferHolders(eventId: number): Promise<{ email: string; name: string | null }[]> {
  const rows = await query<Row & { email: string; name: string | null }>(
    `SELECT k.attendee_email AS email, MAX(k.attendee_name) AS name
       FROM tickets k
      WHERE k.event_id = ? AND k.transferred_from_id IS NOT NULL AND k.status IN ('valid','used') AND k.attendee_email IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.event_id = k.event_id AND o.buyer_email = k.attendee_email AND o.status IN ('paid','partially_refunded'))
      GROUP BY k.attendee_email`, [eventId],
  );
  return rows.map((r) => ({ email: r.email, name: r.name }));
}

export type ReceivedTicketRow = Row & { code: string; secret: string; status: string; ticket_type_name: string; event_title: string; event_starts_at: Date; event_timezone: string };

/** Tickets transferred to an email address (for "Find my tickets"). */
export async function listTicketsReceivedBy(email: string): Promise<ReceivedTicketRow[]> {
  return query<ReceivedTicketRow>(
    `SELECT k.code, k.secret, k.status, t.name AS ticket_type_name, e.title AS event_title, e.starts_at AS event_starts_at, e.timezone AS event_timezone
       FROM tickets k JOIN ticket_types t ON t.id = k.ticket_type_id JOIN events e ON e.id = k.event_id JOIN orders o ON o.id = k.order_id
      WHERE k.attendee_email = ? AND k.transferred_from_id IS NOT NULL AND k.status IN ('valid','used') AND o.buyer_email <> k.attendee_email
      ORDER BY e.starts_at DESC`, [email.toLowerCase()],
  );
}
