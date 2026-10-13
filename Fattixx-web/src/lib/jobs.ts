import 'server-only';
import { execute, query, type Row } from './db';
import { env } from './env';
import { retryDueEmails, sendEmail } from './email';
import { renderEmail } from './email-templates';
import { expireStaleHolds } from './orders/checkout';
import { reconcileWithStripe } from './payments/reconcile';
import { pruneOldAttempts } from './security/rate-limit';
import { sendSms } from './sms';
import { formatEventDate, formatTimeOnly } from './tz';

/**
 * Background jobs. `runJobs()` is called every minute by the in-process scheduler (src/instrumentation.ts)
 * and can also be triggered by an external cron hitting GET /api/cron with the CRON_SECRET bearer token.
 * Every job is safe to run concurrently from several app instances: work is claimed with conditional UPDATEs.
 */
export type JobsSummary = { holdsExpired: boolean; emails: { retried: number; sent: number }; reminders: number; queuePruned: number; daily: string | null };

/** ~24 h before an event: email (and optionally text) every ticket holder once. */
export async function sendEventReminders(): Promise<number> {
  const events = await query<Row & { id: number; title: string; starts_at: Date; doors_at: Date | null; timezone: string; age_restriction: number | null; venue_name: string | null; venue_city: string | null }>(
    `SELECT e.id, e.title, e.starts_at, e.doors_at, e.timezone, e.age_restriction, v.name AS venue_name, v.city AS venue_city
       FROM events e LEFT JOIN venues v ON v.id = e.venue_id
      WHERE e.status IN ('published','postponed') AND e.reminder_sent_at IS NULL
        AND e.starts_at BETWEEN NOW() + INTERVAL 2 HOUR AND NOW() + INTERVAL 26 HOUR`,
  );
  let sent = 0;
  for (const ev of events) {
    const claim = await execute(`UPDATE events SET reminder_sent_at = NOW() WHERE id = ? AND reminder_sent_at IS NULL`, [ev.id]);
    if (!claim.affectedRows) continue;
    const orders = await query<Row & { id: number; buyer_email: string; buyer_name: string | null; buyer_phone: string | null; sms_opt_in: number; live: number }>(
      `SELECT o.id, o.buyer_email, o.buyer_name, o.buyer_phone, o.sms_opt_in,
              (SELECT COUNT(*) FROM tickets k WHERE k.order_id = o.id AND k.status IN ('valid','used')) AS live
         FROM orders o WHERE o.event_id = ? AND o.status IN ('paid','partially_refunded')`, [ev.id],
    );
    const when = formatEventDate(new Date(ev.starts_at), ev.timezone);
    const doors = ev.doors_at ? `Doors ${formatTimeOnly(new Date(ev.doors_at), ev.timezone)}` : '';
    const venue = [ev.venue_name, ev.venue_city].filter(Boolean).join(', ');
    for (const o of orders) {
      if (!Number(o.live)) continue;
      const mail = await renderEmail('event_reminder', {
        buyer_name: o.buyer_name ?? 'there', event_title: ev.title, event_when: when, doors_line: doors, venue_line: venue, ticket_count: String(o.live),
        order_url: `${env.APP_URL}/tickets/find`, age_notice: ev.age_restriction ? `This event is ${ev.age_restriction}+. Bring a valid photo ID.` : '',
      });
      await sendEmail({ to: o.buyer_email, toName: o.buyer_name, subject: mail.subject, text: mail.text, html: mail.html, related: { type: 'order', id: o.id } });
      if (o.sms_opt_in && o.buyer_phone) await sendSms(o.buyer_phone, `Reminder: ${ev.title} is ${when}${venue ? ` at ${venue}` : ''}. Your tickets: ${env.APP_URL}/tickets/find`, { type: 'order', id: o.id });
      sent++;
    }
  }
  return sent;
}

/** Once per UTC day: Stripe reconciliation for the last 2 days (alerting Finance on discrepancies) and housekeeping. */
export async function runDailyJobs(today = new Date().toISOString().slice(0, 10)): Promise<string | null> {
  const claim = await execute("UPDATE platform_settings SET `value` = ? WHERE `key` = 'last_daily_jobs' AND `value` <> ?", [today, today]);
  if (!claim.affectedRows) return null;
  await pruneOldAttempts();
  await execute(`DELETE FROM queue_entries WHERE created_at < NOW() - INTERVAL 2 DAY`);
  let recon: Awaited<ReturnType<typeof reconcileWithStripe>> = null;
  try { recon = await reconcileWithStripe(2, null); } catch (e) { console.error('[jobs] reconciliation failed', e); }
  if (recon?.discrepancies) {
    const staff = await query<Row & { email: string; name: string }>(
      `SELECT DISTINCT u.email, u.name FROM users u JOIN user_platform_roles r ON r.user_id = u.id WHERE r.role IN ('finance','super_admin') AND u.status = 'active'`,
    );
    const mail = await renderEmail('reconciliation_alert', { count: String(recon.discrepancies), range: 'the last 2 days', url: `${env.APP_URL}/admin/payments` });
    for (const s of staff) await sendEmail({ to: s.email, toName: s.name, subject: mail.subject, text: mail.text, html: mail.html, related: { type: 'reconciliation', id: recon.id } });
  }
  return today;
}

export async function runJobs(): Promise<JobsSummary> {
  await expireStaleHolds();
  const emails = await retryDueEmails();
  const reminders = await sendEventReminders();
  const pruned = await execute(`DELETE FROM queue_entries WHERE expires_at IS NOT NULL AND expires_at < NOW() - INTERVAL 1 HOUR LIMIT 1000`);
  const daily = await runDailyJobs();
  return { holdsExpired: true, emails, reminders, queuePruned: pruned.affectedRows, daily };
}
