import 'server-only';
import { query, queryOne, type Row } from '../db';
import { audit } from '../audit';
import { env } from '../env';
import { escapeHtml, sendEmail } from '../email';
import { renderEmail } from '../email-templates';
import { listTransferHolders } from '../orders/transfer';
import { formatEventDate, formatTimeOnly } from '../tz';

/**
 * Ticket holders hear about it when an edit changes the date, time or location of an event they hold tickets for
 * (plan 5.6.12). Callers take a snapshot before saving and pass it in after; nothing is sent when those fields did not
 * change, for drafts, or for events that are over. Postponing has its own email (src/lib/orders/actions.ts).
 */
export type EventSnapshot = {
  id: number; title: string; status: string; starts_at: Date; ends_at: Date | null; show_end_time: number; doors_at: Date | null; timezone: string;
  venue_id: number | null; online_url: string | null; venue_name: string | null; venue_address: string | null; venue_city: string | null; venue_region: string | null;
  /** multi-day events: every day, one line each ("" for single-day events) */
  days: string;
};

export async function eventSnapshot(eventId: number): Promise<EventSnapshot | null> {
  const e = await queryOne<Row & Omit<EventSnapshot, 'days'>>(
    `SELECT e.id, e.title, e.status, e.starts_at, e.ends_at, e.show_end_time, e.doors_at, e.timezone, e.venue_id, e.online_url,
            v.name AS venue_name, v.address_line1 AS venue_address, v.city AS venue_city, v.region AS venue_region
       FROM events e LEFT JOIN venues v ON v.id = e.venue_id WHERE e.id = ?`, [eventId],
  );
  if (!e) return null;
  const days = await query<Row & { label: string | null; starts_at: Date; ends_at: Date | null; doors_at: Date | null }>(
    `SELECT label, starts_at, ends_at, doors_at FROM event_dates WHERE event_id = ? ORDER BY starts_at, id`, [eventId],
  );
  return {
    ...e,
    days: days.length > 1 ? days.map((d) => `${d.label ? `${d.label}: ` : ''}${whenLine({ ...d, show_end_time: e.show_end_time, timezone: e.timezone })}`).join('\n') : '',
  };
}

/** "Sat, Dec 5, 2026, 8:00 PM EST – 11:00 PM · doors 7:00 PM" */
export function whenLine(e: Pick<EventSnapshot, 'starts_at' | 'ends_at' | 'show_end_time' | 'doors_at' | 'timezone'>): string {
  const start = formatEventDate(new Date(e.starts_at), e.timezone);
  const end = e.ends_at && e.show_end_time ? ` – ${formatTimeOnly(new Date(e.ends_at), e.timezone)}` : '';
  const doors = e.doors_at ? ` · doors ${formatTimeOnly(new Date(e.doors_at), e.timezone)}` : '';
  return `${start}${end}${doors}`;
}

/** "The Warehouse, 200 W Washington St, Greenville, SC" or "Online event. Join here: https://…" (holders only) */
export function whereLine(e: Pick<EventSnapshot, 'venue_name' | 'venue_address' | 'venue_city' | 'venue_region' | 'online_url' | 'venue_id'>): string {
  if (!e.venue_id && e.online_url) return `Online event. Join here: ${e.online_url}`;
  return [e.venue_name, e.venue_address, [e.venue_city, e.venue_region].filter(Boolean).join(', ')].filter(Boolean).join(', ');
}

/** What changed, as rows for the email; empty when nothing ticket holders need to know about. */
export function describeChanges(before: EventSnapshot, after: EventSnapshot): { label: string; now: string; was: string }[] {
  const out: { label: string; now: string; was: string }[] = [];
  const wasWhen = whenLine(before), nowWhen = whenLine(after);
  if (before.days !== after.days && (before.days || after.days)) out.push({ label: 'Schedule', now: after.days || nowWhen, was: before.days || wasWhen });
  else if (wasWhen !== nowWhen) out.push({ label: 'Date and time', now: nowWhen, was: wasWhen });
  const wasWhere = whereLine(before), nowWhere = whereLine(after);
  if (wasWhere !== nowWhere) out.push({ label: after.venue_id || !after.online_url ? 'Location' : 'Online link', now: nowWhere || 'To be announced', was: wasWhere || 'To be announced' });
  return out;
}

/** Email every ticket holder about a date / time / location change. Returns how many people were emailed. */
export async function notifyEventChanged(before: EventSnapshot | null, actorUserId: number | null): Promise<number> {
  if (!before) return 0;
  const after = await eventSnapshot(before.id);
  if (!after || !['published', 'postponed'].includes(after.status)) return 0;
  const endsAt = new Date(after.ends_at ?? new Date(new Date(after.starts_at).getTime() + 6 * 3_600_000));
  if (endsAt.getTime() < Date.now()) return 0;
  const changes = describeChanges(before, after);
  if (!changes.length) return 0;

  const buyers = await query<Row & { id: number; buyer_email: string; buyer_name: string | null }>(
    `SELECT id, buyer_email, buyer_name FROM orders WHERE event_id = ? AND status IN ('paid','partially_refunded')`, [after.id],
  );
  const holders = await listTransferHolders(after.id);
  const recipients = new Map<string, { name: string | null; orderId: number | null }>();
  for (const b of buyers) recipients.set(b.buyer_email.toLowerCase(), { name: b.buyer_name, orderId: Number(b.id) });
  for (const h of holders) if (!recipients.has(h.email.toLowerCase())) recipients.set(h.email.toLowerCase(), { name: h.name, orderId: null });
  if (!recipients.size) return 0;

  const mail = await renderEmail('event_updated', {
    event_title: after.title,
    changes_html: changes.map((c) => {
      const html = (s: string) => escapeHtml(s).replace(/\n/g, '<br>');
      return `<tr><td>${escapeHtml(c.label)}</td><td align="right">${html(c.now)}<br><span class="muted">was ${html(c.was)}</span></td></tr>`;
    }).join(''),
    when_text: whenLine(after),
    where_text: whereLine(after),
    order_url: `${env.APP_URL}/tickets/find`,
  });
  for (const [email, r] of recipients) {
    await sendEmail({ to: email, toName: r.name, subject: mail.subject, text: mail.text, html: mail.html, related: r.orderId ? { type: 'order', id: r.orderId } : { type: 'event', id: after.id } });
  }
  await audit('event.holders_notified', { actorUserId, targetType: 'event', targetId: after.id, metadata: { changed: changes.map((c) => c.label), recipients: recipients.size } });
  return recipients.size;
}
