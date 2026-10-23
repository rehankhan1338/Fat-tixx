import 'server-only';
import { query, queryOne, type Row } from '../db';

export type OrgListRow = Row & {
  id: number; slug: string; name: string; contact_email: string; status: string; created_at: Date;
  members: number; events: number; gross_cents: number; orders: number;
};

export async function listOrganizations(search = '', limit = 50, offset = 0): Promise<OrgListRow[]> {
  const like = `%${search}%`;
  return query<OrgListRow>(
    `SELECT o.id, o.slug, o.name, o.contact_email, o.status, o.created_at,
            (SELECT COUNT(*) FROM organization_members m WHERE m.organization_id = o.id) AS members,
            (SELECT COUNT(*) FROM events e WHERE e.organization_id = o.id) AS events,
            (SELECT COUNT(*) FROM orders x WHERE x.organization_id = o.id AND x.status IN ('paid','partially_refunded','refunded')) AS orders,
            (SELECT COALESCE(SUM(x.subtotal_cents),0) FROM orders x WHERE x.organization_id = o.id AND x.status IN ('paid','partially_refunded')) AS gross_cents
       FROM organizations o
      WHERE (? = '' OR o.name LIKE ? OR o.slug LIKE ? OR o.contact_email LIKE ?)
      ORDER BY o.created_at DESC LIMIT ? OFFSET ?`,
    [search, like, like, like, limit, offset],
  );
}

export async function countOrganizations(search = ''): Promise<number> {
  const like = `%${search}%`;
  const r = await queryOne<Row & { n: number }>(
    `SELECT COUNT(*) AS n FROM organizations o WHERE (? = '' OR o.name LIKE ? OR o.slug LIKE ? OR o.contact_email LIKE ?)`,
    [search, like, like, like],
  );
  return Number(r?.n ?? 0);
}

export type MemberRow = Row & {
  user_id: number; email: string; name: string; role: 'org_admin' | 'organizer' | 'staff'; status: string; has_password: number;
  can_refund: number; can_override_checkin: number; can_undo_checkin: number; all_events: number; last_login_at: Date | null; created_at: Date;
};

export async function listOrgMembers(orgId: number): Promise<MemberRow[]> {
  return query<MemberRow>(
    `SELECT m.user_id, u.email, u.name, m.role, u.status, (u.password_hash IS NOT NULL) AS has_password,
            m.can_refund, m.can_override_checkin, m.can_undo_checkin, m.all_events, u.last_login_at, m.created_at
       FROM organization_members m JOIN users u ON u.id = m.user_id
      WHERE m.organization_id = ?
      ORDER BY FIELD(m.role,'org_admin','organizer','staff'), u.name`,
    [orgId],
  );
}

export type PlatformUserRow = Row & {
  id: number; email: string; name: string; status: string; has_password: number; last_login_at: Date | null; created_at: Date;
  platform_roles: string | null; org_count: number; order_count: number;
};

export async function listUsers(search = '', limit = 50, offset = 0): Promise<PlatformUserRow[]> {
  const like = `%${search}%`;
  return query<PlatformUserRow>(
    `SELECT u.id, u.email, u.name, u.status, (u.password_hash IS NOT NULL) AS has_password, u.last_login_at, u.created_at,
            (SELECT GROUP_CONCAT(r.role) FROM user_platform_roles r WHERE r.user_id = u.id) AS platform_roles,
            (SELECT COUNT(*) FROM organization_members m WHERE m.user_id = u.id) AS org_count,
            (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS order_count
       FROM users u
      WHERE (? = '' OR u.email LIKE ? OR u.name LIKE ?)
      ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
    [search, like, like, limit, offset],
  );
}

export async function countUsers(search = ''): Promise<number> {
  const like = `%${search}%`;
  const r = await queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM users u WHERE (? = '' OR u.email LIKE ? OR u.name LIKE ?)`, [search, like, like]);
  return Number(r?.n ?? 0);
}

export type EmailRow = Row & { id: number; to_email: string; to_name: string | null; subject: string; status: string; category: string; error: string | null; created_at: Date; sent_at: Date | null };

export async function listEmails(limit = 50, offset = 0): Promise<EmailRow[]> {
  return query<EmailRow>(`SELECT id, to_email, to_name, subject, status, category, error, created_at, sent_at FROM email_outbox ORDER BY id DESC LIMIT ? OFFSET ?`, [limit, offset]);
}

