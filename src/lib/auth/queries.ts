import 'server-only';
import { query, queryOne, type Row } from '../db';

/**
 * Read-side helpers for Server Components. Deliberately NOT in a 'use server' file:
 * anything exported from a 'use server' module becomes a public POST endpoint.
 */

export type SessionListRow = Row & { id: string; created_at: Date; last_seen_at: Date; expires_at: Date; ip: string | null; user_agent: string | null };

export async function listUserSessions(userId: number): Promise<SessionListRow[]> {
  return query<SessionListRow>(
    `SELECT id, created_at, last_seen_at, expires_at, ip, user_agent FROM sessions
      WHERE user_id = ? AND revoked_at IS NULL AND expires_at > NOW()
      ORDER BY last_seen_at DESC`,
    [userId],
  );
}

export type AuditRow = Row & { id: number; action: string; actor_email: string | null; ip: string | null; metadata: string | null; created_at: Date };

export async function recentAudit(limit = 25): Promise<AuditRow[]> {
  return query<AuditRow>(
    `SELECT a.id, a.action, u.email AS actor_email, a.ip, a.metadata, a.created_at
       FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id
      ORDER BY a.id DESC LIMIT ?`,
    [limit],
  );
}

export type AttemptRow = Row & { id: number; email_normalized: string | null; ip: string; success: number; reason: string; created_at: Date };

export async function recentLoginAttempts(limit = 25, offset = 0): Promise<AttemptRow[]> {
  return query<AttemptRow>(
    `SELECT id, email_normalized, ip, success, reason, created_at FROM login_attempts ORDER BY id DESC LIMIT ? OFFSET ?`,
    [limit, offset],
  );
}

export async function countLoginAttempts(): Promise<number> {
  const r = await queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM login_attempts`);
  return Number(r?.n ?? 0);
}

export async function platformStats() {
  const [users, admins, sessions, failed24h] = await Promise.all([
    queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM users`),
    queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM user_platform_roles WHERE role = 'super_admin'`),
    queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM sessions WHERE revoked_at IS NULL AND expires_at > NOW() AND last_seen_at > (NOW() - INTERVAL 30 MINUTE)`),
    queryOne<Row & { n: number }>(`SELECT COUNT(*) AS n FROM login_attempts WHERE success = 0 AND created_at > (NOW() - INTERVAL 1 DAY)`),
  ]);
  return {
    users: Number(users?.n ?? 0),
    superAdmins: Number(admins?.n ?? 0),
    activeSessions: Number(sessions?.n ?? 0),
    failedLogins24h: Number(failed24h?.n ?? 0),
  };
}
