import 'server-only';
import { execute, query, queryOne, type Row } from '../db';

/**
 * Login throttling backed by the database so it survives restarts and works across
 * multiple app instances.
 *
 *  - Per IP:      more than IP_MAX_FAILURES failed attempts in IP_WINDOW_MIN minutes → blocked.
 *  - Per account: after ACCOUNT_LOCK_THRESHOLD consecutive failures the account is locked;
 *                 each further failure doubles the lock, capped at 24 h. Reset on success.
 *
 * Both are applied BEFORE the password hash is computed, so an attacker cannot use the
 * login form to burn CPU either.
 */
const IP_WINDOW_MIN = 15;
const IP_MAX_FAILURES = 50;
const ACCOUNT_LOCK_THRESHOLD = 5;
const BASE_LOCK_MIN = 15;
const MAX_LOCK_MIN = 24 * 60;

export async function ipIsThrottled(ip: string): Promise<boolean> {
  const row = await queryOne<Row & { n: number }>(
    `SELECT COUNT(*) AS n FROM login_attempts
      WHERE ip = ? AND success = 0 AND created_at > (NOW() - INTERVAL ? MINUTE)`,
    [ip, IP_WINDOW_MIN],
  );
  return Number(row?.n ?? 0) >= IP_MAX_FAILURES;
}

export function lockDurationMinutes(failedCount: number): number {
  if (failedCount < ACCOUNT_LOCK_THRESHOLD) return 0;
  const doublings = failedCount - ACCOUNT_LOCK_THRESHOLD;
  return Math.min(BASE_LOCK_MIN * 2 ** doublings, MAX_LOCK_MIN);
}

export async function recordAttempt(a: {
  emailNormalized: string | null;
  userId: number | null;
  ip: string;
  success: boolean;
  reason: string;
  userAgent: string | null;
}): Promise<void> {
  await execute(
    `INSERT INTO login_attempts (email_normalized, user_id, ip, success, reason, user_agent)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [a.emailNormalized, a.userId, a.ip, a.success ? 1 : 0, a.reason, a.userAgent?.slice(0, 512) ?? null],
  );
}

/** Increment the consecutive-failure counter and apply a lock if the threshold is reached. */
export async function registerAccountFailure(userId: number): Promise<{ lockedMinutes: number }> {
  await execute(`UPDATE users SET failed_login_count = failed_login_count + 1 WHERE id = ?`, [userId]);
  const row = await queryOne<Row & { failed_login_count: number }>(`SELECT failed_login_count FROM users WHERE id = ?`, [userId]);
  const minutes = lockDurationMinutes(Number(row?.failed_login_count ?? 0));
  if (minutes > 0) {
    await execute(`UPDATE users SET locked_until = NOW() + INTERVAL ? MINUTE WHERE id = ?`, [minutes, userId]);
  }
  return { lockedMinutes: minutes };
}

export async function clearAccountFailures(userId: number): Promise<void> {
  await execute(`UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = ?`, [userId]);
}

/** Housekeeping: purge attempt rows older than 30 days. Called opportunistically. */
export async function pruneOldAttempts(): Promise<void> {
  await query(`DELETE FROM login_attempts WHERE created_at < (NOW() - INTERVAL 30 DAY) LIMIT 1000`);
}
