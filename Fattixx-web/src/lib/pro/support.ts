import 'server-only';
import { query, queryOne, type Row } from '../db';

/**
 * Support requests from organizers (plan 5.7.2 "priority support"). Requests sent while the organization is on Pro are
 * marked `priority` and the staff queue (Admin → Support) lists them first, with a shorter response target.
 */
export const SUPPORT_CATEGORIES = [
  { value: 'events', label: 'Events and tickets' },
  { value: 'payments', label: 'Payments and refunds' },
  { value: 'payouts', label: 'Payouts' },
  { value: 'billing', label: 'Fattixx Pro billing' },
  { value: 'domain', label: 'Custom domain' },
  { value: 'email', label: 'Email marketing' },
  { value: 'other', label: 'Something else' },
] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number]['value'];
export const SUPPORT_STATUSES = ['open', 'in_progress', 'waiting', 'resolved'] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

/** First-response targets shown to organizers and staff (business hours). */
export const RESPONSE_TARGET_HOURS = { priority: 4, normal: 24 } as const;

export type SupportRequestRow = Row & {
  id: number; organization_id: number | null; user_id: number | null; email: string; name: string | null; category: SupportCategory; subject: string;
  priority: 'normal' | 'priority'; status: SupportStatus; assigned_to: number | null; first_response_at: Date | null; resolved_at: Date | null; created_at: Date; updated_at: Date;
  org_name: string | null; org_slug: string | null; assignee_name: string | null; messages: number; last_message_at: Date | null;
};

const SELECT = `
  SELECT r.*, o.name AS org_name, o.slug AS org_slug, a.name AS assignee_name,
         (SELECT COUNT(*) FROM support_messages m WHERE m.request_id = r.id) AS messages,
         (SELECT MAX(m.created_at) FROM support_messages m WHERE m.request_id = r.id) AS last_message_at
    FROM support_requests r LEFT JOIN organizations o ON o.id = r.organization_id LEFT JOIN users a ON a.id = r.assigned_to`;

export async function listOrgSupportRequests(orgId: number): Promise<SupportRequestRow[]> {
  return query<SupportRequestRow>(`${SELECT} WHERE r.organization_id = ? ORDER BY r.status = 'resolved', r.updated_at DESC LIMIT 100`, [orgId]);
}

/** Staff queue: unresolved first, priority before normal, oldest first within each. */
export async function supportQueue(filter: { status?: SupportStatus | 'active' | 'all'; priority?: 'priority' | 'normal' | null }): Promise<SupportRequestRow[]> {
  const where: string[] = [];
  const params: string[] = [];
  if (!filter.status || filter.status === 'active') where.push(`r.status <> 'resolved'`);
  else if (filter.status !== 'all') { where.push('r.status = ?'); params.push(filter.status); }
  if (filter.priority) { where.push('r.priority = ?'); params.push(filter.priority); }
  return query<SupportRequestRow>(
    `${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY r.status = 'resolved', r.priority = 'priority' DESC, r.created_at ASC LIMIT 200`, params,
  );
}

export async function getSupportRequest(id: number): Promise<SupportRequestRow | null> {
  return queryOne<SupportRequestRow>(`${SELECT} WHERE r.id = ?`, [id]);
}

export type SupportMessageRow = Row & { id: number; request_id: number; author_user_id: number | null; from_staff: number; body: string; created_at: Date; author_name: string | null };

export async function listSupportMessages(requestId: number): Promise<SupportMessageRow[]> {
  return query<SupportMessageRow>(
    `SELECT m.*, u.name AS author_name FROM support_messages m LEFT JOIN users u ON u.id = m.author_user_id WHERE m.request_id = ? ORDER BY m.created_at, m.id`, [requestId],
  );
}

/** Queue health for the staff dashboard: open requests, and priority ones past their response target. */
export async function supportQueueCounts(): Promise<{ open: number; priorityOpen: number; overdue: number }> {
  const r = await queryOne<Row & { open: number; p: number; overdue: number }>(
    `SELECT SUM(status <> 'resolved') AS open, SUM(status <> 'resolved' AND priority = 'priority') AS p,
            SUM(status <> 'resolved' AND first_response_at IS NULL AND created_at < NOW() - INTERVAL IF(priority = 'priority', ?, ?) HOUR) AS overdue
       FROM support_requests`, [RESPONSE_TARGET_HOURS.priority, RESPONSE_TARGET_HOURS.normal],
  );
  return { open: Number(r?.open ?? 0), priorityOpen: Number(r?.p ?? 0), overdue: Number(r?.overdue ?? 0) };
}

/** Is a request past its first-response target? */
export function isOverdue(r: Pick<SupportRequestRow, 'status' | 'first_response_at' | 'created_at' | 'priority'>, now = Date.now()): boolean {
  if (r.status === 'resolved' || r.first_response_at) return false;
  return now - new Date(r.created_at).getTime() > RESPONSE_TARGET_HOURS[r.priority] * 3_600_000;
}
