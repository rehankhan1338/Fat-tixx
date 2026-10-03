import 'server-only';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { execute, queryOne, type Row } from '../db';
import { env } from '../env';
import { randomToken, sha256 } from '../security/crypto';
import { clientIp, userAgent } from '../request';

/**
 * Server-side sessions.
 *
 *  - The browser holds a random 256-bit token; the DB stores only its SHA-256, so a database
 *    dump cannot be replayed as a live session.
 *  - Absolute lifetime SESSION_ABSOLUTE_HOURS; idle timeout SESSION_IDLE_MINUTES (sliding).
 *  - Cookie: HttpOnly, SameSite=Strict, Secure in production, `__Host-` prefix in production
 *    (browser refuses to accept it from a subdomain or with a Domain/Path attribute).
 */
export const SESSION_ABSOLUTE_HOURS = 12;
export const SESSION_IDLE_MINUTES = 30;
/** How recent the sign-in must be for step-up protected actions (e.g. revoking every session). */
export const FRESH_AUTH_MINUTES = 10;

export const SESSION_COOKIE = env.IS_PROD ? '__Host-fx_session' : 'fx_session';

export type PlatformRole = 'super_admin' | 'support' | 'finance';

export interface SessionUser {
  id: number;
  publicId: string;
  email: string;
  name: string;
  roles: PlatformRole[];
  emailVerified: boolean;
}

export interface CurrentSession {
  id: string;
  user: SessionUser;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
}

export function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: env.IS_PROD,
    sameSite: 'strict' as const,
    path: '/',
    maxAge: maxAgeSeconds,
    priority: 'high' as const,
  };
}

export async function createSession(userId: number): Promise<void> {
  const token = randomToken(32);
  const id = sha256(token);
  const [ip, ua] = await Promise.all([clientIp(), userAgent()]);
  await execute(
    `INSERT INTO sessions (id, user_id, expires_at, ip, user_agent)
     VALUES (?, ?, NOW() + INTERVAL ? HOUR, ?, ?)`,
    [id, userId, SESSION_ABSOLUTE_HOURS, ip, ua],
  );
  const store = await cookies();
  store.set(SESSION_COOKIE, token, sessionCookieOptions(SESSION_ABSOLUTE_HOURS * 3600));
}

type SessionRow = Row & {
  id: string; user_id: number; created_at: Date; last_seen_at: Date; expires_at: Date;
  public_id: string; email: string; name: string; status: string; roles: string | null; email_verified_at: Date | null;
};

/**
 * Resolve the current session from the cookie. Cached per request so layouts, pages and
 * actions share one lookup. Returns null for missing, expired, idle, revoked, or suspended.
 */
export const getSession = cache(async (): Promise<CurrentSession | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token || token.length < 32 || token.length > 128) return null;
  const id = sha256(token);

  const row = await queryOne<SessionRow>(
    `SELECT s.id, s.user_id, s.created_at, s.last_seen_at, s.expires_at,
            u.public_id, u.email, u.name, u.status, u.email_verified_at,
            (SELECT GROUP_CONCAT(r.role) FROM user_platform_roles r WHERE r.user_id = u.id) AS roles
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.id = ?
        AND s.revoked_at IS NULL
        AND s.expires_at > NOW()
        AND s.last_seen_at > (NOW() - INTERVAL ? MINUTE)`,
    [id, SESSION_IDLE_MINUTES],
  );
  if (!row || row.status !== 'active') return null;

  // Slide the idle window, but write at most once a minute to keep reads cheap.
  if (Date.now() - new Date(row.last_seen_at).getTime() > 60_000) {
    void execute(`UPDATE sessions SET last_seen_at = NOW() WHERE id = ?`, [id]).catch(() => {});
  }

  return {
    id: row.id,
    user: {
      id: Number(row.user_id),
      publicId: row.public_id,
      email: row.email,
      name: row.name,
      roles: (row.roles ? row.roles.split(',') : []) as PlatformRole[],
      emailVerified: row.email_verified_at != null,
    },
    createdAt: new Date(row.created_at),
    lastSeenAt: new Date(row.last_seen_at),
    expiresAt: new Date(row.expires_at),
  };
});

export async function revokeSession(sessionId: string, reason: string): Promise<void> {
  await execute(`UPDATE sessions SET revoked_at = NOW(), revoked_reason = ? WHERE id = ? AND revoked_at IS NULL`, [reason, sessionId]);
}

export async function revokeAllUserSessions(userId: number, reason: string, exceptSessionId?: string): Promise<number> {
  const r = await execute(
    `UPDATE sessions SET revoked_at = NOW(), revoked_reason = ?
      WHERE user_id = ? AND revoked_at IS NULL ${exceptSessionId ? 'AND id <> ?' : ''}`,
    exceptSessionId ? [reason, userId, exceptSessionId] : [reason, userId],
  );
  return r.affectedRows;
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, '', { ...sessionCookieOptions(0), maxAge: 0 });
}

/** Step-up check: the sign-in itself must be recent. */
export function authIsFresh(session: CurrentSession): boolean {
  return Date.now() - session.createdAt.getTime() < FRESH_AUTH_MINUTES * 60_000;
}
