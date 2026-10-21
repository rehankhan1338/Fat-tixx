import 'server-only';
import { query, queryOne, type Row } from '../db';
import { env } from '../env';
import { sendEmail } from '../email';
import { renderEmail } from '../email-templates';
import { formatCents } from '../money';

/**
 * Plan 7.4: "Track disputes per order and event, with alerts to Super Admin / Finance."
 * Emails every active Finance / Super Admin user once, when a dispute is first recorded (from the Stripe
 * webhook or from "Sync from Stripe"). Updates and closures do not alert again; staff track those on
 * Admin → Disputes. Never throws: a failed alert must not make Stripe retry the webhook.
 */
export async function notifyStaffOfNewDispute(input: { orderId: number; stripeDisputeId: string; amountCents: number; currency?: string; reason: string | null; evidenceDueAt: Date | null }): Promise<number> {
  try {
    const order = await queryOne<Row & { code: string; buyer_email: string; currency: string; event_title: string; checkin_at: Date | null; checkin_by: string | null }>(
      `SELECT o.code, o.buyer_email, o.currency, e.title AS event_title,
              (SELECT MIN(t.checked_in_at) FROM tickets t WHERE t.order_id = o.id AND t.checked_in_at IS NOT NULL) AS checkin_at,
              (SELECT u.name FROM tickets t JOIN users u ON u.id = t.checked_in_by WHERE t.order_id = o.id AND t.checked_in_at IS NOT NULL ORDER BY t.checked_in_at LIMIT 1) AS checkin_by
         FROM orders o JOIN events e ON e.id = o.event_id WHERE o.id = ?`,
      [input.orderId],
    );
    if (!order) return 0;
    const staff = await query<Row & { email: string; name: string }>(
      `SELECT DISTINCT u.email, u.name FROM users u JOIN user_platform_roles r ON r.user_id = u.id WHERE r.role IN ('finance','super_admin') AND u.status = 'active'`,
    );
    if (!staff.length) return 0;
    const fmt = (d: Date) => d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/New_York' });
    const mail = await renderEmail('dispute_opened', {
      order_code: order.code,
      event_title: order.event_title,
      buyer_email: order.buyer_email,
      amount: formatCents(input.amountCents, input.currency ?? order.currency ?? 'USD'),
      reason: input.reason ? input.reason.replace(/_/g, ' ') : 'not given',
      evidence_due: input.evidenceDueAt ? fmt(input.evidenceDueAt) : 'see Stripe',
      checked_in: order.checkin_at ? `Yes, ${fmt(new Date(order.checkin_at))}${order.checkin_by ? ` by ${order.checkin_by}` : ''}` : 'No',
      url: `${env.ADMIN_URL}/admin/disputes`,
    });
    let sent = 0;
    for (const s of staff) {
      await sendEmail({ to: s.email, toName: s.name, subject: mail.subject, text: mail.text, html: mail.html, related: { type: 'dispute', id: input.stripeDisputeId } });
      sent++;
    }
    return sent;
  } catch (e) {
    console.error('[disputes] alert email failed:', (e as Error).message);
    return 0;
  }
}
