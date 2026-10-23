import 'server-only';
import { execute, query, type Row } from '../db';
import { env } from '../env';
import { sendEmail } from '../email';
import { payoutsReady } from './connect';

/** Days between two "Set up payouts" reminders to the same organization. */
export const PAYOUT_REMINDER_DAYS = 3;

/**
 * Organizations selling paid tickets that can't be paid yet (plan 5.6.9, option A). A paid event is one with a
 * ticket type above $0, published and not over.
 */
export async function orgsAwaitingPayoutSetup(): Promise<{ id: number; slug: string; name: string; verified: boolean }[]> {
  const rows = await query<Row & { id: number; slug: string; name: string; verified_at: Date | null }>(
    `SELECT DISTINCT g.id, g.slug, g.name, g.verified_at
       FROM organizations g JOIN events e ON e.organization_id = g.id
      WHERE e.status IN ('published','postponed') AND COALESCE(e.ends_at, e.starts_at) > NOW()
        AND EXISTS (SELECT 1 FROM ticket_types t WHERE t.event_id = e.id AND t.price_cents > 0)`,
  );
  const out = [];
  for (const r of rows) {
    const verified = !!r.verified_at;
    if (!(await payoutsReady(Number(r.id), verified))) out.push({ id: Number(r.id), slug: r.slug, name: r.name, verified });
  }
  return out;
}

/** Whether one organization should see the "Set up payouts" banner on its dashboard. */
export async function needsPayoutSetup(orgId: number): Promise<boolean> {
  return (await orgsAwaitingPayoutSetup()).some((o) => o.id === orgId);
}

/** Daily: email each such organization's admins, at most every PAYOUT_REMINDER_DAYS days. Returns how many were sent. */
export async function sendPayoutReminders(): Promise<number> {
  let sent = 0;
  for (const org of await orgsAwaitingPayoutSetup()) {
    const claim = await execute(
      `UPDATE organizations SET payout_reminder_at = NOW() WHERE id = ? AND (payout_reminder_at IS NULL OR payout_reminder_at < NOW() - INTERVAL ? DAY)`,
      [org.id, PAYOUT_REMINDER_DAYS],
    );
    if (!claim.affectedRows) continue;
    const admins = await query<Row & { email: string; name: string }>(
      `SELECT u.email, u.name FROM users u JOIN organization_members m ON m.user_id = u.id
        WHERE m.organization_id = ? AND m.role = 'org_admin' AND u.status = 'active'`, [org.id],
    );
    const url = `${env.APP_URL}/org/${org.slug}/payouts`;
    const text = `Hi,\n\n${org.name} is selling tickets on Fattixx, but payouts aren't set up yet. Your earnings are safe: we hold them until your bank details and identity check are done.\n\nSet up payouts: ${url}\n\nThe Fattixx team`;
    const html = `<p>Hi,</p><p><b>${escapeHtml(org.name)}</b> is selling tickets on Fattixx, but payouts aren't set up yet. Your earnings are safe: we hold them until your bank details and identity check are done.</p><p><a href="${url}">Set up payouts</a></p><p>The Fattixx team</p>`;
    for (const a of admins) {
      await sendEmail({ to: a.email, toName: a.name, subject: 'Set up payouts to get paid for your ticket sales', text, html, related: { type: 'organization', id: org.id } });
      sent++;
    }
  }
  return sent;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