export async function countEmails(): Promise<number> {
  const r = await queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM email_outbox`);
  return Number(r?.n ?? 0);
}

export type SmsRow = Row & { id: number; to_phone: string; body: string; status: string; error: string | null; created_at: Date };

export async function listSms(limit = 50, offset = 0): Promise<SmsRow[]> {
  return query<SmsRow>(`SELECT id, to_phone, body, status, error, created_at FROM sms_outbox ORDER BY id DESC LIMIT ? OFFSET ?`, [limit, offset]);
}

export async function countSms(): Promise<number> {
  const r = await queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM sms_outbox`);
  return Number(r?.n ?? 0);
}

export async function getEmail(id: number) {
  return queryOne<EmailRow & { text_body: string; html_body: string | null }>(`SELECT * FROM email_outbox WHERE id = ?`, [id]);
}

export type AuditListRow = Row & { id: number; action: string; actor_email: string | null; target_type: string | null; target_id: string | null; ip: string | null; metadata: string | null; created_at: Date };

export async function listAudit(limit = 200, actionPrefix = '', offset = 0): Promise<AuditListRow[]> {
  const rows = await query<AuditListRow>(
    `SELECT a.id, a.action, u.email AS actor_email, a.target_type, a.target_id, a.ip, a.metadata, a.created_at
       FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id
      WHERE (? = '' OR a.action LIKE ?)
      ORDER BY a.id DESC LIMIT ? OFFSET ?`,
    [actionPrefix, `${actionPrefix}%`, limit, offset],
  );
  // a JSON column: MySQL 8 (and some MariaDB setups) hand it back already parsed, which React can't render
  return rows.map((r) => ({ ...r, metadata: r.metadata == null || typeof r.metadata === 'string' ? r.metadata : JSON.stringify(r.metadata) }));
}

export async function countAudit(actionPrefix = ''): Promise<number> {
  const r = await queryOne<Row & { n: number }>(
    `SELECT COUNT(*) AS n FROM audit_log WHERE (? = '' OR action LIKE ?)`,
    [actionPrefix, `${actionPrefix}%`],
  );
  return Number(r?.n ?? 0);
}

export async function platformOverview() {
  const [orgs, events, orders, tickets, checkins, gross, fees, users, refunds] = await Promise.all([
    queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM organizations WHERE status = 'active'`),
    queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM events WHERE status = 'published' AND starts_at > NOW()`),
    queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM orders WHERE status IN ('paid','partially_refunded') AND paid_at > (NOW() - INTERVAL 30 DAY)`),
    queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM tickets WHERE status IN ('valid','used')`),
    queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM tickets WHERE status = 'used'`),
    queryOne<Row & { n: number }>(`SELECT COALESCE(SUM(subtotal_cents),0) AS n FROM orders WHERE status IN ('paid','partially_refunded') AND paid_at > (NOW() - INTERVAL 30 DAY)`),
    queryOne<Row & { n: number }>(`SELECT COALESCE(SUM(platform_fee_cents + absorbed_fee_cents),0) AS n FROM orders WHERE status IN ('paid','partially_refunded') AND paid_at > (NOW() - INTERVAL 30 DAY)`),
    queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM users`),
    queryOne<Row & { n: number }>(`SELECT COALESCE(SUM(refunded_cents),0) AS n FROM orders WHERE paid_at > (NOW() - INTERVAL 30 DAY)`),
  ]);
  const n = (r: (Row & { n: number }) | null) => Number(r?.n ?? 0);
  return { orgs: n(orgs), upcomingEvents: n(events), orders30d: n(orders), ticketsIssued: n(tickets), checkedIn: n(checkins), gross30d: n(gross), fees30d: n(fees), users: n(users), refunds30d: n(refunds) };
}

export type RecentOrderRow = Row & { id: number; code: string; buyer_email: string; status: string; total_cents: number; currency: string; created_at: Date; event_title: string; org_name: string; org_slug: string };

export async function recentOrders(limit = 10): Promise<RecentOrderRow[]> {
  return query<RecentOrderRow>(
    `SELECT o.id, o.code, o.buyer_email, o.status, o.total_cents, o.currency, o.created_at, e.title AS event_title, g.name AS org_name, g.slug AS org_slug
       FROM orders o JOIN events e ON e.id = o.event_id JOIN organizations g ON g.id = o.organization_id
      WHERE o.status <> 'pending' ORDER BY o.id DESC LIMIT ?`,
    [limit],
  );
}
