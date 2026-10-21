import { query, queryOne, type Row } from '@/lib/db';
import { audit } from '@/lib/audit';
import { getSession } from '@/lib/auth/session';

/**
 * "Download my data" (plan 11.5): everything Fattixx holds about the signed-in person, as JSON.
 * Orders bought with the email are included only once the email is verified.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session) return new Response('Sign in first', { status: 401 });
  const u = session.user;
  const email = u.email.toLowerCase();
  const byEmail = u.emailVerified;
  const orderWhere = byEmail ? '(o.user_id = ? OR o.buyer_email = ?)' : 'o.user_id = ?';
  const orderParams = byEmail ? [u.id, email] : [u.id];

  const [profile, orders, tickets, memberships, waitlist, sessions, logins] = await Promise.all([
    queryOne<Row>(`SELECT public_id, email, name, phone, marketing_opt_in, email_verified_at, created_at, last_login_at FROM users WHERE id = ?`, [u.id]),
    query<Row>(
      `SELECT o.code, e.title AS event, e.starts_at, o.status, o.buyer_email, o.buyer_name, o.buyer_phone, o.total_cents, o.refunded_cents, o.currency, o.marketing_opt_in, o.sms_opt_in, o.created_at, o.paid_at
         FROM orders o JOIN events e ON e.id = o.event_id WHERE ${orderWhere} ORDER BY o.created_at`, orderParams,
    ),
    query<Row>(
      `SELECT k.code, t.name AS ticket_type, e.title AS event, k.attendee_name, k.attendee_email, k.status, k.checked_in_at
         FROM tickets k JOIN orders o ON o.id = k.order_id JOIN ticket_types t ON t.id = k.ticket_type_id JOIN events e ON e.id = k.event_id
        WHERE ${orderWhere} OR k.attendee_email = ?`, [...orderParams, email],
    ),
    query<Row>(`SELECT g.name AS organization, m.role, m.created_at FROM organization_members m JOIN organizations g ON g.id = m.organization_id WHERE m.user_id = ?`, [u.id]),
    byEmail ? query<Row>(`SELECT e.title AS event, w.status, w.quantity, w.created_at FROM waitlist_entries w JOIN events e ON e.id = w.event_id WHERE w.email = ?`, [email]) : Promise.resolve([]),
    query<Row>(`SELECT created_at, last_seen_at, ip, user_agent, revoked_at FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`, [u.id]),
    query<Row>(`SELECT created_at, ip, success, reason FROM login_attempts WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`, [u.id]),
  ]);
  await audit('user.data_exported', { actorUserId: u.id, targetType: 'user', targetId: u.id });
  const body = JSON.stringify({ exportedAt: new Date().toISOString(), profile, orders, tickets, memberships, waitlist, sessions, logins, note: byEmail ? undefined : 'Confirm your email to include orders bought as a guest with this address.' }, null, 2);
  return new Response(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="fattixx-my-data-${new Date().toISOString().slice(0, 10)}.json"`,
      'Cache-Control': 'no-store',
    },
  });
}
